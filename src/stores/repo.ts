import { create } from 'zustand';

import { layoutGraph, withStashes, type GraphRow } from '@/lib/graph';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type {
  Commit,
  CommitDetail,
  DiffRequest,
  Refs,
  RepoInfo,
  Settings,
  Worktree,
} from '@/lib/types';
import { logActivity, useActivity } from './activity';
import { toast } from './ui';

/** Commits per graph page: Preferences → General → Initial commits. */
const page = () => useRepo.getState().settings?.initialCommits ?? 2000;
/**
 * Commits drawn first when a repository opens, so the tab is usable at once; the rest of the
 * page loads right after, in the background.
 */
export const FIRST_PAGE = 300;
/** Tab switches: only the latest one lands, a slower earlier one is dropped. */
let openSeq = 0;
/** The refresh in flight. Overlapping calls share it instead of starting more git processes. */
let pending: { path: string; again: boolean; done: Promise<void> } | null = null;
/** When the open repository was last fully loaded (ms). */
let loadedAt = 0;
/** Each workspace keeps its own open tabs; '' is "no workspace". */
let scope = '';
const tabsKey = () => (scope ? `gitstudio.tabs.${scope}` : 'gitstudio.tabs');
const lastKey = () => (scope ? `gitstudio.lastRepo.${scope}` : 'gitstudio.lastRepo');

/**
 * Told when a repository opens in a new tab. The workspace store sets it so a repository opened
 * while a workspace is active joins that workspace (repo.ts can't import the workspace store,
 * which imports this one).
 */
let onTabOpened: ((path: string, name: string) => void) | null = null;
export function setTabOpenedHandler(fn: typeof onTabOpened) {
  onTabOpened = fn;
}

export function lastRepoOfScope(): string | null {
  try {
    return localStorage.getItem(lastKey());
  } catch {
    return null;
  }
}

/** One end of a comparison: what git resolves (`rev`, a hash or ref name) and how to name it. */
export interface CompareSide {
  rev: string;
  label: string;
  /** Commit the side points at, to highlight its row in the graph. */
  hash: string;
}

export type Selection =
  | { type: 'wip' }
  | { type: 'commit'; hash: string }
  /** Two commits / branches side by side: what changes from `base` to `target`. */
  | { type: 'compare'; base: CompareSide; target: CompareSide }
  /** Several commits (Ctrl / Shift + click), newest first as in the graph. */
  | { type: 'commits'; hashes: string[] };

export interface OpenDiff {
  request: DiffRequest;
  text: string;
  loading: boolean;
}

export interface RepoTab {
  path: string;
  name: string;
}

/** A reversible operation for Undo/Redo. */
export interface JournalEntry {
  label: string;
  undo: (repo: string) => Promise<unknown>;
  redo: (repo: string) => Promise<unknown>;
}

interface RepoStore {
  /** Active workspace id ('' for none); decides which tab set is shown. */
  scope: string;
  setScope: (id: string) => Promise<void>;
  settings: Settings | null;
  tabs: RepoTab[];
  path: string | null;
  info: RepoInfo | null;
  commits: Commit[];
  graph: GraphRow[];
  hasMore: boolean;
  refs: Refs | null;
  /** Linked worktrees, reloaded with the refs (sidebar list, branch markers, branch menus). */
  worktrees: Worktree[];
  view: GraphView;
  /** Change the graph filters and reload the history. */
  setView: (v: GraphView) => Promise<void>;
  selection: Selection | null;
  detail: CommitDetail | null;
  diff: OpenDiff | null;
  /** Label of the running operation, shown in the toolbar. */
  busy: string | null;
  loading: boolean;
  undoStack: JournalEntry[];
  redoStack: JournalEntry[];

  loadSettings: () => Promise<void>;
  setSettings: (s: Settings) => void;
  open: (path: string) => Promise<boolean>;
  /** Show `info` in its tab (a new one if needed). `keepOutOfWorkspace`: a new tab does not
   *  join the active workspace. */
  adopt: (info: RepoInfo, opts?: { keepOutOfWorkspace?: boolean }) => Promise<void>;
  /** Show the start page in a new tab (current repository tab stays open). */
  newTab: () => void;
  closeTab: (path: string) => void;
  moveTab: (from: number, to: number) => void;
  /** Add tabs without opening them (e.g. imported from GitKraken). */
  addTabs: (tabs: RepoTab[]) => void;
  close: () => void;
  /** Reload the repository. `first`: right after opening, a short first page and no status. */
  refresh: (opts?: { first?: boolean }) => Promise<void>;
  /** On window focus: a full refresh, or only the status when the last one is recent. */
  refreshOnFocus: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  loadMore: () => Promise<void>;
  select: (s: Selection | null) => Promise<void>;
  /** Select `hash` in the graph, loading older pages if it is not loaded yet. */
  reveal: (hash: string) => Promise<void>;
  openDiff: (request: DiffRequest) => Promise<void>;
  reloadDiff: () => Promise<void>;
  closeDiff: () => void;
  /** Run a mutating operation with a busy label, error toast, and refresh afterwards. */
  run: (
    label: string,
    fn: (repo: string) => Promise<unknown>,
    success?: string,
  ) => Promise<boolean>;
  record: (e: JournalEntry) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

function loadTabs(): RepoTab[] {
  try {
    const v = JSON.parse(localStorage.getItem(tabsKey()) ?? '[]');
    return Array.isArray(v) ? v.filter((t) => t && typeof t.path === 'string') : [];
  } catch {
    return [];
  }
}

function saveTabs(tabs: RepoTab[], current: string | null) {
  try {
    localStorage.setItem(tabsKey(), JSON.stringify(tabs));
    if (current) localStorage.setItem(lastKey(), current);
    else localStorage.removeItem(lastKey());
  } catch {
    /* ignore */
  }
}

const samePath = (a: string, b: string) =>
  a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();

/** Graph filters from the branch / commit menus (full ref names), kept per repository. */
export interface GraphView {
  /** Only the history of these refs. */
  solo: string[];
  /** Every ref but these. */
  hidden: string[];
  /** These branches get the leftmost lanes, in order. */
  pinned: string[];
  /** Stash hashes not drawn in the graph. */
  hiddenStashes: string[];
}

export const EMPTY_VIEW: GraphView = { solo: [], hidden: [], pinned: [], hiddenStashes: [] };

const viewKey = (p: string) => `gitstudio.graphView.${p.replace(/\\/g, '/').toLowerCase()}`;

function loadView(p: string): GraphView {
  try {
    const v = JSON.parse(localStorage.getItem(viewKey(p)) ?? 'null');
    const list = (x: unknown) =>
      Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [];
    return v
      ? {
          solo: list(v.solo),
          hidden: list(v.hidden),
          pinned: list(v.pinned),
          hiddenStashes: list(v.hiddenStashes),
        }
      : EMPTY_VIEW;
  } catch {
    return EMPTY_VIEW;
  }
}

function saveView(p: string, v: GraphView) {
  try {
    if (!v.solo.length && !v.hidden.length && !v.pinned.length && !v.hiddenStashes.length)
      localStorage.removeItem(viewKey(p));
    else localStorage.setItem(viewKey(p), JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

/** Commit hashes of the pinned branches, for the graph layout. */
function pinnedTips(view: GraphView, refs: Refs | null): string[] {
  return view.pinned
    .map((full) => refs?.refs.find((r) => r.fullName === full)?.target)
    .filter((h): h is string => !!h);
}

const logView = (v: GraphView) => ({ solo: v.solo, hidden: v.hidden });
/** Stashes drawn in the graph: none while soloing a branch, and never the hidden ones. */
const shownStashes = (v: GraphView, refs: Refs | null) =>
  v.solo.length ? [] : (refs?.stashes ?? []).filter((s) => !v.hiddenStashes.includes(s.hash));

const emptyRepo = {
  view: EMPTY_VIEW,
  path: null,
  info: null,
  commits: [],
  graph: [],
  refs: null,
  worktrees: [] as Worktree[],
  selection: null,
  detail: null,
  diff: null,
  undoStack: [],
  redoStack: [],
};

/** Re-focusing a window within this long of a full load only re-reads the status. */
const FOCUS_REFRESH_MS = 10_000;

/**
 * Load the repository at `path` into the store: status, refs, worktrees and the graph's
 * commits (all loaded ones again, at least a page; `first`: a short first page and the status
 * `open` just read).
 */
async function loadRepo(path: string, first: boolean) {
  try {
    const loaded = useRepo.getState().commits.filter((c) => !c.stash).length;
    const limit = first ? Math.min(page(), FIRST_PAGE) : Math.max(page(), loaded);
    const view = loadView(path);
    const [info, commits, refs, worktrees] = await Promise.all([
      first ? Promise.resolve(useRepo.getState().info!) : api.info(path),
      api.log(path, limit, 0, logView(view)),
      api.refs(path),
      api.worktrees(path).catch((): Worktree[] => []),
    ]);
    if (useRepo.getState().path !== path) return;
    const rows = withStashes(commits, shownStashes(view, refs));
    useRepo.setState({
      info,
      commits: rows,
      view,
      graph: layoutGraph(rows, pinnedTips(view, refs)),
      refs,
      worktrees,
      hasMore: commits.length >= limit,
    });
    const sel = useRepo.getState().selection;
    if (sel?.type === 'commit') {
      if (commits.some((c) => c.hash === sel.hash)) {
        if (!useRepo.getState().detail || useRepo.getState().detail?.hash !== sel.hash)
          void useRepo.getState().select(sel);
      } else {
        void useRepo.getState().select({ type: 'wip' });
      }
    }
    if (useRepo.getState().diff) void useRepo.getState().reloadDiff();
  } catch (e) {
    toast('error', t('Refresh failed'), (e as Error).message);
  }
  loadedAt = Date.now();
}

/** After the first page: load the rest of the page in the background. */
async function topUp(path: string) {
  const { commits, view, refs, hasMore } = useRepo.getState();
  const real = commits.filter((c) => !c.stash);
  const want = page() - real.length;
  if (!hasMore || want <= 0) return;
  try {
    const more = await api.log(path, want, real.length, logView(view));
    const now = useRepo.getState();
    // A refresh meanwhile (it reloads at least a page) or another repository: nothing to add.
    if (now.path !== path || now.commits !== commits) return;
    const all = withStashes([...real, ...more], shownStashes(view, refs));
    useRepo.setState({
      commits: all,
      graph: layoutGraph(all, pinnedTips(view, refs)),
      hasMore: more.length >= want,
    });
  } catch {
    /* the "Load more" row stays; clicking it tries again */
  }
}

export const useRepo = create<RepoStore>((set, get) => ({
  scope: '',
  setScope: async (id) => {
    scope = id;
    set({ ...emptyRepo, scope: id, tabs: loadTabs() });
    const last = lastRepoOfScope();
    const target = last ?? get().tabs[0]?.path;
    if (target && last) await get().open(target);
  },
  settings: null,
  tabs: loadTabs(),
  path: null,
  info: null,
  commits: [],
  graph: [],
  hasMore: false,
  refs: null,
  worktrees: [],
  view: EMPTY_VIEW,
  selection: null,
  detail: null,
  diff: null,
  busy: null,
  loading: false,
  undoStack: [],
  redoStack: [],

  loadSettings: async () => {
    try {
      set({ settings: await api.settings() });
    } catch (e) {
      toast('error', t('Could not load settings'), (e as Error).message);
    }
  },
  setSettings: (settings) => set({ settings }),

  open: async (path) => {
    if (get().path && samePath(get().path!, path)) return true;
    const seq = ++openSeq;
    const prev = get().path;
    // Switch at once: the new tab shows a spinner instead of the previous repository staying
    // on screen (and seemingly frozen) until the new one has loaded.
    set({ ...emptyRepo, path, loading: true });
    try {
      const info = await api.open(path);
      if (seq !== openSeq) return true;
      await get().adopt(info);
      return true;
    } catch (e) {
      if (seq !== openSeq) return false;
      toast('error', t('Could not open repository'), (e as Error).message);
      set({ ...emptyRepo, loading: false });
      if (prev && !samePath(prev, path)) void get().open(prev);
      return false;
    }
  },

  adopt: async (info, opts) => {
    logActivity({
      repo: null,
      label: 'Opened repository {name}',
      vars: { name: info.path },
      status: 'info',
    });
    const tabs = [...get().tabs];
    const i = tabs.findIndex((t) => samePath(t.path, info.path));
    if (i >= 0) tabs[i] = { path: info.path, name: info.name };
    else tabs.push({ path: info.path, name: info.name });
    saveTabs(tabs, info.path);
    if (i < 0 && !opts?.keepOutOfWorkspace) onTabOpened?.(info.path, info.name);
    set({
      ...emptyRepo,
      tabs,
      path: info.path,
      info,
      selection: { type: 'wip' },
      loading: true,
    });
    // Toolbar, sidebar and WIP show now; the graph fills in as its commits arrive.
    await get().refresh({ first: true });
    if (get().path !== info.path) return;
    void get().loadSettings();
    await topUp(info.path);
    if (get().path === info.path) set({ loading: false });
  },

  newTab: () => {
    saveTabs(get().tabs, null);
    set({ ...emptyRepo });
    void get().loadSettings();
  },

  closeTab: (path) => {
    const tabs = get().tabs;
    const idx = tabs.findIndex((t) => samePath(t.path, path));
    const rest = tabs.filter((_, i) => i !== idx);
    const wasCurrent = !!get().path && samePath(get().path!, path);
    saveTabs(rest, wasCurrent ? null : get().path);
    set({ tabs: rest });
    if (!wasCurrent) return;
    const next = rest[Math.min(idx, rest.length - 1)];
    set({ ...emptyRepo });
    if (next) void get().open(next.path);
    else void get().loadSettings();
  },

  addTabs: (more) => {
    const tabs = [...get().tabs];
    for (const t of more) if (!tabs.some((x) => samePath(x.path, t.path))) tabs.push(t);
    saveTabs(tabs, get().path);
    set({ tabs });
  },

  moveTab: (from, to) => {
    const tabs = [...get().tabs];
    const [t] = tabs.splice(from, 1);
    if (!t) return;
    tabs.splice(to, 0, t);
    saveTabs(tabs, get().path);
    set({ tabs });
  },

  close: () => {
    const p = get().path;
    if (p) get().closeTab(p);
  },

  refresh: (opts) => {
    const path = get().path;
    // No info yet: the repository is still opening, and that load brings everything.
    if (!path || !get().info) return Promise.resolve();
    if (pending && samePath(pending.path, path)) {
      pending.again = true;
      return pending.done;
    }
    const entry = { path, again: false, done: Promise.resolve() };
    entry.done = (async () => {
      let first = !!opts?.first;
      do {
        entry.again = false;
        await loadRepo(path, first);
        first = false;
      } while (entry.again && get().path === path);
    })().finally(() => {
      if (pending === entry) pending = null;
    });
    pending = entry;
    return entry.done;
  },

  refreshOnFocus: async () => {
    if (Date.now() - loadedAt < FOCUS_REFRESH_MS) await get().refreshStatus();
    else await get().refresh();
  },

  refreshStatus: async () => {
    const path = get().path;
    if (!path || get().busy || !get().info) return;
    // A refresh in flight reads the status too.
    if (pending && samePath(pending.path, path)) return;
    try {
      const info = await api.info(path);
      if (get().path !== path) return;
      const prev = get().info;
      // Only a status refresh when nothing about refs changed.
      if (
        prev &&
        prev.status.head === info.status.head &&
        prev.status.branch === info.status.branch
      ) {
        set({ info });
      } else {
        await get().refresh();
      }
    } catch {
      /* repo may be mid-operation; next refresh will catch up */
    }
  },

  loadMore: async () => {
    const { path, commits, view, refs } = get();
    if (!path) return;
    // Stash rows are not history: page by real commits only, then re-place the stashes.
    const real = commits.filter((c) => !c.stash);
    const more = await api.log(path, page(), real.length, logView(view));
    const all = withStashes([...real, ...more], shownStashes(view, refs));
    set({
      commits: all,
      graph: layoutGraph(all, pinnedTips(view, refs)),
      hasMore: more.length >= page(),
    });
  },

  setView: async (v) => {
    const path = get().path;
    if (!path) return;
    saveView(path, v);
    set({ view: v });
    await get().refresh();
  },

  reveal: async (hash) => {
    // A few pages at most; very old commits are still shown in the commit panel.
    for (let i = 0; i < 5; i++) {
      const { commits, hasMore } = get();
      if (commits.some((c) => c.hash === hash) || !hasMore) break;
      await get().loadMore();
    }
    await get().select({ type: 'commit', hash });
  },

  select: async (selection) => {
    set({ selection, detail: selection?.type === 'commit' ? get().detail : null });
    if (selection?.type !== 'commit') return;
    const path = get().path!;
    try {
      const detail = await api.commit(path, selection.hash);
      const cur = get().selection;
      if (cur?.type === 'commit' && cur.hash === selection.hash) set({ detail });
    } catch (e) {
      toast('error', t('Could not load commit'), (e as Error).message);
    }
  },

  openDiff: async (request) => {
    const path = get().path;
    if (!path) return;
    set({ diff: { request, text: get().diff?.text ?? '', loading: true } });
    try {
      const text = await api.diff(path, request);
      if (get().diff?.request === request) set({ diff: { request, text, loading: false } });
    } catch (e) {
      set({ diff: { request, text: '', loading: false } });
      toast('error', t('Could not load diff'), (e as Error).message);
    }
  },

  reloadDiff: async () => {
    const d = get().diff;
    const info = get().info;
    if (!d || !info) return;
    // A working-tree file that left its list (staged/committed/discarded) closes its diff.
    if (d.request.source === 'staged' || d.request.source === 'unstaged') {
      const list = d.request.source === 'staged' ? info.status.staged : info.status.unstaged;
      if (!list.some((f) => f.path === d.request.path)) {
        set({ diff: null });
        return;
      }
    }
    await get().openDiff(d.request);
  },

  closeDiff: () => set({ diff: null }),

  run: async (label, fn, success) => {
    const path = get().path;
    if (!path) return false;
    set({ busy: label });
    let ok = false;
    const done = useActivity.getState().begin(path, label);
    try {
      await fn(path);
      ok = true;
      done();
      if (success) toast('success', success);
    } catch (e) {
      done((e as Error).message);
      toast('error', t('{label} failed', { label: t(label) }), (e as Error).message);
    } finally {
      set({ busy: null });
      await get().refresh();
    }
    return ok;
  },

  record: (e) => set((s) => ({ undoStack: [...s.undoStack.slice(-49), e], redoStack: [] })),

  undo: async () => {
    const e = get().undoStack.at(-1);
    if (!e) return;
    const label = t(e.label);
    const ok = await get().run(t('Undo {label}', { label }), e.undo, t('Undid {label}', { label }));
    if (ok) set((s) => ({ undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, e] }));
  },

  redo: async () => {
    const e = get().redoStack.at(-1);
    if (!e) return;
    const label = t(e.label);
    const ok = await get().run(t('Redo {label}', { label }), e.redo, t('Redid {label}', { label }));
    if (ok) set((s) => ({ redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, e] }));
  },
}));

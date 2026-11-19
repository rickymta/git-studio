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
/** Each workspace keeps its own open tabs; '' is "no workspace". */
let scope = '';
const tabsKey = () => (scope ? `gitstudio.tabs.${scope}` : 'gitstudio.tabs');
const lastKey = () => (scope ? `gitstudio.lastRepo.${scope}` : 'gitstudio.lastRepo');

export function lastRepoOfScope(): string | null {
  try {
    return localStorage.getItem(lastKey());
  } catch {
    return null;
  }
}

export type Selection = { type: 'wip' } | { type: 'commit'; hash: string };

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
  /** Worktrees of the repository (refreshed with the refs); empty when listing fails. */
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
  adopt: (info: RepoInfo) => Promise<void>;
  /** Show the start page in a new tab (current repository tab stays open). */
  newTab: () => void;
  closeTab: (path: string) => void;
  moveTab: (from: number, to: number) => void;
  /** Add tabs without opening them (e.g. imported from GitKraken). */
  addTabs: (tabs: RepoTab[]) => void;
  close: () => void;
  refresh: () => Promise<void>;
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
  worktrees: [],
  selection: null,
  detail: null,
  diff: null,
  undoStack: [],
  redoStack: [],
};

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
    set({ loading: true });
    try {
      const info = await api.open(path);
      await get().adopt(info);
      return true;
    } catch (e) {
      toast('error', t('Could not open repository'), (e as Error).message);
      set({ loading: false });
      return false;
    }
  },

  adopt: async (info) => {
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
    set({
      ...emptyRepo,
      tabs,
      path: info.path,
      info,
      selection: { type: 'wip' },
      loading: true,
    });
    await get().refresh();
    set({ loading: false });
    void get().loadSettings();
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

  refresh: async () => {
    const path = get().path;
    if (!path) return;
    try {
      const limit = Math.max(page(), get().commits.filter((c) => !c.stash).length);
      const view = loadView(path);
      const [info, commits, refs, worktrees] = await Promise.all([
        api.info(path),
        api.log(path, limit, 0, logView(view)),
        api.refs(path),
        api.worktrees(path).catch((): Worktree[] => []),
      ]);
      if (get().path !== path) return;
      const rows = withStashes(commits, shownStashes(view, refs));
      set({
        info,
        commits: rows,
        view,
        graph: layoutGraph(rows, pinnedTips(view, refs)),
        refs,
        worktrees,
        hasMore: commits.length >= limit,
      });
      const sel = get().selection;
      if (sel?.type === 'commit') {
        if (commits.some((c) => c.hash === sel.hash)) {
          if (!get().detail || get().detail?.hash !== sel.hash) void get().select(sel);
        } else {
          void get().select({ type: 'wip' });
        }
      }
      if (get().diff) void get().reloadDiff();
    } catch (e) {
      toast('error', t('Refresh failed'), (e as Error).message);
    }
  },

  refreshStatus: async () => {
    const path = get().path;
    if (!path || get().busy) return;
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

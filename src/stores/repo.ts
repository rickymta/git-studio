import { create } from 'zustand';

import { extendGraph, layoutGraph, withStashes, type GraphRow } from '@/lib/graph';
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
let pending: { path: string; again: boolean; fresh: boolean; done: Promise<void> } | null = null;
/** The "load more" in flight, so scrolling to the end does not ask for the same page twice. */
let morePending: Promise<void> | null = null;
/** Repository whose remaining history is being loaded in the background. */
let restFor: string | null = null;

/** Background pages grow with what is loaded (half of it), within these bounds. */
const REST_MIN = 2000;
const REST_MAX = 20000;
/**
 * Background loading stops here: the graph is one scrolling list, and browsers cap an element's
 * height at about 33.5 million pixels (≈ 1.2 million rows). Older commits still load on scroll.
 */
const REST_LIMIT = 1_000_000;
/** A tab snapshot keeps at most this many commits; the rest loads again in the background. */
const SNAPSHOT_COMMITS = 5000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * After the newest page shows, load the rest of the history in the background, page after page,
 * so the whole graph is there without "Load more" (histories of hundreds of thousands of commits).
 * Pages grow with what is loaded, so the total work stays in proportion to the history. Stops
 * when the tab changes (and resumes when it comes back) and waits while an operation runs.
 */
async function loadRest(path: string) {
  if (restFor && samePath(restFor, path)) return;
  restFor = path;
  try {
    for (;;) {
      await sleep(150);
      const s = useRepo.getState();
      if (!s.path || !samePath(s.path, path) || !s.hasMore || s.commits.length >= REST_LIMIT) break;
      if (s.busy || pending) {
        await sleep(500);
        continue;
      }
      const loaded = s.commits.length;
      await s.loadMore(Math.min(REST_MAX, Math.max(REST_MIN, Math.round(loaded / 2))));
    }
  } catch {
    /* the "Load more" row stays; scrolling to it or clicking it tries again */
  } finally {
    if (restFor && samePath(restFor, path)) restFor = null;
  }
}
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
  /** Reload from git. `first`: the short first page after opening. `fresh`: drop the older
   *  commits loaded so far instead of keeping them below the newest page (the graph view changed). */
  refresh: (opts?: { first?: boolean; fresh?: boolean }) => Promise<void>;
  /** On window focus: a full refresh, or only the status when the last one is recent. */
  refreshOnFocus: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  /** Load the next `count` commits (default: a page) below the loaded ones. */
  loadMore: (count?: number) => Promise<void>;
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

const pathKey = (p: string) => p.replace(/\\/g, '/').toLowerCase();
const samePath = (a: string, b: string) => pathKey(a) === pathKey(b);

/**
 * Undo / Redo history of the repositories not on screen, so switching tabs and back keeps it
 * (for this session; it is not saved).
 */
const journals = new Map<string, { undoStack: JournalEntry[]; redoStack: JournalEntry[] }>();

/** What a tab had loaded, so switching back to it shows at once (refreshed in the background). */
interface TabSnapshot {
  info: RepoInfo;
  commits: Commit[];
  graph: GraphRow[];
  refs: Refs | null;
  worktrees: Worktree[];
  view: GraphView;
  hasMore: boolean;
  selection: Selection | null;
  /** When it was last loaded from git (ms). */
  at: number;
}

/** Snapshots of the most recently used tabs; older ones load from git again when opened. */
const MAX_SNAPSHOTS = 16;
const snapshots = new Map<string, TabSnapshot>();
/** A snapshot this recent only gets a status check when its tab comes back. */
const SNAPSHOT_FRESH_MS = 60_000;

/**
 * Put the shown repository aside before another one replaces it: its Undo / Redo history, and
 * what it had loaded (unless it was still loading).
 */
function keepJournal() {
  const s = useRepo.getState();
  if (!s.path) return;
  const key = pathKey(s.path);
  journals.set(key, { undoStack: s.undoStack, redoStack: s.redoStack });
  if (!s.info || s.loading) return;
  snapshots.delete(key);
  // Rows are laid out from the top, so the first ones keep their lanes on their own.
  const cut = s.commits.length > SNAPSHOT_COMMITS;
  snapshots.set(key, {
    info: s.info,
    commits: cut ? s.commits.slice(0, SNAPSHOT_COMMITS) : s.commits,
    graph: cut ? s.graph.slice(0, SNAPSHOT_COMMITS) : s.graph,
    refs: s.refs,
    worktrees: s.worktrees,
    view: s.view,
    hasMore: cut || s.hasMore,
    selection: s.selection,
    at: loadedAt,
  });
  while (snapshots.size > MAX_SNAPSHOTS) {
    const oldest = snapshots.keys().next().value;
    if (oldest === undefined) break;
    snapshots.delete(oldest);
  }
}

const journalOf = (path: string) => journals.get(pathKey(path)) ?? { undoStack: [], redoStack: [] };

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
 * The newest page just read, followed by the older commits loaded before that it does not
 * include, so a refresh costs one page however far the graph was scrolled (repositories with
 * hundreds of thousands of commits). Null when the page does not reach them (history rewritten
 * or more new commits than a page): then only the new page is kept.
 */
export function keepOlder(fresh: Commit[], loaded: Commit[]): Commit[] | null {
  const last = fresh[fresh.length - 1];
  if (!last) return null;
  const j = loaded.findIndex((c) => c.hash === last.hash);
  if (j < 0) return null;
  const seen = new Set(fresh.map((c) => c.hash));
  return [...fresh, ...loaded.slice(j + 1).filter((c) => !seen.has(c.hash))];
}

/**
 * Load the repository at `path` into the store: status, refs, worktrees and the newest page of
 * the graph's commits, keeping the older ones already loaded below it (`first`: a short first
 * page and the status `open` just read; `fresh`: only the new page).
 */
async function loadRepo(path: string, first: boolean, fresh = false) {
  try {
    const limit = first ? Math.min(page(), FIRST_PAGE) : page();
    const view = loadView(path);
    const [info, commits, refs, worktrees] = await Promise.all([
      first ? Promise.resolve(useRepo.getState().info!) : api.info(path),
      api.log(path, limit, 0, logView(view)),
      api.refs(path),
      api.worktrees(path).catch((): Worktree[] => []),
    ]);
    if (useRepo.getState().path !== path) return;
    const before = useRepo.getState();
    const older = before.commits.filter((c) => !c.stash);
    // Scrolled further than a page: keep those commits under the new page.
    const kept =
      !first && !fresh && commits.length >= limit && older.length > commits.length
        ? keepOlder(commits, older)
        : null;
    const all = kept ?? commits;
    const rows = withStashes(all, shownStashes(view, refs));
    useRepo.setState({
      info,
      commits: rows,
      view,
      graph: layoutGraph(rows, pinnedTips(view, refs)),
      refs,
      worktrees,
      hasMore: kept ? before.hasMore : commits.length >= limit,
    });
    if (!first && useRepo.getState().hasMore) void loadRest(path);
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

/**
 * The loaded rows with `more` (older commits) after them. Only the new rows are laid out when
 * the earlier ones stay as they were (no stash row moved into them, nothing pinned), so a page
 * costs the same however much history is already loaded.
 */
function appendCommits(
  prev: { commits: Commit[]; graph: GraphRow[] },
  more: Commit[],
  view: GraphView,
  refs: Refs | null,
): { commits: Commit[]; graph: GraphRow[] } {
  const real = prev.commits.filter((c) => !c.stash);
  const seen = new Set(real.map((c) => c.hash));
  const commits = withStashes(
    [...real, ...more.filter((c) => !seen.has(c.hash))],
    shownStashes(view, refs),
  );
  const n = prev.commits.length;
  const samePrefix =
    view.pinned.length === 0 &&
    commits.length >= n &&
    commits[n - 1]?.hash === prev.commits[n - 1]?.hash;
  const graph =
    (samePrefix && n > 0 && extendGraph(prev.graph, commits.slice(n))) ||
    layoutGraph(commits, pinnedTips(view, refs));
  return { commits, graph };
}

/** After the first page: load the rest of the page in the background. */
async function topUp(path: string) {
  const { commits, graph, view, refs, hasMore } = useRepo.getState();
  const real = commits.filter((c) => !c.stash);
  const want = page() - real.length;
  if (!hasMore || want <= 0) return;
  try {
    const more = await api.log(path, want, real.length, logView(view));
    const now = useRepo.getState();
    // A refresh meanwhile (it reloads at least a page) or another repository: nothing to add.
    if (now.path !== path || now.commits !== commits) return;
    useRepo.setState({
      ...appendCommits({ commits, graph }, more, view, refs),
      hasMore: more.length >= want,
    });
  } catch {
    /* the "Load more" row stays; clicking it tries again */
  }
}

/**
 * Bookkeeping when a repository becomes the shown tab: activity log, the tab list (added or
 * renamed, saved) and the active workspace. Returns the tab list.
 */
function registerTab(info: RepoInfo, opts?: { keepOutOfWorkspace?: boolean }): RepoTab[] {
  logActivity({
    repo: null,
    label: 'Opened repository {name}',
    vars: { name: info.path },
    status: 'info',
  });
  const tabs = [...useRepo.getState().tabs];
  const i = tabs.findIndex((t) => samePath(t.path, info.path));
  if (i >= 0) tabs[i] = { path: info.path, name: info.name };
  else tabs.push({ path: info.path, name: info.name });
  saveTabs(tabs, info.path);
  useRepo.setState({ tabs });
  if (i < 0 && !opts?.keepOutOfWorkspace) onTabOpened?.(info.path, info.name);
  return tabs;
}

export const useRepo = create<RepoStore>((set, get) => ({
  scope: '',
  setScope: async (id) => {
    scope = id;
    keepJournal();
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
    keepJournal();
    // Seen earlier in this session: show what it had at once, then catch up with git.
    const snap = snapshots.get(pathKey(path));
    if (snap) {
      snapshots.delete(pathKey(path));
      registerTab(snap.info);
      set({
        ...emptyRepo,
        ...journalOf(snap.info.path),
        tabs: get().tabs,
        path: snap.info.path,
        info: snap.info,
        commits: snap.commits,
        graph: snap.graph,
        refs: snap.refs,
        worktrees: snap.worktrees,
        view: snap.view,
        hasMore: snap.hasMore,
        selection: { type: 'wip' },
        loading: false,
      });
      loadedAt = snap.at;
      if (snap.selection && snap.selection.type !== 'wip') void get().select(snap.selection);
      if (Date.now() - snap.at < SNAPSHOT_FRESH_MS) void get().refreshStatus();
      else void get().refresh();
      void loadRest(snap.info.path);
      return true;
    }
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
    const tabs = registerTab(info, opts);
    // Called by open() (which already put the previous history aside) or directly.
    if (get().path && !samePath(get().path!, info.path)) keepJournal();
    set({
      ...emptyRepo,
      ...journalOf(info.path),
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
    if (get().path === info.path) {
      set({ loading: false });
      void loadRest(info.path);
    }
  },

  newTab: () => {
    saveTabs(get().tabs, null);
    keepJournal();
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
    // A closed repository's history goes with its tab.
    journals.delete(pathKey(path));
    snapshots.delete(pathKey(path));
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
      if (opts?.fresh) pending.fresh = true;
      return pending.done;
    }
    const entry = { path, again: false, fresh: !!opts?.fresh, done: Promise.resolve() };
    entry.done = (async () => {
      let first = !!opts?.first;
      do {
        entry.again = false;
        const fresh = entry.fresh;
        entry.fresh = false;
        await loadRepo(path, first, fresh);
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

  loadMore: async (count) => {
    if (morePending) return morePending;
    const { path, commits, graph, view, refs } = get();
    if (!path) return;
    const want = count ?? page();
    morePending = (async () => {
      // Stash rows are not history: page by real commits only, then re-place the stashes.
      const real = commits.filter((c) => !c.stash);
      const more = await api.log(path, want, real.length, logView(view));
      // Another tab, or a refresh replaced the list meanwhile: this page no longer fits.
      if (get().path !== path || get().commits !== commits) return;
      set({
        ...appendCommits({ commits, graph }, more, view, refs),
        hasMore: more.length >= want,
      });
    })().finally(() => {
      morePending = null;
    });
    return morePending;
  },

  setView: async (v) => {
    const path = get().path;
    if (!path) return;
    saveView(path, v);
    set({ view: v });
    // Other commits show now: the ones loaded below the first page no longer fit.
    await get().refresh({ fresh: true });
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

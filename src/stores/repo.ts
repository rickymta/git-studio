import { create } from 'zustand';

import {
  carryIndex,
  extendGraph,
  hashIndex,
  layoutGraph,
  withStashes,
  type GraphRow,
} from '@/lib/graph';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type {
  Commit,
  CommitDetail,
  DiffRequest,
  Refs,
  RepoInfo,
  RepoStamp,
  SavedPage,
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

let graphScrolling = false;
/**
 * The commit list is being scrolled, or its scrollbar held: pages loading in the background wait,
 * so the list does not grow (and the scrollbar thumb jump) under the pointer.
 */
export function setGraphScrolling(on: boolean) {
  graphScrolling = on;
}
const scrollSettled = async () => {
  while (graphScrolling) await sleep(100);
};

/** The same repository state, field for field. */
export const sameInfo = (a: RepoInfo, b: RepoInfo) => JSON.stringify(a) === JSON.stringify(b);

/** Loaded commits kept (and laid out again) by a refresh; older ones load again behind. */
export const KEEP_ON_REFRESH = 20_000;

/** Commits in a list that are not stash rows. */
const realCount = (commits: Commit[]) => {
  let n = 0;
  for (const c of commits) if (!c.stash) n++;
  return n;
};

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
      await scrollSettled();
      const loaded = s.commits.length;
      await s.loadMore(Math.min(REST_MAX, Math.max(REST_MIN, Math.round(loaded / 2))), {
        background: true,
      });
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

export type DiffOpenMode = 'file' | 'history' | 'blame';

export interface OpenDiff {
  request: DiffRequest;
  text: string;
  loading: boolean;
  /** Opened straight into File View / History / Blame (Spotlight); `id` remounts the view. */
  view?: { id: number; mode: DiffOpenMode };
}

let diffViewId = 0;

export interface RepoTab {
  path: string;
  name: string;
  /** Pinned tabs stay first and survive "Close others" / "Close all". */
  pinned?: boolean;
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
  adopt: (
    info: RepoInfo,
    opts?: { keepOutOfWorkspace?: boolean; saved?: Promise<SavedPage | null> },
  ) => Promise<void>;
  /**
   * The "New tab" tab is shown: the start page, as a tab of its own that can be closed. Opening
   * a repository from it puts the repository in its place.
   */
  newTabOpen: boolean;
  /** Show the start page in a new tab (current repository tab stays open). */
  newTab: () => void;
  /** Close the "New tab" tab and go back to the tab shown before it. */
  closeNewTab: () => void;
  /** Show the active workspace's overview (no repository, no "New tab"). */
  showOverview: () => void;
  closeTab: (path: string) => void;
  /** Close several tabs at once (one save, one switch if the shown tab is among them). */
  closeTabs: (paths: string[]) => void;
  /** Open the most recently closed tab of this scope again. */
  reopenClosedTab: () => void;
  /** Pin or unpin a tab; pinned tabs are kept before the others. */
  pinTab: (path: string, pinned: boolean) => void;
  /** Move the tab at `from` to `to`. `pinned`: its pinned state afterwards (default: that of the
   *  tab it lands after, or before when first). */
  moveTab: (from: number, to: number, pinned?: boolean) => void;
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
  /**
   * Reload what changed since the last look, from the change stamp: everything when refs moved
   * (a merge, commit, fetch, branch or tag made anywhere), the status when only the index was
   * written. `status`: read the status anyway (edited files do not change the stamp).
   */
  checkChanges: (opts?: { status?: boolean }) => Promise<void>;
  /** Load the next `count` commits (default: a page) below the loaded ones. */
  /** `background`: the rest of the history loading by itself (waits while the list scrolls). */
  loadMore: (count?: number, opts?: { background?: boolean }) => Promise<void>;
  select: (s: Selection | null) => Promise<void>;
  /** Select `hash` in the graph, loading older pages if it is not loaded yet. */
  reveal: (hash: string) => Promise<void>;
  openDiff: (request: DiffRequest, mode?: DiffOpenMode) => Promise<void>;
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

/** Pinned tabs first, each group keeping its order. */
const pinnedFirst = (tabs: RepoTab[]) => [
  ...tabs.filter((t) => t.pinned),
  ...tabs.filter((t) => !t.pinned),
];

/**
 * Recently closed tabs per scope, newest last (Ctrl+Shift+T). Tabs closed together ("Close
 * others", "Close clean tabs"…) come back together. `show`: the tab to open again (the one
 * shown when they closed; null keeps the shown tab).
 */
const closedTabs = new Map<
  string,
  { tabs: { tab: RepoTab; index: number }[]; show: string | null }[]
>();
const CLOSED_MAX = 25;
function rememberClosed(tabs: { tab: RepoTab; index: number }[], show: string | null) {
  const list = closedTabs.get(scope) ?? [];
  list.push({ tabs, show });
  if (list.length > CLOSED_MAX) list.shift();
  closedTabs.set(scope, list);
}
export const canReopenTab = () => (closedTabs.get(scope)?.length ?? 0) > 0;

/** Tab paths of each scope, most recently shown first (Ctrl+Tab). */
const recentByScope = new Map<string, string[]>();
function touchRecent(path: string) {
  const list = (recentByScope.get(scope) ?? []).filter((p) => !samePath(p, path));
  list.unshift(path);
  recentByScope.set(scope, list.slice(0, 500));
}
/** The open tabs, most recently shown first; tabs not shown this session follow in tab order. */
export function tabsByRecent(tabs: RepoTab[]): RepoTab[] {
  const order = recentByScope.get(scope) ?? [];
  const rank = new Map(order.map((p, i) => [pathKey(p), i]));
  return tabs
    .map((t, i) => ({ t, r: rank.get(pathKey(t.path)) ?? order.length + i }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.t);
}

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
/** HEAD's commit when there are uncommitted changes: the graph gives them a row of their own. */
export function wipHead(info: RepoInfo | null): string | null {
  const st = info?.status;
  if (!st?.head) return null;
  const n = (st.staged?.length ?? 0) + (st.unstaged?.length ?? 0) + (st.conflicted?.length ?? 0);
  return n > 0 ? st.head : null;
}

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
  newTabOpen: false,
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

/** The change stamp each repository had when it was last loaded (see `checkChanges`). */
const stamps = new Map<string, RepoStamp>();
async function readStamp(path: string): Promise<RepoStamp | null> {
  try {
    return await api.repoStamp(path);
  } catch {
    return null;
  }
}

/** Bumped each time a full status lands, so an older one arriving later is dropped. */
let infoSeq = 0;

/**
 * Take a freshly read status: the WIP row comes or goes with the changes, which moves lanes, so
 * the graph is laid out again when that changes.
 */
function applyInfo(path: string, info: RepoInfo) {
  const s = useRepo.getState();
  if (s.path !== path) return;
  infoSeq++;
  if (wipHead(s.info) !== wipHead(info)) {
    useRepo.setState({
      info,
      graph: layoutGraph(s.commits, pinnedTips(s.view, s.refs), wipHead(info)),
    });
  } else useRepo.setState({ info });
}

/** The status after a quick open, read while the graph is already on screen. */
async function followStatus(path: string) {
  const seq = infoSeq;
  const info = await api.info(path).catch(() => null);
  // A refresh meanwhile brought a newer status: keep that one.
  if (info && seq === infoSeq) applyInfo(path, info);
}

/** When each repository's first screen was last written to disk (once a minute at most). */
const pageSaved = new Map<string, number>();
const PAGE_SAVE_EVERY_MS = 60_000;
/** Messages are kept short in the saved page: it only has to fill the screen for a moment. */
const PAGE_BODY_CHARS = 300;

/** Keep the shown repository's first screen on disk, to show it at once next time. */
function savePage(path: string) {
  const key = pathKey(path);
  const last = pageSaved.get(key) ?? 0;
  if (Date.now() - last < PAGE_SAVE_EVERY_MS) return;
  const s = useRepo.getState();
  if (s.path !== path || !s.refs) return;
  pageSaved.set(key, Date.now());
  const commits = s.commits
    .filter((c) => !c.stash)
    .slice(0, FIRST_PAGE)
    .map((c) =>
      c.body && c.body.length > PAGE_BODY_CHARS
        ? { ...c, body: c.body.slice(0, PAGE_BODY_CHARS) }
        : c,
    );
  void api
    .savePage(path, { commits, refs: s.refs, worktrees: s.worktrees, at: Date.now() })
    .catch(() => pageSaved.delete(key));
}

/**
 * Load the repository at `path` into the store: status, refs, worktrees and the newest page of
 * the graph's commits, keeping the older ones already loaded below it (`first`: a short first
 * page, without waiting for the status, which follows; `fresh`: only the new page).
 */
async function loadRepo(path: string, first: boolean, fresh = false) {
  try {
    const limit = first ? Math.min(page(), FIRST_PAGE) : page();
    const view = loadView(path);
    // One call for history, refs and worktrees (read at the same time). The first load does not
    // wait for `git status`: the graph shows first and the changed files follow.
    // The stamp is read before git: a change made while this load runs shows up next time.
    const [loaded, fullInfo, stamp] = await Promise.all([
      api.load(path, limit, 0, logView(view)),
      first ? null : api.info(path),
      readStamp(path),
    ]);
    const { commits, refs, worktrees } = loaded;
    if (useRepo.getState().path !== path) return;
    if (fullInfo) infoSeq++;
    const info = fullInfo ?? useRepo.getState().info!;
    const before = useRepo.getState();
    const older = before.commits.filter((c) => !c.stash);
    // Scrolled further than a page: keep those commits under the new page. At most KEEP_ON_REFRESH
    // of them: the whole graph is laid out again here, on the UI thread, after every operation
    // (pull, commit, …); with hundreds of thousands of commits loaded that froze the app for
    // seconds. The rest comes back in the background, page by page, as on opening.
    const kept =
      !first && !fresh && commits.length >= limit && older.length > commits.length
        ? keepOlder(commits, older.slice(0, KEEP_ON_REFRESH))
        : null;
    const cut = !!kept && older.length > KEEP_ON_REFRESH;
    const all = kept ?? commits;
    const rows = withStashes(all, shownStashes(view, refs));
    useRepo.setState({
      info,
      commits: rows,
      view,
      graph: layoutGraph(rows, pinnedTips(view, refs), wipHead(info)),
      refs,
      worktrees,
      hasMore: kept ? before.hasMore || cut : commits.length >= limit,
    });
    if (stamp) stamps.set(pathKey(path), stamp);
    if (first) void followStatus(path);
    savePage(path);
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
  // Fast path, the usual one: the new page goes after what is there. Only the new rows are
  // looked at; on long histories a full pass per page froze the list for a second at 500,000
  // commits (scrolling while the rest of the history loads).
  if (view.pinned.length === 0 && prev.commits.length > 0) {
    const index = hashIndex(prev.commits);
    const fresh = more.filter((c) => !index.has(c.hash));
    const freshHashes = new Set(fresh.map((c) => c.hash));
    // A stash whose base only arrives now may belong higher up: that needs the full pass.
    const moved = shownStashes(view, refs).some(
      (st) => !index.has(st.hash) && !!st.base && freshHashes.has(st.base),
    );
    const graph = moved ? null : extendGraph(prev.graph, fresh);
    if (graph) {
      const commits = prev.commits.concat(fresh);
      carryIndex(prev.commits, commits);
      return { commits, graph };
    }
  }
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
    layoutGraph(commits, pinnedTips(view, refs), wipHead(useRepo.getState().info));
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
  touchRecent(info.path);
  const tabs = [...useRepo.getState().tabs];
  const i = tabs.findIndex((t) => samePath(t.path, info.path));
  if (i >= 0) tabs[i] = { ...tabs[i], path: info.path, name: info.name };
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
  newTabOpen: false,
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
    const fromNewTab = get().newTabOpen;
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
      // Seen recently: reload only if git changed something meanwhile (a merge in another
      // tab or tool moves refs the status alone does not show).
      if (Date.now() - snap.at < SNAPSHOT_FRESH_MS) void get().checkChanges({ status: true });
      else void get().refresh();
      void loadRest(snap.info.path);
      return true;
    }
    // Switch at once: the new tab shows a spinner instead of the previous repository staying
    // on screen (and seemingly frozen) until the new one has loaded.
    set({ ...emptyRepo, path, loading: true });
    try {
      // The page saved last time is read meanwhile, to show the graph before git answers.
      const saved = api.loadPage(path).catch(() => null);
      const info = await api.open(path, true);
      if (seq !== openSeq) return true;
      await get().adopt(info, { saved });
      return true;
    } catch (e) {
      if (seq !== openSeq) return false;
      toast('error', t('Could not open repository'), (e as Error).message);
      // Back where it was: the previous repository, or the "New tab" it was opened from.
      set({ ...emptyRepo, loading: false, newTabOpen: !prev && fromNewTab });
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
    // Seen before (also in an earlier run): its saved first screen shows while git answers.
    const saved = opts?.saved ? await opts.saved : null;
    if (saved && get().path === info.path && get().commits.length === 0) {
      const view = loadView(info.path);
      const rows = withStashes(saved.commits, shownStashes(view, saved.refs));
      set({
        commits: rows,
        view,
        graph: layoutGraph(rows, pinnedTips(view, saved.refs)),
        refs: saved.refs,
        worktrees: saved.worktrees,
        hasMore: true,
      });
    }
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
    set({ ...emptyRepo, newTabOpen: true });
    void get().loadSettings();
  },

  closeNewTab: () => {
    if (!get().newTabOpen || get().path) return;
    set({ newTabOpen: false });
    const next = tabsByRecent(get().tabs)[0];
    if (next) void get().open(next.path);
  },

  showOverview: () => {
    saveTabs(get().tabs, null);
    keepJournal();
    set({ ...emptyRepo });
    void get().loadSettings();
  },

  closeTab: (path) => get().closeTabs([path]),

  closeTabs: (paths) => {
    const tabs = get().tabs;
    const gone = new Set(paths.map(pathKey));
    if (!tabs.some((t) => gone.has(pathKey(t.path)))) return;
    const cur = get().path;
    const curIdx = cur ? tabs.findIndex((t) => samePath(t.path, cur)) : -1;
    const rest = tabs.filter((t) => !gone.has(pathKey(t.path)));
    const wasCurrent = !!cur && gone.has(pathKey(cur));
    const closed = tabs
      .map((tab, index) => ({ tab, index }))
      .filter((x) => gone.has(pathKey(x.tab.path)));
    rememberClosed(closed, wasCurrent ? cur : null);
    saveTabs(rest, wasCurrent ? null : cur);
    set({ tabs: rest });
    recentByScope.set(
      scope,
      (recentByScope.get(scope) ?? []).filter((p) => !gone.has(pathKey(p))),
    );
    // A closed repository's history goes with its tab.
    for (const k of gone) {
      journals.delete(k);
      snapshots.delete(k);
    }
    if (!wasCurrent) return;
    // Next: the tab shown before it, else the one that took its place.
    const next = tabsByRecent(rest)[0] ?? rest[Math.min(Math.max(curIdx, 0), rest.length - 1)];
    set({ ...emptyRepo });
    if (next) void get().open(next.path);
    else void get().loadSettings();
  },

  reopenClosedTab: () => {
    const last = closedTabs.get(scope)?.pop();
    if (!last) return;
    const next = [...get().tabs];
    // Ascending original positions, so each lands where it was.
    for (const { tab, index } of last.tabs) {
      if (next.some((t) => samePath(t.path, tab.path))) continue;
      next.splice(Math.min(index, next.length), 0, tab);
    }
    const ordered = pinnedFirst(next);
    saveTabs(ordered, get().path);
    set({ tabs: ordered });
    if (last.show) void get().open(last.show);
  },

  pinTab: (path, pinned) => {
    const tabs = get().tabs;
    const i = tabs.findIndex((t) => samePath(t.path, path));
    if (i < 0 || !!tabs[i]!.pinned === pinned) return;
    const tab = { ...tabs[i]!, pinned: pinned || undefined };
    const rest = tabs.filter((_, j) => j !== i);
    // A newly pinned tab goes last among the pinned; an unpinned one first among the others.
    rest.splice(rest.filter((t) => t.pinned).length, 0, tab);
    saveTabs(rest, get().path);
    set({ tabs: rest });
  },

  addTabs: (more) => {
    const tabs = [...get().tabs];
    for (const t of more) if (!tabs.some((x) => samePath(x.path, t.path))) tabs.push(t);
    saveTabs(tabs, get().path);
    set({ tabs });
  },

  moveTab: (from, to, pinned) => {
    const tabs = [...get().tabs];
    const [t] = tabs.splice(from, 1);
    if (!t) return;
    // Dropped right after a pinned tab (or first, before one) it is pinned; otherwise not.
    const neighbour = to > 0 ? tabs[to - 1] : tabs[0];
    tabs.splice(to, 0, { ...t, pinned: (pinned ?? neighbour?.pinned) || undefined });
    const ordered = pinnedFirst(tabs);
    saveTabs(ordered, get().path);
    set({ tabs: ordered });
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
    if (Date.now() - loadedAt < FOCUS_REFRESH_MS) await get().checkChanges({ status: true });
    else await get().refresh();
  },

  checkChanges: async (opts) => {
    const path = get().path;
    if (!path || get().busy || !get().info) return;
    // A refresh in flight brings everything anyway.
    if (pending && samePath(pending.path, path)) return;
    const stamp = await readStamp(path);
    if (get().path !== path) return;
    const key = pathKey(path);
    const old = stamps.get(key);
    if (stamp) stamps.set(key, stamp);
    if (stamp && old && old.refs !== stamp.refs) await get().refresh();
    else if (opts?.status || (stamp && old && old.index !== stamp.index))
      await get().refreshStatus();
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
      // Nothing changed (the usual case, every few seconds): keep the same object, so nothing
      // that shows the status renders again.
      if (prev && sameInfo(prev, info)) return;
      // Only a status refresh when nothing about refs changed.
      if (
        prev &&
        prev.status.head === info.status.head &&
        prev.status.branch === info.status.branch
      ) {
        // Changes appeared or were all committed / discarded: the WIP row comes or goes.
        if (wipHead(prev) !== wipHead(info)) {
          const { commits, view, refs } = get();
          set({ info, graph: layoutGraph(commits, pinnedTips(view, refs), wipHead(info)) });
        } else set({ info });
      } else {
        await get().refresh();
      }
    } catch {
      /* repo may be mid-operation; next refresh will catch up */
    }
  },

  loadMore: async (count, opts) => {
    if (morePending) return morePending;
    const { path, commits, view } = get();
    if (!path) return;
    const want = count ?? page();
    morePending = (async () => {
      // Stash rows are not history: page by real commits only, then re-place the stashes.
      const more = await api.log(path, want, realCount(commits), logView(view));
      if (opts?.background) await scrollSettled();
      // Another tab, or a refresh replaced the list meanwhile: this page no longer fits.
      if (get().path !== path || get().commits !== commits) return;
      const { graph, refs } = get();
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

  openDiff: async (request, mode) => {
    const path = get().path;
    if (!path) return;
    const prev = get().diff;
    // A reload of the same file keeps the view it was opened in.
    const view = mode
      ? { id: ++diffViewId, mode }
      : prev?.request.path === request.path
        ? prev.view
        : undefined;
    set({ diff: { request, text: prev?.text ?? '', loading: true, view } });
    try {
      const text = await api.diff(path, request);
      if (get().diff?.request === request) set({ diff: { request, text, loading: false, view } });
    } catch (e) {
      set({ diff: { request, text: '', loading: false, view } });
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

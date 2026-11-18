import { create } from 'zustand';

import { layoutGraph, type GraphRow } from '@/lib/graph';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { Commit, CommitDetail, DiffRequest, Refs, RepoInfo, Settings } from '@/lib/types';
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

const emptyRepo = {
  path: null,
  info: null,
  commits: [],
  graph: [],
  refs: null,
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
      const limit = Math.max(page(), get().commits.length);
      const [info, commits, refs] = await Promise.all([
        api.info(path),
        api.log(path, limit),
        api.refs(path),
      ]);
      if (get().path !== path) return;
      set({ info, commits, graph: layoutGraph(commits), refs, hasMore: commits.length >= limit });
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
    const { path, commits } = get();
    if (!path) return;
    const more = await api.log(path, page(), commits.length);
    const all = [...commits, ...more];
    set({ commits: all, graph: layoutGraph(all), hasMore: more.length >= page() });
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

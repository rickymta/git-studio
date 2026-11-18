import { create } from 'zustand';

import { layoutGraph, type GraphRow } from '@/lib/graph';
import { api } from '@/lib/ipc';
import type { Commit, CommitDetail, DiffRequest, Refs, RepoInfo, Settings } from '@/lib/types';
import { toast } from './ui';

const PAGE = 1500;

export type Selection = { type: 'wip' } | { type: 'commit'; hash: string };

export interface OpenDiff {
  request: DiffRequest;
  text: string;
  loading: boolean;
}

interface RepoStore {
  settings: Settings | null;
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

  loadSettings: () => Promise<void>;
  setSettings: (s: Settings) => void;
  open: (path: string) => Promise<boolean>;
  adopt: (info: RepoInfo) => Promise<void>;
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
}

export const useRepo = create<RepoStore>((set, get) => ({
  settings: null,
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

  loadSettings: async () => {
    try {
      set({ settings: await api.settings() });
    } catch (e) {
      toast('error', 'Could not load settings', (e as Error).message);
    }
  },
  setSettings: (settings) => set({ settings }),

  open: async (path) => {
    set({ loading: true });
    try {
      const info = await api.open(path);
      await get().adopt(info);
      return true;
    } catch (e) {
      toast('error', 'Could not open repository', (e as Error).message);
      set({ loading: false });
      return false;
    }
  },

  adopt: async (info) => {
    set({
      path: info.path,
      info,
      commits: [],
      graph: [],
      refs: null,
      selection: { type: 'wip' },
      detail: null,
      diff: null,
      loading: true,
    });
    try {
      localStorage.setItem('gitstudio.lastRepo', info.path);
    } catch {
      /* ignore */
    }
    await get().refresh();
    set({ loading: false });
    void get().loadSettings();
  },

  close: () => {
    try {
      localStorage.removeItem('gitstudio.lastRepo');
    } catch {
      /* ignore */
    }
    set({
      path: null,
      info: null,
      commits: [],
      graph: [],
      refs: null,
      selection: null,
      detail: null,
      diff: null,
    });
    void get().loadSettings();
  },

  refresh: async () => {
    const path = get().path;
    if (!path) return;
    try {
      const limit = Math.max(PAGE, get().commits.length);
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
      toast('error', 'Refresh failed', (e as Error).message);
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
    const more = await api.log(path, PAGE, commits.length);
    const all = [...commits, ...more];
    set({ commits: all, graph: layoutGraph(all), hasMore: more.length >= PAGE });
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
      toast('error', 'Could not load commit', (e as Error).message);
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
      toast('error', 'Could not load diff', (e as Error).message);
    }
  },

  reloadDiff: async () => {
    const d = get().diff;
    const info = get().info;
    if (!d || !info) return;
    // A working-tree file that left its list (staged/committed/discarded) closes its diff.
    if (d.request.source !== 'commit') {
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
    try {
      await fn(path);
      ok = true;
      if (success) toast('success', success);
    } catch (e) {
      toast('error', `${label} failed`, (e as Error).message);
    } finally {
      set({ busy: null });
      await get().refresh();
    }
    return ok;
  },
}));

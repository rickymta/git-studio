import { create } from 'zustand';

import * as F from '@/features/workspace/folders';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { RepoSummary, Workspace, Workspaces } from '@/lib/types';
import { setTabOpenedHandler, useRepo } from './repo';
import { toast } from './ui';

export const WORKSPACE_COLORS = [
  '#38bdf8',
  '#a78bfa',
  '#f472b6',
  '#fb923c',
  '#facc15',
  '#4ade80',
  '#2dd4bf',
  '#f87171',
];

export type BulkOp = 'fetch' | 'pull';

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
export const samePath = (a: string, b: string) => norm(a) === norm(b);

interface WorkspaceStore {
  data: Workspaces;
  loaded: boolean;
  summaries: Record<string, RepoSummary>;
  summariesLoading: boolean;
  /** Repos with an operation in flight, keyed by normalised path. */
  running: Record<string, BulkOp>;
  /** Folder of the active workspace that new repositories go into ('' for the root). */
  addTarget: string;

  load: () => Promise<void>;
  active: () => Workspace | null;
  create: (name: string, color: string, repos: string[]) => Promise<Workspace>;
  update: (id: string, patch: Partial<Omit<Workspace, 'id'>>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Adds repositories to `folder` (default: `addTarget` of the active workspace). */
  addRepos: (id: string, paths: string[], folder?: string) => Promise<number>;
  setAddTarget: (folder: string) => void;
  addFolder: (id: string, parent: string, name: string) => Promise<string | null>;
  renameFolder: (id: string, folder: string, name: string) => Promise<void>;
  toggleFolder: (id: string, folder: string, collapsed?: boolean) => Promise<void>;
  moveFolder: (id: string, folder: string, parent: string) => Promise<void>;
  deleteFolder: (id: string, folder: string) => Promise<void>;
  moveRepos: (id: string, paths: string[], folder: string) => Promise<void>;
  removeRepo: (id: string, path: string) => Promise<void>;
  /** Activate a workspace ('' for none); swaps the open tabs to that workspace's set. */
  activate: (id: string) => Promise<void>;
  refreshSummaries: (paths?: string[]) => Promise<void>;
  /** Quietly re-read the status of these repositories (tab badges): no spinner, no error toast. */
  refreshTabStatus: (paths: string[]) => Promise<void>;
  bulk: (op: BulkOp, paths: string[]) => Promise<void>;
}

const newId = () => Math.random().toString(36).slice(2, 10);

export const useWorkspaces = create<WorkspaceStore>((set, get) => {
  const persist = async (data: Workspaces) => {
    set({ data });
    try {
      set({ data: await api.saveWorkspaces(data) });
    } catch (e) {
      toast('error', t('Could not save workspaces'), (e as Error).message);
    }
  };

  /** Applies a pure edit to one workspace and saves. */
  const editWs = async (id: string, edit: (w: Workspace) => Workspace) => {
    const data = get().data;
    const ws = data.items.find((w) => w.id === id);
    if (!ws) return;
    const next = edit(ws);
    if (next === ws) return;
    await persist({ ...data, items: data.items.map((w) => (w.id === id ? next : w)) });
  };

  return {
    data: { items: [], active: '' },
    loaded: false,
    summaries: {},
    summariesLoading: false,
    running: {},
    addTarget: '',

    load: async () => {
      try {
        const data = await api.workspaces();
        data.items = data.items.map(F.sanitize);
        if (data.active && !data.items.some((w) => w.id === data.active)) data.active = '';
        set({ data, loaded: true });
      } catch {
        set({ loaded: true });
      }
    },

    active: () => {
      const { data } = get();
      return data.items.find((w) => w.id === data.active) ?? null;
    },

    create: async (name, color, repos) => {
      const ws: Workspace = { id: newId(), name: name.trim(), color, repos: dedupe(repos) };
      await persist({ ...get().data, items: [...get().data.items, ws] });
      await get().activate(ws.id);
      return ws;
    },

    update: async (id, patch) => {
      const data = get().data;
      await persist({
        ...data,
        items: data.items.map((w) => (w.id === id ? { ...w, ...patch } : w)),
      });
    },

    remove: async (id) => {
      const data = get().data;
      const wasActive = data.active === id;
      await persist({
        items: data.items.filter((w) => w.id !== id),
        active: wasActive ? '' : data.active,
      });
      try {
        localStorage.removeItem(`gitstudio.tabs.${id}`);
        localStorage.removeItem(`gitstudio.lastRepo.${id}`);
      } catch {
        /* ignore */
      }
      if (wasActive) useRepo.getState().setScope('');
    },

    addRepos: async (id, paths, folder) => {
      const ws = get().data.items.find((w) => w.id === id);
      if (!ws) return 0;
      const merged = dedupe([...ws.repos, ...paths]);
      const added = merged.length - ws.repos.length;
      const target = folder ?? (get().data.active === id ? get().addTarget : '');
      const fresh = merged.slice(ws.repos.length);
      const placed =
        target && (ws.folders ?? []).some((f) => f.id === target)
          ? F.moveRepos(ws, fresh, target).placement
          : ws.placement;
      await get().update(id, { repos: merged, placement: placed });
      if (added > 0) void get().refreshSummaries(merged.slice(ws.repos.length));
      return added;
    },

    removeRepo: async (id, path) => {
      const ws = get().data.items.find((w) => w.id === id);
      if (!ws) return;
      const placement = { ...(ws.placement ?? {}) };
      delete placement[F.placeKey(path)];
      await get().update(id, { repos: ws.repos.filter((p) => !samePath(p, path)), placement });
    },

    setAddTarget: (folder) => set({ addTarget: folder }),

    addFolder: async (id, parent, name) => {
      const ws = get().data.items.find((w) => w.id === id);
      if (!ws || !name.trim() || !F.canNest(ws.folders ?? [], parent)) return null;
      const fid = newId();
      await editWs(id, (w) => F.addFolder(w, parent, name, fid));
      return fid;
    },
    renameFolder: (id, folder, name) =>
      editWs(id, (w) => (name.trim() ? F.patchFolder(w, folder, { name: name.trim() }) : w)),
    toggleFolder: (id, folder, collapsed) =>
      editWs(id, (w) => {
        const f = (w.folders ?? []).find((x) => x.id === folder);
        return f ? F.patchFolder(w, folder, { collapsed: collapsed ?? !f.collapsed }) : w;
      }),
    moveFolder: (id, folder, parent) => editWs(id, (w) => F.moveFolder(w, folder, parent)),
    deleteFolder: async (id, folder) => {
      await editWs(id, (w) => F.deleteFolder(w, folder));
      const ws = get().data.items.find((w) => w.id === id);
      if (get().data.active === id && !(ws?.folders ?? []).some((f) => f.id === get().addTarget))
        set({ addTarget: '' });
    },
    moveRepos: (id, paths, folder) => editWs(id, (w) => F.moveRepos(w, paths, folder)),

    activate: async (id) => {
      if (get().data.active === id) {
        // Re-selecting the active workspace shows its overview.
        if (id) useRepo.getState().showOverview();
        return;
      }
      set({ addTarget: '' });
      await persist({ ...get().data, active: id });
      await useRepo.getState().setScope(id);
      if (id) void get().refreshSummaries();
    },

    refreshSummaries: async (paths) => {
      const ws = get().active();
      const list = paths ?? ws?.repos ?? [];
      if (list.length === 0) return;
      set({ summariesLoading: true });
      try {
        const res = await api.workspaceStatus(list);
        const next = mergeSummaries(get().summaries, res);
        if (next) set({ summaries: next });
      } catch (e) {
        toast('error', t('Could not read repository status'), (e as Error).message);
      } finally {
        set({ summariesLoading: false });
      }
    },

    refreshTabStatus: async (paths) => {
      if (paths.length === 0) return;
      try {
        const res = await api.workspaceStatus(paths);
        const next = mergeSummaries(get().summaries, res);
        if (next) set({ summaries: next });
      } catch {
        /* badges just stay as they were */
      }
    },

    bulk: async (op, paths) => {
      const label = op === 'fetch' ? t('Fetch') : t('Pull');
      const failures: string[] = [];
      let done = 0;
      const queue = [...paths];
      const worker = async () => {
        for (let p = queue.shift(); p; p = queue.shift()) {
          const key = norm(p);
          set((s) => ({ running: { ...s.running, [key]: op } }));
          try {
            // Pull is fast-forward only in bulk: never creates merge commits behind your back.
            if (op === 'fetch') await api.fetch(p);
            else await api.pull(p, 'ff-only');
            done++;
          } catch (e) {
            failures.push(`${p.split(/[\\/]/).pop()}: ${(e as Error).message.split('\n')[0]}`);
          } finally {
            set((s) => {
              const running = { ...s.running };
              delete running[key];
              return { running };
            });
            void get().refreshSummaries([p]);
          }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      if (failures.length === 0)
        toast(
          'success',
          done === 1
            ? t('{label}: {n} repository done', { label, n: done })
            : t('{label}: {n} repositories done', { label, n: done }),
        );
      else
        toast(
          'error',
          t('{label}: {done} done, {failed} failed', { label, done, failed: failures.length }),
          failures.join('\n'),
        );
      const cur = useRepo.getState().path;
      if (cur && paths.some((p) => samePath(p, cur))) void useRepo.getState().refresh();
    },
  };
});

/**
 * `res` merged into `prev`, keeping the objects of repositories whose status did not change (so
 * their tab badges and rows do not render again); null when nothing changed at all.
 */
function mergeSummaries(
  prev: Record<string, RepoSummary>,
  res: RepoSummary[],
): Record<string, RepoSummary> | null {
  let next: Record<string, RepoSummary> | null = null;
  for (const s of res) {
    const k = norm(s.path);
    const old = prev[k];
    if (old && JSON.stringify(old) === JSON.stringify(s)) continue;
    next ??= { ...prev };
    next[k] = s;
  }
  return next;
}

function dedupe(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const k = norm(p);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  }
  return out;
}

export const summaryKey = norm;

// A repository opened in a new tab while a workspace is active joins that workspace, so the
// workspace's overview lists every repository open in it.
setTabOpenedHandler((path, name) => {
  const store = useWorkspaces.getState();
  const ws = store.active();
  if (!ws || ws.repos.some((r) => samePath(r, path))) return;
  void store.addRepos(ws.id, [path]).then((n) => {
    if (n) toast('success', t('Added {name} to {workspace}', { name, workspace: ws.name }));
  });
});

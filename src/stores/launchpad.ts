import { create } from 'zustand';

import {
  EMPTY_PREFS,
  parsePrefs,
  pruneSnoozes,
  type HostId,
  type LaunchPrefs,
  type SavedView,
  type Snooze,
  type Tab,
  type ViewFilter,
} from '@/features/launchpad/model';
import { api } from '@/lib/ipc';
import type { LaunchItem } from '@/lib/types';
import { useGitHub } from './github';
import { useGitLab } from './gitlab';

/** Pins, snoozes and saved views. `gitstudio.*` keys are mirrored to ui-state.json (persist.ts),
 *  so they survive restarts and clearing the webview's storage. */
const PREFS_KEY = 'gitstudio.launchpad';
/** Background refresh for the tab's badge. */
const POLL_MS = 5 * 60_000;

export type RepoScope = 'workspace' | 'all';

interface LaunchpadStore {
  open: boolean;
  tab: Tab;
  items: Record<HostId, LaunchItem[] | null>;
  errors: Partial<Record<HostId, string>>;
  loading: boolean;
  loadedAt: number | null;
  prefs: LaunchPrefs;
  /** Which repositories WIPs and Branches look at: the active workspace or every workspace. */
  scope: RepoScope;
  setOpen: (open: boolean) => void;
  setTab: (tab: Tab) => void;
  setScope: (scope: RepoScope) => void;
  /** Reload from every host the user is signed in to. */
  load: () => Promise<void>;
  togglePin: (id: string) => void;
  snooze: (item: LaunchItem, until: number | null) => void;
  unsnooze: (id: string) => void;
  saveView: (name: string, filter: ViewFilter) => SavedView;
  deleteView: (id: string) => void;
}

function readPrefs(): LaunchPrefs {
  try {
    return parsePrefs(localStorage.getItem(PREFS_KEY));
  } catch {
    return EMPTY_PREFS;
  }
}

function readScope(): RepoScope {
  try {
    return localStorage.getItem('gitstudio.launchpad.scope') === 'all' ? 'all' : 'workspace';
  } catch {
    return 'workspace';
  }
}

const newId = () => Math.random().toString(36).slice(2, 10);

let loadSeq = 0;

export const useLaunchpad = create<LaunchpadStore>((set, get) => {
  const savePrefs = (prefs: LaunchPrefs) => {
    set({ prefs });
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  };

  return {
    open: false,
    tab: 'prs',
    items: { github: null, gitlab: null },
    errors: {},
    loading: false,
    loadedAt: null,
    prefs: readPrefs(),
    scope: readScope(),

    setOpen: (open) => {
      set({ open });
      // Opening shows fresh data unless it was loaded a moment ago.
      const at = get().loadedAt;
      if (open && !get().loading && (!at || Date.now() - at > 60_000)) void get().load();
    },
    setTab: (tab) => set({ tab }),
    setScope: (scope) => {
      set({ scope });
      try {
        localStorage.setItem('gitstudio.launchpad.scope', scope);
      } catch {
        /* ignore */
      }
    },

    load: async () => {
      const seq = ++loadSeq;
      const gh = !!useGitHub.getState().user;
      const gl = !!useGitLab.getState().user;
      set({ loading: true });
      const run = async (host: HostId, enabled: boolean, fetch: () => Promise<LaunchItem[]>) => {
        if (!enabled) return { host, items: null, error: undefined };
        try {
          return { host, items: await fetch(), error: undefined };
        } catch (e) {
          return { host, items: get().items[host], error: (e as Error).message };
        }
      };
      const results = await Promise.all([
        run('github', gh, api.launchpadGitHub),
        run('gitlab', gl, api.launchpadGitLab),
      ]);
      if (seq !== loadSeq) return;
      const items = { ...get().items };
      const errors: Partial<Record<HostId, string>> = {};
      for (const r of results) {
        items[r.host] = r.items;
        if (r.error) errors[r.host] = r.error;
      }
      set({ items, errors, loading: false, loadedAt: Date.now() });
      const all = [...(items.github ?? []), ...(items.gitlab ?? [])];
      // Only when every host answered: a failed host's items would look "gone".
      if (results.every((r) => !r.error)) {
        const pruned = pruneSnoozes(get().prefs, all, Date.now());
        if (pruned !== get().prefs) savePrefs(pruned);
      }
    },

    togglePin: (id) => {
      const { prefs } = get();
      const pinned = prefs.pinned.includes(id)
        ? prefs.pinned.filter((p) => p !== id)
        : [...prefs.pinned, id];
      savePrefs({ ...prefs, pinned });
    },
    snooze: (item, until) => {
      const { prefs } = get();
      const s: Snooze = { until, updatedAt: item.updatedAt };
      savePrefs({ ...prefs, snoozed: { ...prefs.snoozed, [item.id]: s } });
    },
    unsnooze: (id) => {
      const { prefs } = get();
      const snoozed = { ...prefs.snoozed };
      delete snoozed[id];
      savePrefs({ ...prefs, snoozed });
    },
    saveView: (name, filter) => {
      const view: SavedView = { id: newId(), name: name.trim(), filter };
      const { prefs } = get();
      savePrefs({ ...prefs, views: [...prefs.views, view] });
      set({ tab: `view:${view.id}` });
      return view;
    },
    deleteView: (id) => {
      const { prefs, tab } = get();
      savePrefs({ ...prefs, views: prefs.views.filter((v) => v.id !== id) });
      if (tab === `view:${id}`) set({ tab: 'prs' });
    },
  };
});

/** Every loaded item, GitHub first. */
export function allItems(items: Record<HostId, LaunchItem[] | null>): LaunchItem[] {
  return [...(items.github ?? []), ...(items.gitlab ?? [])];
}

let polling = false;

/** Keep the Launchpad (and its badge) fresh: now, when an account signs in, and every few
 *  minutes while the window is visible. Called once at start-up. */
export function startLaunchpadPolling() {
  if (polling) return;
  polling = true;
  const tick = () => {
    const signedIn = !!useGitHub.getState().user || !!useGitLab.getState().user;
    if (signedIn && document.visibilityState === 'visible' && !useLaunchpad.getState().loading)
      void useLaunchpad.getState().load();
  };
  const onAccount = (host: HostId, login: string | undefined, before: string | undefined) => {
    if (login === before) return;
    // Signed out: drop that account's items at once.
    if (!login)
      useLaunchpad.setState((st) => ({
        items: { ...st.items, [host]: null },
        errors: { ...st.errors, [host]: undefined },
      }));
    tick();
  };
  useGitHub.subscribe((s, prev) => onAccount('github', s.user?.login, prev.user?.login));
  useGitLab.subscribe((s, prev) => onAccount('gitlab', s.user?.login, prev.user?.login));
  setInterval(tick, POLL_MS);
  tick();
}

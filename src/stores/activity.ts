import { create } from 'zustand';

import { api } from '@/lib/ipc';
import { onHistoryStats, persistActivity } from '@/lib/persist';
import type { HistoryStats } from '@/lib/types';

/** One line of the Activity Logs window. */
export interface Activity {
  id: number;
  /** Repository path, or null for application-level events. */
  repo: string | null;
  /** English source text; translated when shown. */
  label: string;
  vars?: Record<string, string | number>;
  status: 'started' | 'finished' | 'failed' | 'info';
  at: number;
  /** Set when finished/failed. */
  ms?: number;
  error?: string;
}

/** Entries kept in memory (the file keeps more, within its own limits). */
const MAX = 5000;
let next = 1;

interface ActivityStore {
  items: Activity[];
  /** Size of activity.jsonl and how close it is to the limits. */
  stats: HistoryStats | null;
  /** Log a single event. */
  log: (e: Omit<Activity, 'id' | 'at'>) => void;
  /** Log "started" and return a function that logs "finished" / "failed" with the duration. */
  begin: (
    repo: string | null,
    label: string,
    vars?: Record<string, string | number>,
  ) => (error?: string) => void;
  clear: (repo: string | null | 'all') => void;
}

export const useActivity = create<ActivityStore>((set, get) => ({
  items: [],
  stats: null,
  log: (e) => {
    const item: Activity = { ...e, id: next++, at: Date.now() };
    // Every event also goes to activity.jsonl, so pulls, pushes, … can be traced later.
    persistActivity({ ...item, id: undefined });
    set((s) => ({ items: [...s.items.slice(-(MAX - 1)), item] }));
  },
  begin: (repo, label, vars) => {
    const start = performance.now();
    get().log({ repo, label, vars, status: 'started' });
    return (error) =>
      get().log({
        repo,
        label,
        vars,
        status: error ? 'failed' : 'finished',
        ms: Math.round(performance.now() - start),
        error,
      });
  },
  clear: (repo) => {
    set((s) => ({
      items: repo === 'all' ? [] : s.items.filter((i) => i.repo !== repo),
    }));
    api
      .historyClear(repo === 'all' ? null : (repo ?? ''))
      .then((stats) => set({ stats }))
      .catch(() => {});
  },
}));

onHistoryStats((stats) => useActivity.setState({ stats }));

/**
 * Read activity.jsonl at startup (entries past the retention period are deleted there) and
 * warn when the file is getting large.
 */
export async function loadActivity(): Promise<HistoryStats | null> {
  try {
    const loaded = await api.historyLoad();
    const items: Activity[] = (loaded.entries as Omit<Activity, 'id'>[])
      .filter((e) => e && typeof e.at === 'number' && typeof e.label === 'string')
      .map((e) => ({ ...e, repo: e.repo ?? null, id: next++ }));
    // Keep anything logged while the file was loading.
    useActivity.setState((s) => ({
      items: [...items, ...s.items].slice(-MAX),
      stats: loaded.stats,
    }));
    return loaded.stats;
  } catch {
    return null;
  }
}

export const logActivity = (e: Omit<Activity, 'id' | 'at'>) => useActivity.getState().log(e);

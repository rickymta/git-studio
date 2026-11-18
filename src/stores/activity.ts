import { create } from 'zustand';

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

const MAX = 2000;
let next = 1;

interface ActivityStore {
  items: Activity[];
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
  log: (e) =>
    set((s) => ({ items: [...s.items.slice(-(MAX - 1)), { ...e, id: next++, at: Date.now() }] })),
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
  clear: (repo) =>
    set((s) => ({
      items: repo === 'all' ? [] : s.items.filter((i) => i.repo !== repo),
    })),
}));

export const logActivity = (e: Omit<Activity, 'id' | 'at'>) => useActivity.getState().log(e);

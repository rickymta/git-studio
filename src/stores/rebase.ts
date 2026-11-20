import { create } from 'zustand';

import type { Commit } from '@/lib/types';
import type { RebaseRow } from '@/features/rebase/plan';

/** The interactive rebase dialog: the commits from `from` up to HEAD and what to do with each. */
interface RebaseDialogState {
  from: string | null;
  plan: Commit[];
  rows: RebaseRow[];
  show: (from: string, plan: Commit[], rows: RebaseRow[]) => void;
  setRows: (rows: RebaseRow[]) => void;
  close: () => void;
}

export const useRebaseDialog = create<RebaseDialogState>((set) => ({
  from: null,
  plan: [],
  rows: [],
  show: (from, plan, rows) => set({ from, plan, rows }),
  setRows: (rows) => set({ rows }),
  close: () => set({ from: null, plan: [], rows: [] }),
}));

import { create } from 'zustand';

import type { BisectState } from '@/lib/types';

/** The bisect in progress in the open repository (kept fresh by the bisect banner). */
export const useBisect = create<{
  path: string | null;
  state: BisectState | null;
  set: (path: string, state: BisectState) => void;
}>((set) => ({
  path: null,
  state: null,
  set: (path, state) => set({ path, state }),
}));

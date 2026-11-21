// What the toolbar's Pull button does when clicked (picked in its menu, like GitKraken).
// Stored in browser storage under `gitstudio.*`, which persist.ts keeps in ui-state.json.

import { create } from 'zustand';

/** `null`: follow the Pull Strategy setting (Preferences → General). */
export type PullAction = 'fetch' | 'merge' | 'ff-only' | 'rebase';

const KEY = 'gitstudio.pullAction';
const ACTIONS: PullAction[] = ['fetch', 'merge', 'ff-only', 'rebase'];

function load(): PullAction | null {
  try {
    const v = localStorage.getItem(KEY);
    return ACTIONS.includes(v as PullAction) ? (v as PullAction) : null;
  } catch {
    return null;
  }
}

interface PullActionStore {
  action: PullAction | null;
  set: (a: PullAction) => void;
}

export const usePullAction = create<PullActionStore>((set) => ({
  action: load(),
  set: (action) => {
    set({ action });
    try {
      localStorage.setItem(KEY, action);
    } catch {
      /* ignore */
    }
  },
}));

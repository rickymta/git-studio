import { create } from 'zustand';

interface LaunchStore {
  /** "Git Clone…" from the file manager: show the Clone dialog prefilled. */
  clone: { dir: string; url: string | null } | null;
  requestClone: (dir: string, url: string | null) => void;
  clearClone: () => void;
}

export const useLaunch = create<LaunchStore>((set) => ({
  clone: null,
  requestClone: (dir, url) => set({ clone: { dir, url } }),
  clearClone: () => set({ clone: null }),
}));

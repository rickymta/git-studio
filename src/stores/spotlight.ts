import { create } from 'zustand';

/** Spotlight: the search over the open repository (toolbar Search, Ctrl+K). */
export const useSpotlight = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

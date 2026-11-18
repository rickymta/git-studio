import { create } from 'zustand';

export type RemoteSource = 'url' | 'github' | 'gitlab';

type Target = { mode: 'add'; source: RemoteSource } | { mode: 'edit'; name: string } | null;

interface RemotePanelStore {
  target: Target;
  openAdd: (source?: RemoteSource) => void;
  openEdit: (name: string) => void;
  close: () => void;
}

/** The slide-out panel next to the sidebar for adding or editing a remote. */
export const useRemotePanel = create<RemotePanelStore>((set) => ({
  target: null,
  openAdd: (source = 'url') => set({ target: { mode: 'add', source } }),
  openEdit: (name) => set({ target: { mode: 'edit', name } }),
  close: () => set({ target: null }),
}));

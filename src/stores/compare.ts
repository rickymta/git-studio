// "Compare commit against working directory": the files that differ between one commit and the
// working tree. Stops by itself when another commit (or the WIP row) gets selected.

import { create } from 'zustand';

import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { FileChange } from '@/lib/types';
import { useRepo, type CompareSide } from './repo';
import { toast } from './ui';

interface CompareStore {
  /** "Mark as compare base": the commit or branch the next "Compare with…" starts from. */
  base: CompareSide | null;
  markBase: (side: CompareSide | null) => void;
  /** Commit being compared, or null when not comparing. */
  hash: string | null;
  files: FileChange[] | null;
  loading: boolean;
  start: (hash: string) => Promise<void>;
  /** Re-list the files (e.g. after the working tree changed); no-op when not comparing. */
  reload: () => Promise<void>;
  stop: () => void;
}

export const useCompare = create<CompareStore>((set, get) => ({
  base: null,
  markBase: (base) => set({ base }),
  hash: null,
  files: null,
  loading: false,

  start: async (hash) => {
    set({ hash, files: get().hash === hash ? get().files : null, loading: true });
    await get().reload();
  },

  reload: async () => {
    const hash = get().hash;
    const path = useRepo.getState().path;
    if (!hash || !path) return;
    set({ loading: true });
    try {
      const files = await api.compareWithWorktree(path, hash);
      if (get().hash === hash) set({ files, loading: false });
    } catch (e) {
      if (get().hash === hash) set({ hash: null, files: null, loading: false });
      toast('error', t('Could not compare with the working directory'), (e as Error).message);
    }
  },

  stop: () => set({ hash: null, files: null, loading: false }),
}));

useRepo.subscribe((s, prev) => {
  // A compare base belongs to one repository.
  if (s.path !== prev.path && useCompare.getState().base) useCompare.getState().markBase(null);
  const hash = useCompare.getState().hash;
  if (!hash) return;
  const sel = s.selection;
  if (s.path !== prev.path || !(sel?.type === 'commit' && sel.hash === hash)) {
    useCompare.getState().stop();
    return;
  }
  // The working tree changed: keep the list current.
  if (s.info !== prev.info) void useCompare.getState().reload();
});

import { create } from 'zustand';

import { api } from '@/lib/ipc';
import type { GitHubRepo, GitLabUser } from '@/lib/types';
import { useTokens } from './tokens';

interface GitLabStore {
  user: GitLabUser | null;
  checked: boolean;
  /** GitLab projects, same shape as GitHub repos (fullName = "group/sub/name"). */
  repos: GitHubRepo[] | null;
  reposLoading: boolean;
  check: () => Promise<void>;
  setUser: (u: GitLabUser | null) => void;
  signOut: () => Promise<void>;
  loadRepos: () => Promise<void>;
}

export const useGitLab = create<GitLabStore>((set, get) => ({
  user: null,
  checked: false,
  repos: null,
  reposLoading: false,

  check: async () => {
    try {
      const user = await api.glAccount();
      set({ user, checked: true });
      void useTokens.getState().account('gitlab', user);
    } catch {
      set({ user: null, checked: true });
    }
  },
  setUser: (user) => {
    set({ user, repos: null });
    if (user) void useTokens.getState().account('gitlab', user);
  },
  signOut: async () => {
    await api.glSignOut();
    useTokens.getState().clear('gitlab');
    set({ user: null, repos: null });
  },
  loadRepos: async () => {
    if (!get().user) return;
    set({ reposLoading: true });
    try {
      const all: GitHubRepo[] = [];
      for (let page = 1; page <= 5; page++) {
        const batch = await api.glRepos(page);
        all.push(...batch);
        if (batch.length < 100) break;
      }
      set({ repos: all });
    } finally {
      set({ reposLoading: false });
    }
  },
}));

let checking = false;

/** Looks up the stored GitLab account once per app run (called lazily by the screens that need it). */
export function ensureGitLabChecked() {
  if (checking || useGitLab.getState().checked) return;
  checking = true;
  void useGitLab.getState().check();
}

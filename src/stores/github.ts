import { create } from 'zustand';

import { api } from '@/lib/ipc';
import type { GitHubRepo, GitHubSlug, GitHubUser, PullRequest } from '@/lib/types';

interface GitHubStore {
  user: GitHubUser | null;
  checked: boolean;
  repos: GitHubRepo[] | null;
  reposLoading: boolean;
  pulls: PullRequest[] | null;
  pullsFor: string | null;
  pullsError: string | null;
  check: () => Promise<void>;
  setUser: (u: GitHubUser | null) => void;
  signOut: () => Promise<void>;
  loadRepos: () => Promise<void>;
  loadPulls: (slug: GitHubSlug | null) => Promise<void>;
}

export const useGitHub = create<GitHubStore>((set, get) => ({
  user: null,
  checked: false,
  repos: null,
  reposLoading: false,
  pulls: null,
  pullsFor: null,
  pullsError: null,

  check: async () => {
    try {
      set({ user: await api.ghAccount(), checked: true });
    } catch {
      set({ user: null, checked: true });
    }
  },
  setUser: (user) => set({ user, repos: null, pulls: null, pullsFor: null }),
  signOut: async () => {
    await api.ghSignOut();
    set({ user: null, repos: null, pulls: null, pullsFor: null });
  },
  loadRepos: async () => {
    if (!get().user) return;
    set({ reposLoading: true });
    try {
      const all: GitHubRepo[] = [];
      for (let page = 1; page <= 5; page++) {
        const batch = await api.ghRepos(page);
        all.push(...batch);
        if (batch.length < 100) break;
      }
      set({ repos: all });
    } finally {
      set({ reposLoading: false });
    }
  },
  loadPulls: async (slug) => {
    const key = slug ? `${slug.owner}/${slug.repo}` : null;
    if (!slug || !get().user) {
      set({ pulls: null, pullsFor: key, pullsError: null });
      return;
    }
    set({ pullsFor: key });
    try {
      const pulls = await api.ghPulls(slug.owner, slug.repo);
      if (get().pullsFor === key) set({ pulls, pullsError: null });
    } catch (e) {
      if (get().pullsFor === key) set({ pulls: null, pullsError: (e as Error).message });
    }
  },
}));

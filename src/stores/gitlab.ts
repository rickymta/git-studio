import { create } from 'zustand';

import { api } from '@/lib/ipc';
import type { GitHubRepo, GitLabUser, PullRequest } from '@/lib/types';
import { useTokens } from './tokens';

interface GitLabStore {
  user: GitLabUser | null;
  checked: boolean;
  /** GitLab projects, same shape as GitHub repos (fullName = "group/sub/name"). */
  repos: GitHubRepo[] | null;
  reposLoading: boolean;
  /** Open merge requests of the shown repository's GitLab project. */
  pulls: PullRequest[] | null;
  pullsFor: string | null;
  pullsError: string | null;
  check: () => Promise<void>;
  setUser: (u: GitLabUser | null) => void;
  signOut: () => Promise<void>;
  loadRepos: () => Promise<void>;
  /** Load the open merge requests of the project at `path` (null: the repository has none). */
  loadPulls: (path: string | null) => Promise<void>;
}

export const useGitLab = create<GitLabStore>((set, get) => ({
  user: null,
  checked: false,
  repos: null,
  reposLoading: false,
  pulls: null,
  pullsFor: null,
  pullsError: null,

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
    set({ user, repos: null, pulls: null, pullsFor: null });
    if (user) void useTokens.getState().account('gitlab', user);
  },
  signOut: async () => {
    await api.glSignOut();
    useTokens.getState().clear('gitlab');
    set({ user: null, repos: null, pulls: null, pullsFor: null });
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
  loadPulls: async (path) => {
    if (!path || !get().user) {
      set({ pulls: null, pullsFor: path, pullsError: null });
      return;
    }
    set({ pullsFor: path });
    try {
      const pulls = await api.glMergeRequests(path);
      if (get().pullsFor === path) set({ pulls, pullsError: null });
    } catch (e) {
      if (get().pullsFor === path) set({ pulls: null, pullsError: (e as Error).message });
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

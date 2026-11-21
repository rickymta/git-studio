import { describe, expect, it, vi } from 'vitest';

import type { Commit, RepoInfo } from '@/lib/types';

const commit = (hash: string, parent?: string): Commit => ({
  hash,
  parents: parent ? [parent] : [],
  authorName: '',
  authorEmail: '',
  authorTime: 0,
  committerName: '',
  commitTime: 0,
  subject: hash,
});

/** A linear history c<n-1> (newest) … c0. */
const history = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    commit(`c${n - 1 - i}`, i < n - 1 ? `c${n - 2 - i}` : undefined),
  );

const info = (path: string): RepoInfo =>
  ({
    path,
    name: 'r',
    state: 'clean',
    status: {
      branch: 'main',
      head: 'h',
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
      conflicted: [],
    },
  }) as unknown as RepoInfo;

let remote = history(10);
const api = vi.hoisted(() => ({
  open: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  refs: vi.fn(async () => ({ refs: [], stashes: [], remotes: [] })),
  worktrees: vi.fn(async () => []),
  settings: vi.fn(async () => ({ initialCommits: 4 })),
}));
vi.mock('@/lib/ipc', () => ({ api, isTauri: false }));

import { keepOlder, useRepo } from './repo';

describe('keepOlder', () => {
  it('puts the new page on top of the older commits it reaches', () => {
    const loaded = history(10); // c9 … c0
    const page = [commit('n1', 'c9'), commit('c9', 'c8'), commit('c8', 'c7')];
    expect(keepOlder(page, loaded)?.map((c) => c.hash)).toEqual([
      'n1',
      'c9',
      'c8',
      'c7',
      'c6',
      'c5',
      'c4',
      'c3',
      'c2',
      'c1',
      'c0',
    ]);
    // A page that does not reach the loaded commits (rewritten history): nothing kept.
    expect(keepOlder([commit('x'), commit('y')], loaded)).toBeNull();
  });
});

describe('paging', () => {
  it('loads the rest in the background and keeps it when a fetch adds commits', async () => {
    api.settings.mockResolvedValue({ initialCommits: 4 } as never);
    api.open.mockImplementation(async (p: string) => info(p));
    api.info.mockImplementation(async (p: string) => info(p));
    api.log.mockImplementation(async (_p: string, limit: number, skip = 0) =>
      remote.slice(skip, skip + limit),
    );
    await useRepo.getState().loadSettings();
    await useRepo.getState().open('/big');
    // Background pages until the whole history is there.
    await vi.waitFor(() => expect(useRepo.getState().commits).toHaveLength(10), {
      timeout: 5000,
    });
    expect(useRepo.getState().hasMore).toBe(false);

    // A fetch brings two new commits: they go on top, the older ones stay.
    remote = [commit('n2', 'n1'), commit('n1', 'c9'), ...remote];
    api.log.mockClear();
    await useRepo.getState().refresh();
    expect(useRepo.getState().commits.map((c) => c.hash)).toEqual([
      'n2',
      'n1',
      ...history(10).map((c) => c.hash),
    ]);
    // One page read, not the whole history again.
    expect(api.log).toHaveBeenCalledTimes(1);
    expect(api.log.mock.calls[0]![1]).toBe(4);
  });
});

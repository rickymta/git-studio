import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Commit, RepoInfo } from '@/lib/types';

const info = (path: string, head: string): RepoInfo =>
  ({
    path,
    name: path.split('/').pop()!,
    state: 'clean',
    status: {
      branch: 'main',
      head,
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
      conflicted: [],
    },
  }) as unknown as RepoInfo;

const commit = (hash: string): Commit => ({
  hash,
  parents: [],
  authorName: '',
  authorEmail: '',
  authorTime: 0,
  committerName: '',
  commitTime: 0,
  subject: hash,
});

const api = vi.hoisted(() => ({
  // `load` is log + refs + worktrees in one call: built from the mocks above so each test can
  // keep driving those.
  load: vi.fn(async (repo: string, limit: number, skip?: number, view?: unknown) => ({
    commits: await (api.log as (...a: unknown[]) => Promise<unknown>)(repo, limit, skip, view),
    refs: await (api.refs as (...a: unknown[]) => Promise<unknown>)(repo),
    worktrees: (await (api.worktrees as (...a: unknown[]) => Promise<unknown>)(repo)) ?? [],
  })),
  loadPage: vi.fn(async () => null),
  savePage: vi.fn(async () => null),
  open: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  refs: vi.fn(async () => ({ refs: [], stashes: [], remotes: [] })),
  worktrees: vi.fn(async () => []),
  settings: vi.fn(async () => ({ initialCommits: 50 })),
}));
vi.mock('@/lib/ipc', () => ({ api, isTauri: false }));

import { useRepo } from './repo';

afterEach(() => vi.clearAllMocks());

describe('switching tabs', () => {
  it('shows a tab seen before at once, then only checks its status', async () => {
    api.open.mockImplementation(async (p: string) => info(p, `${p}-head`));
    api.info.mockImplementation(async (p: string) => info(p, `${p}-head`));
    api.log.mockImplementation(async (p: string) => [commit(`${p}-head`)]);

    await useRepo.getState().open('/a');
    expect(useRepo.getState().commits.map((c) => c.hash)).toEqual(['/a-head']);
    await useRepo.getState().open('/b');
    expect(useRepo.getState().path).toBe('/b');
    vi.clearAllMocks();

    const back = useRepo.getState().open('/a');
    // Synchronously restored: no spinner, the commits are there before git answers.
    expect(useRepo.getState().path).toBe('/a');
    expect(useRepo.getState().loading).toBe(false);
    expect(useRepo.getState().commits.map((c) => c.hash)).toEqual(['/a-head']);
    await back;
    await new Promise((r) => setTimeout(r, 0));
    // Not reopened nor its history read again: just the status.
    expect(api.open).not.toHaveBeenCalled();
    expect(api.log).not.toHaveBeenCalled();
    expect(api.info).toHaveBeenCalledWith('/a');
  });
});

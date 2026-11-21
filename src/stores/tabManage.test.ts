import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  open: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  refs: vi.fn(async () => ({ refs: [], stashes: [], remotes: [] })),
  worktrees: vi.fn(async () => []),
  settings: vi.fn(async () => ({ initialCommits: 50 })),
}));
vi.mock('@/lib/ipc', () => ({ api, isTauri: false }));

import { tabsByRecent, useRepo } from './repo';

const names = () => useRepo.getState().tabs.map((x) => x.name + (x.pinned ? '*' : ''));

beforeEach(() => {
  api.open.mockImplementation(async (p: string) => info(p, `${p}-head`));
  api.info.mockImplementation(async (p: string) => info(p, `${p}-head`));
  api.log.mockImplementation(async (p: string) => [commit(`${p}-head`)]);
  useRepo.setState({ tabs: [], path: null, info: null });
});
afterEach(() => vi.clearAllMocks());

const openAll = async (...paths: string[]) => {
  for (const p of paths) await useRepo.getState().open(p);
};

describe('managing many tabs', () => {
  it('keeps pinned tabs first and moves tabs across the pinned boundary', async () => {
    await openAll('/a', '/b', '/c', '/d');
    useRepo.getState().pinTab('/c', true);
    expect(names()).toEqual(['c*', 'a', 'b', 'd']);
    useRepo.getState().pinTab('/d', true);
    expect(names()).toEqual(['c*', 'd*', 'a', 'b']);
    // Dragged among the others: unpinned. Dragged to the front: pinned.
    useRepo.getState().moveTab(0, 3);
    expect(names()).toEqual(['d*', 'a', 'b', 'c']);
    useRepo.getState().moveTab(3, 0);
    expect(names()).toEqual(['c*', 'd*', 'a', 'b']);
    useRepo.getState().pinTab('/d', false);
    expect(names()).toEqual(['c*', 'd', 'a', 'b']);
  });

  it('closes several tabs at once and goes to the tab used before', async () => {
    await openAll('/a', '/b', '/c', '/d');
    await useRepo.getState().open('/b');
    await useRepo.getState().open('/d');
    expect(tabsByRecent(useRepo.getState().tabs).map((x) => x.name)).toEqual(['d', 'b', 'c', 'a']);
    useRepo.getState().closeTabs(['/d', '/c']);
    expect(names()).toEqual(['a', 'b']);
    expect(useRepo.getState().path).toBe('/b');
  });

  it('reopens closed tabs where they were, newest first', async () => {
    await openAll('/a', '/b', '/c');
    useRepo.getState().closeTab('/b');
    useRepo.getState().closeTab('/a');
    expect(names()).toEqual(['c']);
    useRepo.getState().reopenClosedTab();
    expect(names()).toEqual(['a', 'c']);
    useRepo.getState().reopenClosedTab();
    expect(names()).toEqual(['a', 'b', 'c']);
    await new Promise((r) => setTimeout(r, 0));
    // The shown tab was not among them: it stays shown.
    expect(useRepo.getState().path).toBe('/c');
  });

  it('reopens tabs closed together in one go', async () => {
    await openAll('/a', '/b', '/c', '/d');
    useRepo.getState().closeTabs(['/a', '/c', '/d']);
    expect(names()).toEqual(['b']);
    expect(useRepo.getState().path).toBe('/b');
    useRepo.getState().reopenClosedTab();
    expect(names()).toEqual(['a', 'b', 'c', 'd']);
  });
});

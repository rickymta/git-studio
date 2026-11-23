// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Commit, RepoInfo, RepoStamp, Settings } from '@/lib/types';
import { useRepo } from './repo';
import type * as UiModule from './ui';

const commit = (i: number): Commit => ({
  hash: `c${i}`,
  parents: [`c${i + 1}`],
  authorName: '',
  authorEmail: '',
  authorTime: 0,
  committerName: '',
  commitTime: 0,
  subject: `c${i}`,
});
const HISTORY = Array.from({ length: 50 }, (_, i) => commit(i));
const info = (path: string) =>
  ({ path, name: path.split('/').pop(), state: 'clean', status: { head: 'c0' } }) as RepoInfo;

/** What `.git` looks like on disk right now; tests change it to play git made a change. */
let disk: RepoStamp = { refs: 'r1', index: 'i1' };

const api = vi.hoisted(() => ({
  load: vi.fn(),
  loadPage: vi.fn(async () => null),
  savePage: vi.fn(async () => null),
  open: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  repoStamp: vi.fn(),
  settings: vi.fn(),
}));
vi.mock('@/lib/ipc', () => ({ api, isTauri: false }));
vi.mock('./ui', async (orig) => ({ ...(await orig<typeof UiModule>()), toast: vi.fn() }));

beforeEach(async () => {
  disk = { refs: 'r1', index: 'i1' };
  api.open.mockImplementation(async (path: string) => info(path));
  api.info.mockImplementation(async (path: string) => info(path));
  api.load.mockImplementation(async () => ({
    commits: HISTORY,
    refs: { refs: [], remotes: [], stashes: [] },
    worktrees: [],
  }));
  api.log.mockResolvedValue([]);
  api.repoStamp.mockImplementation(async () => disk);
  api.settings.mockResolvedValue({ initialCommits: 800 } as Settings);
  useRepo.setState({
    tabs: [],
    path: null,
    info: null,
    commits: [],
    busy: null,
    settings: { initialCommits: 800 } as Settings,
  });
  await useRepo.getState().open('D:/repo');
  await vi.waitFor(() => expect(useRepo.getState().loading).toBe(false));
  vi.clearAllMocks();
});
afterEach(() => vi.clearAllMocks());

describe('noticing changes made outside the app', () => {
  it('reads nothing more while git has changed nothing', async () => {
    await useRepo.getState().checkChanges();
    expect(api.repoStamp).toHaveBeenCalledTimes(1);
    expect(api.load).not.toHaveBeenCalled();
    expect(api.info).not.toHaveBeenCalled();
  });

  it('reloads the graph when refs moved (a merge made in a terminal)', async () => {
    disk = { ...disk, refs: 'r2' };
    await useRepo.getState().checkChanges();
    expect(api.load).toHaveBeenCalledTimes(1);
    // Taken in: the next check finds nothing new.
    vi.clearAllMocks();
    await useRepo.getState().checkChanges();
    expect(api.load).not.toHaveBeenCalled();
  });

  it('only re-reads the status when just the index was written', async () => {
    disk = { ...disk, index: 'i2' };
    await useRepo.getState().checkChanges();
    expect(api.info).toHaveBeenCalledTimes(1);
    expect(api.load).not.toHaveBeenCalled();
  });

  it('reads the status when asked, for edited files the stamp does not see', async () => {
    await useRepo.getState().checkChanges({ status: true });
    expect(api.info).toHaveBeenCalledTimes(1);
    expect(api.load).not.toHaveBeenCalled();
  });

  it('catches a merge into another branch when the window is focused again soon', async () => {
    disk = { ...disk, refs: 'r3' };
    await useRepo.getState().refreshOnFocus();
    expect(api.load).toHaveBeenCalledTimes(1);
  });

  it('waits while one of its own operations runs', async () => {
    useRepo.setState({ busy: 'Merging' });
    disk = { ...disk, refs: 'r4' };
    await useRepo.getState().checkChanges({ status: true });
    expect(api.repoStamp).not.toHaveBeenCalled();
    expect(api.load).not.toHaveBeenCalled();
  });
});

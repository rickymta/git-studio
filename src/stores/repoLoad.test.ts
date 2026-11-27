// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Commit, RepoInfo, Settings } from '@/lib/types';
import { FIRST_PAGE, useRepo } from './repo';
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
const HISTORY = Array.from({ length: 1000 }, (_, i) => commit(i));
const info = (path: string) =>
  ({ path, name: path.split('/').pop(), state: 'clean', status: { head: 'c0' } }) as RepoInfo;

/** A promise the test resolves by hand, to hold a git call open. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

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
  refs: vi.fn(),
  worktrees: vi.fn(),
  settings: vi.fn(),
}));
vi.mock('@/lib/ipc', () => ({ api, isTauri: false }));
vi.mock('./ui', async (orig) => ({ ...(await orig<typeof UiModule>()), toast: vi.fn() }));

beforeEach(() => {
  api.open.mockImplementation(async (path: string) => info(path));
  api.info.mockImplementation(async (path: string) => info(path));
  api.log.mockImplementation(async (_p: string, limit: number, skip: number) =>
    HISTORY.slice(skip, skip + limit),
  );
  api.refs.mockResolvedValue({ refs: [], remotes: [], stashes: [] });
  api.worktrees.mockResolvedValue([]);
  api.settings.mockResolvedValue({ initialCommits: 800 } as Settings);
  useRepo.setState({
    tabs: [],
    path: null,
    info: null,
    commits: [],
    settings: { initialCommits: 800 } as Settings,
  });
});
afterEach(() => vi.clearAllMocks());

describe('switching to a repository tab', () => {
  it('switches at once and shows the loading state while the repository opens', async () => {
    const opening = deferred<RepoInfo>();
    api.open.mockReturnValueOnce(opening.promise);
    useRepo.setState({ path: 'D:/a', info: info('D:/a'), commits: HISTORY.slice(0, 5) });

    const done = useRepo.getState().open('D:/b');
    // Not the previous repository any more, before git has answered.
    expect(useRepo.getState()).toMatchObject({ path: 'D:/b', info: null, loading: true });
    expect(useRepo.getState().commits).toEqual([]);

    opening.resolve(info('D:/b'));
    await done;
    expect(useRepo.getState()).toMatchObject({ path: 'D:/b', loading: false });
  });

  it('draws a short first page, then loads the rest of the page in the background', async () => {
    await useRepo.getState().open('D:/b');
    const limits = api.log.mock.calls.map((c) => [c[1], c[2]]);
    expect(limits).toEqual([
      [FIRST_PAGE, 0],
      [800 - FIRST_PAGE, FIRST_PAGE],
    ]);
    expect(useRepo.getState().commits).toHaveLength(800);
    expect(useRepo.getState().hasMore).toBe(true);
    // `open` is the quick one (no `git status`); the status is read once, after the history
    // was asked for, so the graph never waits for it.
    expect(api.open).toHaveBeenCalledWith('D:/b', true);
    expect(api.info).toHaveBeenCalledTimes(1);
    expect(api.info.mock.invocationCallOrder[0]!).toBeGreaterThan(
      api.log.mock.invocationCallOrder[0]!,
    );
  });

  it('shows the page saved last time while git answers', async () => {
    const saved = {
      commits: HISTORY.slice(0, 3),
      refs: { refs: [], stashes: [], remotes: [] },
      worktrees: [],
      at: 1,
    };
    api.loadPage.mockResolvedValueOnce(saved as never);
    const slowLog = deferred<typeof HISTORY>();
    api.log.mockReturnValueOnce(slowLog.promise);
    // A repository not opened in this run yet (pages are written once a minute per repository).
    const opening = useRepo.getState().open('D:/saved');
    await vi.waitFor(() => expect(useRepo.getState().commits).toHaveLength(3));
    expect(useRepo.getState().loading).toBe(true);
    slowLog.resolve(HISTORY.slice(0, FIRST_PAGE));
    await opening;
    expect(useRepo.getState().commits.length).toBeGreaterThan(3);
    // The fresh first screen is kept for next time.
    expect(api.savePage).toHaveBeenCalledWith(
      'D:/saved',
      expect.objectContaining({ at: expect.any(Number) }),
    );
  });

  it('keeps the last tab clicked when an earlier one answers later', async () => {
    const slow = deferred<RepoInfo>();
    api.open.mockReturnValueOnce(slow.promise);
    const first = useRepo.getState().open('D:/slow');
    await useRepo.getState().open('D:/fast');
    slow.resolve(info('D:/slow'));
    await first;
    expect(useRepo.getState().path).toBe('D:/fast');
    expect(useRepo.getState().tabs.map((t) => t.path)).toEqual(['D:/fast']);
  });
});

describe('refreshing', () => {
  beforeEach(async () => {
    await useRepo.getState().open('D:/b');
    vi.clearAllMocks();
  });

  it('shares one load between overlapping refreshes, plus one more for the later calls', async () => {
    await Promise.all([
      useRepo.getState().refresh(),
      useRepo.getState().refresh(),
      useRepo.getState().refresh(),
    ]);
    expect(api.log).toHaveBeenCalledTimes(2);
    expect(api.log.mock.calls[0]![1]).toBe(800);
  });

  it('only re-reads the status when a window is focused again soon after a load', async () => {
    await useRepo.getState().refreshOnFocus();
    expect(api.info).toHaveBeenCalledTimes(1);
    expect(api.log).not.toHaveBeenCalled();
  });

  it('polls nothing while a repository is still opening', async () => {
    useRepo.setState({ info: null });
    await useRepo.getState().refreshStatus();
    await useRepo.getState().refresh();
    expect(api.info).not.toHaveBeenCalled();
    expect(api.log).not.toHaveBeenCalled();
  });
});

describe('the "New tab" tab', () => {
  it('shows the start page and closes back to the tab shown before it', async () => {
    await useRepo.getState().open('D:/a');
    await useRepo.getState().open('D:/b');
    useRepo.getState().newTab();
    expect(useRepo.getState()).toMatchObject({ newTabOpen: true, path: null });
    expect(useRepo.getState().tabs).toHaveLength(2);

    useRepo.getState().closeNewTab();
    expect(useRepo.getState().newTabOpen).toBe(false);
    await vi.waitFor(() => expect(useRepo.getState().path).toBe('D:/b'));
  });

  it('is replaced by the repository opened from it', async () => {
    useRepo.getState().newTab();
    await useRepo.getState().open('D:/c');
    expect(useRepo.getState()).toMatchObject({ newTabOpen: false, path: 'D:/c' });
  });

  it('stays when the repository opened from it cannot be opened', async () => {
    useRepo.getState().newTab();
    api.open.mockRejectedValueOnce(new Error('not a repository'));
    expect(await useRepo.getState().open('D:/nope')).toBe(false);
    expect(useRepo.getState()).toMatchObject({ newTabOpen: true, path: null });
  });

  it('is not the workspace overview', () => {
    useRepo.getState().newTab();
    useRepo.getState().showOverview();
    expect(useRepo.getState()).toMatchObject({ newTabOpen: false, path: null });
  });
});

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
  // `load` is log + refs + worktrees in one call: built from the mocks above so each test can
  // keep driving those.
  load: vi.fn(async (repo: string, limit: number, skip?: number, view?: unknown) => ({
    commits: await (api.log as (...a: unknown[]) => Promise<unknown>)(repo, limit, skip, view),
    refs: await (api.refs as (...a: unknown[]) => Promise<unknown>)(repo),
    worktrees: (await (api.worktrees as (...a: unknown[]) => Promise<unknown>)(repo)) ?? [],
  })),
  loadPage: vi.fn(async () => null),
  savePage: vi.fn(async () => null),
  historyAppend: vi.fn(async () => null),
  open: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  refs: vi.fn(async () => ({ refs: [], stashes: [], remotes: [] })),
  worktrees: vi.fn(async () => []),
  settings: vi.fn(async () => ({ initialCommits: 4 })),
}));
vi.mock('@/lib/ipc', () => ({ api, isTauri: false }));

import { hashIndex, layoutGraph, withStashes } from '@/lib/graph';
import { KEEP_ON_REFRESH, keepOlder, setGraphScrolling, useRepo } from './repo';

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

describe('long histories', () => {
  it('appends pages without a full pass, the same as laying out the whole list', async () => {
    remote = history(4600);
    api.refs.mockResolvedValue({ refs: [], stashes: [], remotes: [] } as never);
    await useRepo.getState().open('/long');
    await vi.waitFor(() => expect(useRepo.getState().commits).toHaveLength(4600), {
      timeout: 10000,
    });
    const { commits, graph } = useRepo.getState();
    expect(commits.map((c) => c.hash)).toEqual(remote.map((c) => c.hash));
    expect(graph).toEqual(layoutGraph(commits));
    expect(hashIndex(commits).get('c0')).toBe(4599);
  });

  it('waits while the list scrolls, then goes on', async () => {
    remote = history(4600);
    setGraphScrolling(true);
    await useRepo.getState().open('/scrolling');
    await new Promise((r) => setTimeout(r, 600));
    expect(useRepo.getState().commits.length).toBeLessThan(4600);
    setGraphScrolling(false);
    await vi.waitFor(() => expect(useRepo.getState().commits).toHaveLength(4600), {
      timeout: 10000,
    });
  });

  it('re-places a stash whose base arrives in a later page', async () => {
    remote = history(4600);
    const stash = { hash: 's1', base: 'c5', time: 0, message: 'On main: wip', index: 0 };
    api.refs.mockResolvedValue({ refs: [], stashes: [stash], remotes: [] } as never);
    await useRepo.getState().open('/stashed');
    await vi.waitFor(() => expect(useRepo.getState().commits).toHaveLength(4601), {
      timeout: 10000,
    });
    const { commits } = useRepo.getState();
    expect(commits.map((c) => c.hash)).toEqual(
      withStashes(remote, [stash as never]).map((c) => c.hash),
    );
    api.refs.mockResolvedValue({ refs: [], stashes: [], remotes: [] } as never);
  });
});

describe('status polling', () => {
  it('keeps the same info object when nothing changed, so nothing re-renders', async () => {
    remote = history(10);
    api.log.mockImplementation(async (_p: string, limit: number, skip = 0) =>
      remote.slice(skip, skip + limit),
    );
    api.open.mockImplementation(async (p: string) => info(p));
    api.info.mockImplementation(async (p: string) => info(p));
    await useRepo.getState().open('/polled');
    await vi.waitFor(() => expect(useRepo.getState().info).not.toBeNull());
    const before = useRepo.getState().info;
    await useRepo.getState().refreshStatus();
    expect(useRepo.getState().info).toBe(before);

    // A real change (one more commit ahead) does replace it.
    api.info.mockImplementation(async (p: string) => {
      const i = info(p);
      i.status.ahead = 1;
      return i;
    });
    await useRepo.getState().refreshStatus();
    expect(useRepo.getState().info).not.toBe(before);
    expect(useRepo.getState().info?.status.ahead).toBe(1);
  });
});

describe('refreshing a long history', () => {
  it('lays out at most KEEP_ON_REFRESH commits, then loads the rest again behind', async () => {
    const n = KEEP_ON_REFRESH + 6000;
    remote = history(n);
    api.refs.mockResolvedValue({ refs: [], stashes: [], remotes: [] } as never);
    api.log.mockImplementation(async (_p: string, limit: number, skip = 0) =>
      remote.slice(skip, skip + limit),
    );
    api.open.mockImplementation(async (p: string) => info(p));
    api.info.mockImplementation(async (p: string) => info(p));
    await useRepo.getState().open('/refreshed');
    await vi.waitFor(() => expect(useRepo.getState().commits).toHaveLength(n), {
      timeout: 20000,
    });

    // A pull brings one commit: the refresh keeps the newest ones only…
    remote = [commit('n1', `c${n - 1}`), ...remote];
    const pages: number[] = [];
    const unsub = useRepo.subscribe((st, prev) => {
      if (st.commits !== prev.commits) pages.push(st.commits.length);
    });
    await useRepo.getState().refresh();
    expect(pages[0]).toBeLessThanOrEqual(KEEP_ON_REFRESH + 1);
    expect(useRepo.getState().commits[0]!.hash).toBe('n1');
    // …and the rest comes back in the background.
    await vi.waitFor(() => expect(useRepo.getState().commits).toHaveLength(n + 1), {
      timeout: 20000,
    });
    unsub();
    expect(useRepo.getState().commits.map((c) => c.hash)).toEqual(remote.map((c) => c.hash));
  }, 60000);
});

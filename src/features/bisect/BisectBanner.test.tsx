// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BisectState, Commit, RepoInfo } from '@/lib/types';
import { useBisect } from '@/stores/bisect';
import { useRepo } from '@/stores/repo';
import { button, cleanup, click, render, text } from '@/test/dom';
import { BisectBanner } from './BisectBanner';

const api = vi.hoisted(() => ({ bisectState: vi.fn() }));
vi.mock('@/lib/ipc', () => ({ api, isTauri: false }));
const tools = vi.hoisted(() => ({ bisectMark: vi.fn(), bisectReset: vi.fn() }));
vi.mock('../repoTools', () => tools);

const BAD = 'b'.repeat(40);
const GOOD = 'a'.repeat(40);
const CUR = 'c'.repeat(40);
const idle: BisectState = {
  active: false,
  bad: null,
  good: [],
  skipped: [],
  current: null,
  remaining: null,
  steps: null,
  firstBad: null,
};
const reveal = vi.fn(async () => {});

beforeEach(() => {
  useBisect.setState({ path: null, state: null });
  useRepo.setState({
    path: '/repo',
    info: {} as RepoInfo,
    commits: [{ hash: BAD, subject: 'Break the build' } as Commit],
    reveal,
  });
});
afterEach(async () => {
  await cleanup();
  vi.clearAllMocks();
});

describe('BisectBanner', () => {
  it('is hidden when no bisect is running', async () => {
    api.bisectState.mockResolvedValue(idle);
    await render(<BisectBanner />);
    expect(api.bisectState).toHaveBeenCalledWith('/repo');
    expect(text()).toBe('');
  });

  it('asks for a good commit once the bad one is known', async () => {
    api.bisectState.mockResolvedValue({ ...idle, active: true, bad: BAD });
    await render(<BisectBanner />);
    expect(text()).toContain('mark a commit that works (good)');
    expect(() => button('Skip')).toThrow();
    await click(button('Good'));
    expect(tools.bisectMark).toHaveBeenCalledWith('good');
  });

  it('shows progress while searching and offers Skip', async () => {
    api.bisectState.mockResolvedValue({
      ...idle,
      active: true,
      bad: BAD,
      good: [GOOD],
      current: CUR,
      remaining: 5,
      steps: 3,
    });
    await render(<BisectBanner />);
    expect(text()).toContain('testing ccccccc. About 5 revision(s) left (~3 step(s))');
    await click(button('Skip'));
    expect(tools.bisectMark).toHaveBeenCalledWith('skip');
    await click(button('Bad'));
    expect(tools.bisectMark).toHaveBeenCalledWith('bad');
  });

  it('names the first bad commit, shows it, and ends the bisect', async () => {
    api.bisectState.mockResolvedValue({
      ...idle,
      active: true,
      bad: BAD,
      good: [GOOD],
      firstBad: BAD,
    });
    await render(<BisectBanner />);
    expect(text()).toContain('Found it: bbbbbbb "Break the build" is the first bad commit.');
    expect(() => button('Good')).toThrow();
    await click(button('Show commit'));
    expect(reveal).toHaveBeenCalledWith(BAD);
    await click(button('End bisect'));
    expect(tools.bisectReset).toHaveBeenCalled();
  });
});

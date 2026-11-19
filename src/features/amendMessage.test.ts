import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RepoInfo, RepoState, Status } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import type * as UiModule from '@/stores/ui';
import { amendHeadMessage, canAmendMessage, headIsPushed } from './actions';
import { joinMessage, splitMessage } from './panel/commitMessage';

const api = vi.hoisted(() => ({
  amendMessage: vi.fn(async () => 'new'),
  reset: vi.fn(async () => null),
}));
vi.mock('@/lib/ipc', () => ({ api, isTauri: false }));

const confirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/stores/ui', async (orig) => ({
  ...(await orig<typeof UiModule>()),
  confirm,
}));

const initial = useRepo.getState();

function setup(status: Partial<Status>, state: RepoState = 'clean') {
  const reveal = vi.fn(async () => {});
  const record = vi.fn();
  useRepo.setState({
    path: '/repo',
    info: {
      state,
      status: { branch: 'main', head: 'old', upstream: null, ahead: 0, behind: 0, ...status },
    } as unknown as RepoInfo,
    reveal,
    record,
    // Run the action and move HEAD like the backend would.
    run: async (_label, fn) => {
      await fn('/repo');
      const info = useRepo.getState().info!;
      useRepo.setState({ info: { ...info, status: { ...info.status, head: 'new' } } });
      return true;
    },
  });
  return { reveal, record };
}

beforeEach(() => {
  api.amendMessage.mockClear();
  api.reset.mockClear();
  confirm.mockClear();
  confirm.mockResolvedValue(true);
});
afterEach(() => useRepo.setState(initial, true));

describe('commit message fields', () => {
  it('splits the summary from the description', () => {
    expect(splitMessage('Fix it\n\nLonger\nbody\n')).toEqual({
      summary: 'Fix it',
      description: 'Longer\nbody',
    });
    expect(splitMessage('Only a subject')).toEqual({ summary: 'Only a subject', description: '' });
    expect(splitMessage('a\r\n\r\nb')).toEqual({ summary: 'a', description: 'b' });
  });

  it('joins them back with a blank line, dropping an empty description', () => {
    expect(joinMessage(' Fix it ', '\nbody\n')).toBe('Fix it\n\nbody');
    expect(joinMessage('Fix it', '  ')).toBe('Fix it');
  });
});

describe('canAmendMessage', () => {
  it('allows only the tip of the checked-out branch', () => {
    setup({});
    expect(canAmendMessage('old')).toBe(true);
    expect(canAmendMessage('older')).toBe(false);
  });

  it('refuses a detached HEAD or an operation in progress', () => {
    setup({ branch: null });
    expect(canAmendMessage('old')).toBe(false);
    setup({}, 'merging');
    expect(canAmendMessage('old')).toBe(false);
  });
});

describe('amendHeadMessage', () => {
  it('amends, records an undo entry and reveals the new commit', async () => {
    const { reveal, record } = setup({});
    expect(await amendHeadMessage('old', '  New subject\n\nbody  ')).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(api.amendMessage).toHaveBeenCalledWith('/repo', 'old', 'New subject\n\nbody');
    expect(reveal).toHaveBeenCalledWith('new');
    const entry = record.mock.calls[0]![0] as { undo: (p: string) => Promise<unknown> };
    await entry.undo('/repo');
    expect(api.reset).toHaveBeenCalledWith('/repo', 'old', 'soft');
  });

  it('asks before rewriting a commit that is already on its upstream', async () => {
    setup({ upstream: 'origin/main', ahead: 0 });
    expect(headIsPushed()).toBe(true);
    confirm.mockResolvedValue(false);
    expect(await amendHeadMessage('old', 'New subject')).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(api.amendMessage).not.toHaveBeenCalled();

    confirm.mockResolvedValue(true);
    expect(await amendHeadMessage('old', 'New subject')).toBe(true);
    expect(api.amendMessage).toHaveBeenCalledOnce();
  });

  it('does not ask when HEAD is not pushed yet', async () => {
    setup({ upstream: 'origin/main', ahead: 2 });
    expect(headIsPushed()).toBe(false);
    expect(await amendHeadMessage('old', 'New subject')).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('ignores an empty message', async () => {
    setup({});
    expect(await amendHeadMessage('old', '  \n ')).toBe(false);
    expect(api.amendMessage).not.toHaveBeenCalled();
  });
});

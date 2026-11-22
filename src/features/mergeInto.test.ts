import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MergePreview, RepoInfo } from '@/lib/types';
import { useMergePreview } from '@/stores/mergePreview';
import { useRepo } from '@/stores/repo';
import type * as UiModule from '@/stores/ui';
import { mergeInto, previewMerge } from './actions';

const trial = (over: Partial<MergePreview>): MergePreview => ({
  ours: 'a',
  theirs: 'b',
  upToDate: false,
  fastForward: false,
  tree: 't',
  files: [],
  conflicts: [],
  messages: [],
  ...over,
});

const api = vi.hoisted(() => ({
  mergePreview: vi.fn(),
  merge: vi.fn(async () => null),
  info: vi.fn(async () => useRepo.getState().info!),
}));
vi.mock('@/lib/ipc', () => ({ api, isTauri: false }));

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/stores/ui', async (orig) => ({ ...(await orig<typeof UiModule>()), toast }));

const initial = useRepo.getState();

beforeEach(() => {
  useMergePreview.setState({ spec: null });
  useRepo.setState({
    path: '/repo',
    info: {
      state: 'clean',
      status: { branch: 'main', head: 'h', upstream: null, ahead: 0, behind: 0 },
    } as unknown as RepoInfo,
    reveal: vi.fn(async () => {}),
    record: vi.fn(),
    run: async (_label, fn) => {
      await fn('/repo');
      return true;
    },
  });
});
afterEach(() => {
  vi.clearAllMocks();
  useRepo.setState(initial, true);
});

describe('merging a branch into the current one', () => {
  it('merges straight away when the trial merge has no conflict', async () => {
    api.mergePreview.mockResolvedValue(trial({}));
    await mergeInto('feature');
    expect(api.merge).toHaveBeenCalledWith('/repo', 'feature', false);
    expect(useMergePreview.getState().spec).toBeNull();
  });

  it('opens the preview first when there are conflicts', async () => {
    api.mergePreview.mockResolvedValue(
      trial({
        conflicts: [{ path: 'a.ts', base: null, ours: null, theirs: null, kind: 'content' }],
      }),
    );
    await mergeInto('feature');
    expect(api.merge).not.toHaveBeenCalled();
    expect(useMergePreview.getState().spec).toMatchObject({ theirs: 'feature' });
  });

  it('only says so when there is nothing to merge', async () => {
    api.mergePreview.mockResolvedValue(trial({ upToDate: true }));
    await mergeInto('feature');
    expect(api.merge).not.toHaveBeenCalled();
    expect(useMergePreview.getState().spec).toBeNull();
    expect(toast).toHaveBeenCalledWith('info', expect.stringContaining('feature'));
  });

  it('falls back to the preview when the trial merge fails', async () => {
    api.mergePreview.mockRejectedValue(new Error('old git'));
    await mergeInto('feature');
    expect(api.merge).not.toHaveBeenCalled();
    expect(useMergePreview.getState().spec).toMatchObject({ theirs: 'feature' });
  });

  it('previews on request, whatever the trial says', () => {
    previewMerge('feature');
    expect(useMergePreview.getState().spec).toMatchObject({ theirs: 'feature' });
    expect(api.mergePreview).not.toHaveBeenCalled();
  });
});

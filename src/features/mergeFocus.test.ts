import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GitRef, Refs, RepoInfo } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { showMergeResult } from './actions';

const local = (name: string, target: string): GitRef => ({
  fullName: `refs/heads/${name}`,
  name,
  kind: 'local',
  target,
  isHead: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  upstreamGone: false,
  remote: null,
});

const initial = useRepo.getState();

function setup(head: string | null) {
  const reveal = vi.fn(async () => {});
  useRepo.setState({
    info: { status: { branch: 'main', head } } as unknown as RepoInfo,
    refs: {
      refs: [
        local('main', 'm2'),
        { ...local('develop', 'd1'), kind: 'remote' },
        local('develop', 'd2'),
      ],
    } as unknown as Refs,
    reveal,
  });
  return reveal;
}

afterEach(() => useRepo.setState(initial, true));

describe('showMergeResult', () => {
  it('selects the new HEAD after merging into the current branch', async () => {
    const reveal = setup('m2');
    await showMergeResult(null);
    expect(reveal).toHaveBeenCalledWith('m2');
  });

  it('selects the tip of the local branch merged into elsewhere', async () => {
    const reveal = setup('m2');
    await showMergeResult('develop');
    expect(reveal).toHaveBeenCalledWith('d2');
  });

  it('does nothing when the commit is unknown', async () => {
    const reveal = setup(null);
    await showMergeResult(null);
    await showMergeResult('gone');
    expect(reveal).not.toHaveBeenCalled();
  });
});

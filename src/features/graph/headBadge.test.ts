import type { MenuItem } from '@/components/ui';
import type { Commit, GitRef, RepoInfo, Refs } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { compareWithRemote } from '../actions';
import { groupRefs, headMenu } from './RefBadge';

const commit = (hash: string, ...parents: string[]): Commit => ({
  hash,
  parents,
  authorName: '',
  authorEmail: '',
  authorTime: 0,
  committerName: '',
  commitTime: 0,
  subject: hash,
});

const ref = (name: string, target: string, extra: Partial<GitRef> = {}): GitRef => ({
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
  ...extra,
});

const remote = (name: string, target: string): GitRef =>
  ref(name, target, { fullName: `refs/remotes/${name}`, kind: 'remote', remote: 'origin' });

const labels = (items: MenuItem[]) => items.map((i) => (i === 'sep' ? '—' : i.label));

// c ← b ← a (oldest); d branches off b.
beforeEach(() => {
  useRepo.setState({
    path: '/repo',
    info: { status: { branch: null, head: 'b' } } as unknown as RepoInfo,
    commits: [commit('c', 'b'), commit('d', 'b'), commit('b', 'a'), commit('a')],
    refs: { refs: [ref('topic', 'b')], remotes: [], stashes: [] } as unknown as Refs,
    worktrees: [],
  });
});

describe('HEAD badge', () => {
  it('puts a detached HEAD first, ticked, before the refs at that commit', () => {
    const groups = groupRefs([remote('origin/main', 'b'), ref('topic', 'b')], true);
    expect(groups.map((g) => [g.kind, g.label, g.head])).toEqual([
      ['head', 'HEAD', true],
      ['branch', 'topic', false],
      ['branch', 'origin/main', false],
    ]);
  });

  it('has no HEAD badge when HEAD is on a branch', () => {
    const groups = groupRefs([ref('main', 'b', { isHead: true })], false);
    expect(groups.map((g) => [g.kind, g.head])).toEqual([['branch', true]]);
    expect(groupRefs([], false)).toEqual([]);
  });

  it('offers to keep a detached HEAD on a branch', () => {
    expect(labels(headMenu())).toEqual([
      'Create branch here',
      'Check out topic',
      '—',
      'Copy commit sha',
      'Create patch from commit',
      '—',
      'Create tag here',
      'Create annotated tag here',
    ]);
  });
});

describe('compareWithRemote', () => {
  it('uses ahead/behind of the tracked branch', () => {
    const r = remote('origin/topic', 'x');
    const tracked = (ahead: number, behind: number) =>
      ref('topic', 'y', { upstream: 'origin/topic', ahead, behind });
    expect(compareWithRemote(tracked(0, 2), r)).toBe('behind');
    expect(compareWithRemote(tracked(1, 0), r)).toBe('ahead');
    expect(compareWithRemote(tracked(1, 2), r)).toBe('diverged');
  });

  it('falls back to the loaded graph', () => {
    expect(compareWithRemote(ref('topic', 'b'), remote('origin/topic', 'b'))).toBe('same');
    expect(compareWithRemote(ref('topic', 'a'), remote('origin/topic', 'c'))).toBe('behind');
    expect(compareWithRemote(ref('topic', 'c'), remote('origin/topic', 'a'))).toBe('ahead');
    expect(compareWithRemote(ref('topic', 'c'), remote('origin/topic', 'd'))).toBe('diverged');
    expect(compareWithRemote(ref('topic', 'c'), remote('origin/topic', 'zzz'))).toBe('unknown');
  });
});

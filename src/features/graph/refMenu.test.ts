import type { MenuItem } from '@/components/ui';
import type { Commit, GitRef, RepoInfo, Refs, Worktree } from '@/lib/types';
import { useCompare } from '@/stores/compare';
import { useRepo } from '@/stores/repo';
import * as A from '../actions';
import { refMenu } from './RefBadge';

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

const branch = (name: string, target: string, extra: Partial<GitRef> = {}): GitRef => ({
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

const worktree = (path: string, name: string, head: string, isCurrent = false): Worktree => ({
  path,
  head,
  branch: name,
  isMain: isCurrent,
  isCurrent,
  bare: false,
  locked: false,
  prunable: false,
});

/** Labels of the menu, separators as '—', submenus as "label > a | b". */
const labels = (items: MenuItem[]) =>
  items.map((i) =>
    i === 'sep'
      ? '—'
      : i.items
        ? `${i.label} > ${i.items.map((s) => (s === 'sep' ? '—' : s.label)).join(' | ')}`
        : i.label,
  );

// m (main, HEAD) ← d ← f (feature, checked out in another worktree); x branches off d.
const main = branch('main', 'm', { isHead: true });
const feature = branch('feature/x', 'f', { upstream: 'origin/feature/x' });
const ahead = branch('next', 'n');
const side = branch('side', 'x');

beforeEach(() => {
  useRepo.setState({
    path: '/repo',
    info: { status: { branch: 'main', head: 'm' } } as unknown as RepoInfo,
    commits: [commit('n', 'm'), commit('m', 'd'), commit('x', 'd'), commit('d', 'f'), commit('f')],
    refs: { refs: [main, feature, ahead, side], remotes: [], stashes: [] } as unknown as Refs,
    worktrees: [worktree('/repo', 'main', 'm', true), worktree('/repo-feature', 'feature/x', 'f')],
  });
});

describe('refMenu', () => {
  it('offers GitKraken entries for a branch behind HEAD checked out in a worktree', () => {
    expect(labels(refMenu(feature))).toEqual([
      'Pull (fast-forward if possible)',
      'Push',
      'Set Upstream',
      '—',
      'Fast-forward feature/x to main',
      'Merge main into feature/x',
      'Rebase main onto feature/x',
      '—',
      'Open worktree from feature/x',
      'Checkout this commit',
      '—',
      'Create worktree from this commit',
      '—',
      'Create branch here',
      'Reset main to this commit > Soft - keep all changes | Mixed - keep working copy but reset index | Hard - discard all changes',
      'Revert commit',
      '—',
      'Rename feature/x…',
      'Remove this worktree',
      'Remove worktree and delete branch',
      '—',
      'Copy branch name',
      'Copy commit sha',
      'Create patch from commit',
      '—',
      'Compare main → feature/x',
      'Mark as compare base',
      '—',
      'Pin to Left',
      'Solo',
      'Hide',
      '—',
      'Create tag here',
      'Create annotated tag here',
    ]);
  });

  it('compares with HEAD and with a marked base', () => {
    useCompare.getState().markBase(A.refSide(side));
    const l = labels(refMenu(feature));
    expect(l).toContain('Compare main → feature/x');
    expect(l).toContain('Compare side → feature/x');
    // Not offered against itself.
    expect(labels(refMenu(side))).not.toContain('Compare side → side');
    useCompare.getState().markBase(null);
  });

  it('fast-forwards HEAD to a branch ahead of it', () => {
    const l = labels(refMenu(ahead));
    expect(l).toContain('Fast-forward main to next');
    expect(l).toContain('Merge next into main');
    expect(l).toContain('Check out next');
    expect(l).toContain('Create worktree from next');
    expect(l).toContain('Cherry pick commit');
    expect(l).not.toContain('Revert commit');
    // No upstream and no worktree: nothing to pull from.
    expect(l).not.toContain('Pull (fast-forward if possible)');
    expect(l).toContain('Delete next');
  });

  it('only merges and rebases a diverged branch', () => {
    const l = labels(refMenu(side));
    expect(l.filter((x) => x.startsWith('Fast-forward'))).toEqual([]);
    expect(l).toContain('Merge side into main');
    expect(l).toContain('Rebase main onto side');
  });

  it('keeps the checked-out branch menu free of merge / checkout entries', () => {
    const l = labels(refMenu(main));
    expect(l.slice(0, 3)).toEqual(['Pull (fast-forward if possible)', 'Push', 'Set Upstream']);
    expect(l.some((x) => /^(Merge|Rebase|Fast-forward|Check out|Reset)/.test(x))).toBe(false);
    expect(l).toContain('Checkout this commit');
  });
});

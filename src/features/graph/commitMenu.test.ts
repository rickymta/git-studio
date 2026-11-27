import { beforeEach, describe, expect, it } from 'vitest';

import type { MenuItem } from '@/components/ui';
import type { Commit, RepoInfo, Refs } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { commitMenu, stashMenu, wipMenu } from './commitMenu';

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

const labels = (items: MenuItem[]) => items.map((i) => (i === 'sep' ? '—' : i.label));
const item = (items: MenuItem[], label: string) =>
  items.find((i): i is Exclude<MenuItem, 'sep'> => i !== 'sep' && i.label === label);

// HEAD at c: c ← b ← a (oldest); y ← x on another branch off a.
const commits = [
  commit('c', 'b'),
  commit('y', 'x'),
  commit('x', 'a'),
  commit('b', 'a'),
  commit('a'),
];
const pick = (...hashes: string[]) => commits.filter((c) => hashes.includes(c.hash));

beforeEach(() => {
  useRepo.setState({
    path: '/repo',
    info: { status: { branch: 'main', head: 'c' } } as unknown as RepoInfo,
    commits,
    refs: { refs: [], remotes: [], stashes: [] } as unknown as Refs,
    worktrees: [],
  });
});

describe('commit menu with several picked commits', () => {
  it('offers to cherry-pick the commits of another branch', () => {
    const items = commitMenu(commits[1]!, pick('y', 'x'));
    const l = labels(items);
    expect(l).toContain('Cherry pick 2 commits');
    expect(l).toContain('Copy commit shas');
    expect(l).toContain('Create patch from commits');
    expect(l).toContain('Compare the 2 selected commits');
    expect(l).not.toContain('Squash 2 commits');
    expect(item(items, 'Drop 2 commits')?.disabled).toBe(true);
  });

  it('offers to squash, drop and move commits of the current branch', () => {
    const items = commitMenu(commits[3]!, pick('b', 'a'));
    const l = labels(items);
    expect(l).toContain('Squash 2 commits');
    expect(item(items, 'Drop 2 commits')?.disabled).toBe(false);
    expect(l).toContain('Move 2 commits up');
    // `a` is the root commit: nothing older to move past.
    expect(l).not.toContain('Move 2 commits down');
    expect(l).not.toContain('Cherry pick 2 commits');
    // The single-commit entries give way to the plural ones.
    expect(l).not.toContain('Drop commit');
    expect(l).not.toContain('Copy commit sha');
  });

  it('cannot move a block holding HEAD further up', () => {
    const l = labels(commitMenu(commits[0]!, pick('c', 'b')));
    expect(l).not.toContain('Move 2 commits up');
    expect(l).toContain('Move 2 commits down');
  });

  it('cherry-picks only the picked commits not already on the branch', () => {
    expect(labels(commitMenu(commits[1]!, pick('y', 'b')))).toContain('Cherry pick commit');
  });

  it('is the single-commit menu when the right-clicked commit is not picked', () => {
    const l = labels(commitMenu(commits[0]!, pick('y', 'x')));
    expect(l).toContain('Copy commit sha');
    expect(l).not.toContain('Cherry pick 2 commits');
  });
});

describe('menus that are the same wherever the object is right-clicked', () => {
  const status = (unstaged: number, staged: number) =>
    ({
      status: {
        branch: 'main',
        head: 'c',
        unstaged: Array.from({ length: unstaged }, (_, i) => ({ path: `u${i}`, status: 'M' })),
        staged: Array.from({ length: staged }, (_, i) => ({ path: `s${i}`, status: 'M' })),
      },
    }) as unknown as RepoInfo;

  it('gives the WIP its own menu', () => {
    useRepo.setState({ info: status(2, 0) });
    const items = wipMenu();
    expect(labels(items)).toEqual([
      'Stage All Changes',
      'Unstage All Changes',
      '—',
      'Stash changes',
      '—',
      'Discard all changes',
      'Clean untracked files…',
    ]);
    expect(item(items, 'Stage All Changes')?.disabled).toBe(false);
    expect(item(items, 'Unstage All Changes')?.disabled).toBe(true);
    expect(item(items, 'Discard all changes')?.danger).toBe(true);
  });

  it('greys out what has nothing to act on when the working tree is clean', () => {
    useRepo.setState({ info: status(0, 0) });
    const items = wipMenu();
    for (const l of ['Stage All Changes', 'Unstage All Changes', 'Stash changes'])
      expect(item(items, l)?.disabled).toBe(true);
  });

  it('builds one stash menu for the graph row and the sidebar', () => {
    const s = { name: 'stash@{0}', hash: 'st', message: 'wip', time: 0, base: 'c' };
    expect(labels(stashMenu(s as never))).toContain('Edit stash message');
  });
});

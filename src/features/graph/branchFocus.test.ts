import { describe, expect, it } from 'vitest';

import { layoutGraph } from '@/lib/graph';
import type { Commit } from '@/lib/types';
import { branchRows, rowIndex } from './branchFocus';

const c = (hash: string, ...parents: string[]): Commit => ({
  hash,
  parents,
  authorName: '',
  authorEmail: '',
  authorTime: 0,
  committerName: '',
  commitTime: 0,
  subject: hash,
});

/** Lit rows for `tip`, as commit hashes in list order. */
function lit(commits: Commit[], tip: string, pinned: string[] = []): string[] {
  const rows = layoutGraph(commits, pinned);
  const set = branchRows(commits, rows, rowIndex(commits), tip);
  return [...set].sort((a, b) => a - b).map((i) => commits[i]!.hash);
}

describe('branchRows', () => {
  it('lights a whole linear history from its tip', () => {
    const commits = [c('c', 'b'), c('b', 'a'), c('a')];
    expect(lit(commits, 'c')).toEqual(['c', 'b', 'a']);
    // From a commit lower down, only it and what is below it.
    expect(lit(commits, 'b')).toEqual(['b', 'a']);
  });

  it('follows a merged feature branch down its lane and stops where it forks off', () => {
    // m merges feature (f2 → f1) into main (b); both come from a.
    const commits = [c('m', 'b', 'f2'), c('f2', 'f1'), c('b', 'a'), c('f1', 'a'), c('a')];
    expect(lit(commits, 'f2')).toEqual(['f2', 'f1']);
    // The merge's second parent is not part of main's lane.
    expect(lit(commits, 'm')).toEqual(['m', 'b', 'a']);
  });

  it('lights only the tip when its line joins another lane straight away', () => {
    // y's parent a is already on x's lane (lane 0), so y's own line ends at a.
    const commits = [c('x', 'a'), c('y', 'a'), c('a')];
    expect(lit(commits, 'y')).toEqual(['y']);
    expect(lit(commits, 'x')).toEqual(['x', 'a']);
  });

  it('follows the lane a pinned branch was moved to', () => {
    const commits = [c('x', 'a'), c('y', 'a'), c('a')];
    // Pinning y gives it lane 0, so now x is the one that joins.
    expect(lit(commits, 'y', ['y'])).toEqual(['y', 'a']);
    expect(lit(commits, 'x', ['y'])).toEqual(['x']);
  });

  it('stops at the end of the loaded commits', () => {
    // b's parent is not loaded yet (next page).
    expect(lit([c('c', 'b'), c('b', 'older')], 'c')).toEqual(['c', 'b']);
  });

  it('is empty for a tip that is not in the list', () => {
    expect(lit([c('a')], 'gone')).toEqual([]);
  });
});

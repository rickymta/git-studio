import { describe, expect, it } from 'vitest';

import type { Commit } from '@/lib/types';
import { pickCommits } from '../graph/menuUtils';
import { isNoop, moveBlock, moveRow, planRows, rebaseProblem, toSteps } from './plan';

const commit = (hash: string, extra: Partial<Commit> = {}): Commit => ({
  hash,
  parents: [],
  authorName: '',
  authorEmail: '',
  authorTime: 0,
  committerName: '',
  commitTime: 0,
  subject: hash,
  ...extra,
});

// Oldest first, as the rebase plan lists them.
const plan = ['a', 'b', 'c', 'd'].map((h) => commit(h));
const order = (rows: ReturnType<typeof planRows>) =>
  rows.map((r) => `${r.action}:${r.commit.hash}`);

describe('planRows', () => {
  it('picks every commit by default', () => {
    expect(order(planRows(plan))).toEqual(['pick:a', 'pick:b', 'pick:c', 'pick:d']);
    expect(isNoop(planRows(plan), plan)).toBe(true);
  });

  it('moves squashed commits right after the oldest of them', () => {
    const rows = planRows(plan, { squash: ['d', 'b'] });
    expect(order(rows)).toEqual(['pick:a', 'pick:b', 'squash:d', 'pick:c']);
    expect(rebaseProblem(rows)).toBeNull();
    expect(isNoop(rows, plan)).toBe(false);
  });

  it('marks dropped commits', () => {
    const rows = planRows(plan, { drop: ['a', 'c'] });
    expect(order(rows)).toEqual(['drop:a', 'pick:b', 'drop:c', 'pick:d']);
  });
});

describe('rebaseProblem', () => {
  it('needs a kept commit, a first kept commit that is not folded, and reword messages', () => {
    const all = planRows(plan, { drop: ['a', 'b', 'c', 'd'] });
    expect(rebaseProblem(all)).not.toBeNull();

    const rows = planRows(plan, { drop: ['a'] });
    rows[1] = { ...rows[1]!, action: 'fixup' };
    expect(rebaseProblem(rows)).not.toBeNull();

    rows[1] = { ...rows[1]!, action: 'reword', message: '  ' };
    expect(rebaseProblem(rows)).not.toBeNull();
    rows[1] = { ...rows[1]!, message: 'B, better' };
    expect(rebaseProblem(rows)).toBeNull();
    expect(toSteps(rows)[1]).toEqual({ action: 'reword', hash: 'b', message: 'B, better' });
    expect(toSteps(rows)[0]).toEqual({ action: 'drop', hash: 'a' });
  });
});

describe('moveRow', () => {
  it('swaps neighbours and ignores moves past either end', () => {
    const rows = planRows(plan);
    expect(order(moveRow(rows, 1, -1)).slice(0, 2)).toEqual(['pick:b', 'pick:a']);
    expect(moveRow(rows, 0, -1)).toBe(rows);
    expect(moveRow(rows, 3, 1)).toBe(rows);
  });
});

describe('pickCommits', () => {
  // Graph order: newest first, with a stash row.
  const graph = [
    commit('d'),
    commit('s', { stash: {} as Commit['stash'] }),
    commit('c'),
    commit('b'),
  ];

  it('toggles a commit in the selection', () => {
    expect(pickCommits(graph, ['d'], 2)).toEqual(['d', 'c']);
    expect(pickCommits(graph, ['d', 'c'], 0)).toEqual(['c']);
  });

  it('selects the range from the anchor, skipping stash rows', () => {
    expect(pickCommits(graph, ['d'], 3, 0)).toEqual(['d', 'c', 'b']);
    expect(pickCommits(graph, [], 0, 3)).toEqual(['d', 'c', 'b']);
  });
});

describe('moveBlock', () => {
  const rows = planRows(plan);
  const hashes = (r: ReturnType<typeof moveBlock>) => r?.map((x) => x.commit.hash) ?? null;

  it('moves adjacent commits past their older neighbour', () => {
    expect(hashes(moveBlock(rows, ['c', 'b'], true))).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves adjacent commits past their newer neighbour', () => {
    expect(hashes(moveBlock(rows, ['b', 'c'], false))).toEqual(['a', 'd', 'b', 'c']);
  });

  it('refuses commits that are not next to each other or not in the plan', () => {
    expect(moveBlock(rows, ['a', 'c'], true)).toBeNull();
    expect(moveBlock(rows, ['b', 'z'], true)).toBeNull();
  });

  it('has nothing to move past at either end', () => {
    expect(moveBlock(rows, ['a', 'b'], true)).toBeNull();
    expect(moveBlock(rows, ['c', 'd'], false)).toBeNull();
  });
});

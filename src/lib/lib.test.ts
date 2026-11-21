import { hunkPatch, parseDiff } from './diff';
import { extendGraph, hueGap, layoutGraph, wipRowOf, withStashes } from './graph';
import type { Commit } from './types';

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

describe('layoutGraph', () => {
  it('keeps a linear history in one lane', () => {
    const rows = layoutGraph([c('c', 'b'), c('b', 'a'), c('a')]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows[2]!.segments).toEqual([{ fromLane: 0, fromY: 0, toLane: 0, toY: 1, color: 0 }]);
  });

  it('opens a second lane for a merge and closes it at the fork point', () => {
    // m merges f into main; f and b both come from a.
    const rows = layoutGraph([c('m', 'b', 'f'), c('f', 'a'), c('b', 'a'), c('a')]);
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 0, 0]);
    // Lane 1 converges into a.
    expect(rows[3]!.segments.some((s) => s.fromLane === 1 && s.toLane === 0)).toBe(true);
    expect(rows[0]!.width).toBe(2);
  });

  it('gives an unrelated branch tip its own lane', () => {
    const rows = layoutGraph([c('x', 'a'), c('y', 'a'), c('a')]);
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 0]);
  });

  it('hangs a stash off its base with a dotted line in the same colour', () => {
    const stash = { index: 0, name: 'stash@{0}', hash: 's', message: 'wip', time: 5, base: 'b' };
    const commits = [
      { ...c('c', 'b'), commitTime: 9 },
      { ...c('b', 'a'), commitTime: 4 },
      { ...c('a'), commitTime: 1 },
    ];
    const rows = withStashes(commits, [stash]);
    expect(rows.map((r) => r.hash)).toEqual(['c', 's', 'b', 'a']);
    const g = layoutGraph(rows);
    expect(g[1]!.lane).toBe(1);
    expect(g[1]!.color).toBe(g[0]!.color);
    expect(g[1]!.segments.find((s) => s.fromLane === 1)?.dashed).toBe(true);
    // b stays on the main line; the dotted link joins it there.
    expect(g[2]!.lane).toBe(0);
    expect(g[2]!.segments.some((s) => s.fromLane === 1 && s.toLane === 0 && s.dashed)).toBe(true);
  });

  it('keeps a pinned branch in the leftmost lane', () => {
    // x is the newest tip; pinning y moves y's history to lane 0 and x to lane 1.
    const rows = layoutGraph([c('x', 'a'), c('y', 'a'), c('a')], ['y']);
    expect(rows.map((r) => r.lane)).toEqual([1, 0, 0]);
    // Nothing is drawn in lane 0 above y's own row.
    expect(rows[0]!.segments.some((s) => s.fromLane === 0 || s.toLane === 0)).toBe(false);
    // A child whose first parent is the pinned tip joins its lane.
    const stacked = layoutGraph([c('f', 'm'), c('m', 'a'), c('a')], ['m']);
    expect(stacked.map((r) => r.lane)).toEqual([1, 0, 0]);
    expect(stacked[1]!.segments.some((s) => s.fromLane === 1 && s.toLane === 0)).toBe(true);
  });

  it('gives neighbouring lanes clearly different colours', () => {
    // Five branch tips side by side, all forking from a.
    const tips = ['p', 'q', 'r', 's', 't'];
    const rows = layoutGraph([...tips.map((h) => c(h, 'a')), c('a')]);
    const colorOf = new Map(rows.slice(0, 5).map((r) => [r.lane, r.color]));
    for (let lane = 1; lane < 5; lane++) {
      expect(hueGap(colorOf.get(lane)!, colorOf.get(lane - 1)!)).toBeGreaterThanOrEqual(60);
    }
    // A merged branch's line contrasts with the line it merges into.
    const merge = layoutGraph([c('m', 'b', 'f'), c('f', 'a'), c('b', 'a'), c('a')]);
    expect(hueGap(merge[1]!.color, merge[0]!.color)).toBeGreaterThanOrEqual(60);
  });

  it('lays out a page after the others as if all were laid out at once', () => {
    // main with merged branches, cut into pages at awkward places (inside open lanes).
    const all = [
      c('m2', 'b3', 'f2'),
      c('f2', 'f1'),
      c('b3', 'm1'),
      c('f1', 'b2'),
      c('m1', 'b2', 'g1'),
      c('g1', 'b1'),
      c('b2', 'b1'),
      c('x', 'b1'),
      c('b1', 'a'),
      c('a'),
    ];
    const whole = layoutGraph(all);
    for (const cut of [1, 3, 5, 8]) {
      const paged = extendGraph(layoutGraph(all.slice(0, cut)), all.slice(cut));
      expect(paged).toEqual(whole);
    }
    // Three pages in a row.
    const three = extendGraph(
      extendGraph(layoutGraph(all.slice(0, 2)), all.slice(2, 6))!,
      all.slice(6),
    );
    expect(three).toEqual(whole);
    // Rows that were not laid out here have no state to continue from.
    expect(extendGraph(whole.slice(), [])).toBeNull();
  });

  it('remembers where each line starts', () => {
    const rows = layoutGraph([c('m', 'b', 'f'), c('f', 'a'), c('b', 'a'), c('a')]);
    // Main line: from the tip m. The merged line: opened by the merge m.
    expect(rows[0]!.from).toEqual({ hash: 'm', merge: false });
    expect(rows[1]!.from).toEqual({ hash: 'm', merge: true });
    expect(rows[2]!.from).toEqual({ hash: 'm', merge: false });
    const tips = layoutGraph([c('x', 'a'), c('y', 'a'), c('a')]);
    expect(tips[1]!.from).toEqual({ hash: 'y', merge: false });
    expect(tips[2]!.from).toEqual({ hash: 'x', merge: false });
  });

  it('links uncommitted changes to HEAD however far below it is', () => {
    // Newer commits of another branch (x, y) sit between the WIP row and HEAD (h).
    const commits = [c('x', 'y'), c('y', 'a'), c('h', 'a'), c('a')];
    const rows = layoutGraph(commits, [], 'h');
    const wip = wipRowOf(rows)!;
    expect(wip.lane).toBe(0);
    expect(wip.segments).toEqual([
      { fromLane: 0, fromY: 1, toLane: 0, toY: 2, color: wip.color, dashed: true },
    ]);
    // The dotted lane passes x and y, the other branch takes the next lane.
    for (const r of rows.slice(0, 2)) {
      expect(r.lane).toBe(1);
      expect(r.segments).toContainEqual({
        fromLane: 0,
        fromY: 0,
        toLane: 0,
        toY: 2,
        color: wip.color,
        dashed: true,
      });
    }
    // HEAD carries on in the WIP lane, dotted from the top of its row to its node.
    expect(rows[2]!.lane).toBe(0);
    expect(rows[2]!.segments).toContainEqual({
      fromLane: 0,
      fromY: 0,
      toLane: 0,
      toY: 1,
      color: wip.color,
      dashed: true,
    });
    // Without changes there is no WIP row.
    expect(wipRowOf(layoutGraph(commits))).toBeNull();
    // HEAD not loaded yet (a long history): the dotted lane runs on past the loaded rows.
    const far = layoutGraph(commits, [], 'older');
    expect(wipRowOf(far)!.lane).toBe(0);
    expect(far[3]!.segments.some((s) => s.fromLane === 0 && s.toY === 2 && s.dashed)).toBe(true);
  });

  it('puts the WIP lane after the pinned ones and keeps it across pages', () => {
    const commits = [c('x', 'y'), c('y', 'a'), c('h', 'a'), c('a')];
    const pinned = layoutGraph(commits, ['y'], 'h');
    expect(wipRowOf(pinned)!.lane).toBe(1);
    expect(pinned[1]!.lane).toBe(0); // the pinned tip y
    const first = layoutGraph(commits.slice(0, 2), [], 'h');
    const paged = extendGraph(first, commits.slice(2))!;
    expect(wipRowOf(paged)).toEqual(wipRowOf(first));
    expect(paged).toEqual(layoutGraph(commits, [], 'h'));
  });
});

describe('parseDiff', () => {
  const text = [
    'diff --git a/f.txt b/f.txt',
    'index 1..2 100644',
    '--- a/f.txt',
    '+++ b/f.txt',
    '@@ -1,3 +1,3 @@',
    ' a',
    '-b',
    '+B',
    ' c',
    '@@ -10,2 +10,3 @@ fn x',
    ' y',
    '+z',
    ' w',
    '',
  ].join('\n');

  it('numbers lines', () => {
    const d = parseDiff(text);
    expect(d.hunks).toHaveLength(2);
    expect(d.hunks[0]!.lines[2]).toMatchObject({ kind: 'add', newNo: 2, oldNo: null });
    expect(d.hunks[1]!.lines[2]).toMatchObject({ kind: 'ctx', oldNo: 11, newNo: 12 });
  });

  it('builds a single-hunk patch', () => {
    const p = hunkPatch(parseDiff(text), 1);
    expect(p).toBe(
      'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -10,2 +10,3 @@ fn x\n y\n+z\n w\n',
    );
  });

  it('flags binary files', () => {
    expect(parseDiff('diff --git a/x b/x\nBinary files a/x and b/x differ\n').binary).toBe(true);
  });
});

import { changeBlocks, parseConflicts, resolveConflicts } from './diff';

describe('diff extras', () => {
  it('keeps CR in patches but not in display', () => {
    const d = parseDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\r\n+b\r\n');
    expect(d.hunks[0]!.lines[0]!.text).toBe('a');
    expect(hunkPatch(d, 0)).toContain('-a\r\n+b\r\n');
  });

  it('finds change blocks', () => {
    const d = parseDiff(
      'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,5 +1,5 @@\n a\n-b\n+B\n c\n-d\n+D\n',
    );
    expect(changeBlocks(d)).toEqual([
      { hunk: 0, line: 1 },
      { hunk: 0, line: 4 },
    ]);
  });

  it('parses and resolves conflict markers', () => {
    const text =
      'top\n<<<<<<< HEAD\nmine\n||||||| base\nold\n=======\ntheirs\n>>>>>>> feature\nend';
    const parts = parseConflicts(text);
    expect(parts).toHaveLength(3);
    const c = parts[1]!;
    expect(c.type === 'conflict' && c.ours).toEqual(['mine']);
    expect(c.type === 'conflict' && c.base).toEqual(['old']);
    expect(resolveConflicts(parts, [{ ours: false, theirs: true }])).toBe('top\ntheirs\nend');
    expect(resolveConflicts(parts, [{ ours: true, theirs: true }])).toBe('top\nmine\ntheirs\nend');
  });
});

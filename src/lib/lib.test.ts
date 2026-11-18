import { hunkPatch, parseDiff } from './diff';
import { layoutGraph } from './graph';
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

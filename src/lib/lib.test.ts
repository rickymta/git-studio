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

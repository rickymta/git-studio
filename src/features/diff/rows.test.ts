import { parseDiff, type DiffLine } from '@/lib/diff';
import {
  buildRows,
  focusBlock,
  pairLines,
  scrollTargetRow,
  visualWidth,
  type DiffRow,
} from './rows';

const ctx = (no: number, text = `c${no}`): DiffLine => ({
  kind: 'ctx',
  text,
  oldNo: no,
  newNo: no,
});
const del = (no: number, text = `d${no}`): DiffLine => ({
  kind: 'del',
  text,
  oldNo: no,
  newNo: null,
});
const add = (no: number, text = `a${no}`): DiffLine => ({
  kind: 'add',
  text,
  oldNo: null,
  newNo: no,
});

// Whole-file diff of a 12-line file: line 2 replaced by 3 lines, lines 9-10 removed.
const FULL = [
  'diff --git a/f.txt b/f.txt',
  '--- a/f.txt',
  '+++ b/f.txt',
  '@@ -1,12 +1,12 @@',
  ' one',
  '-two',
  '+TWO',
  '+TWO.b',
  '+TWO.c',
  ' three',
  ' four',
  ' five',
  ' six',
  ' seven',
  ' eight',
  '-nine',
  '-ten',
  ' eleven',
  ' twelve',
  '',
].join('\n');

// The same change with 3 lines of context: two hunks.
const NORMAL = [
  'diff --git a/f.txt b/f.txt',
  '--- a/f.txt',
  '+++ b/f.txt',
  '@@ -1,5 +1,7 @@',
  ' one',
  '-two',
  '+TWO',
  '+TWO.b',
  '+TWO.c',
  ' three',
  ' four',
  ' five',
  '@@ -6,7 +8,5 @@',
  ' six',
  ' seven',
  ' eight',
  '-nine',
  '-ten',
  ' eleven',
  ' twelve',
  '',
].join('\n');

const sides = (rows: DiffRow[]) =>
  rows.flatMap((r) => (r.type === 'pair' ? [[r.a?.text ?? null, r.b?.text ?? null]] : []));

describe('pairLines (split alignment)', () => {
  it('faces each deletion with the addition at the same position and fills the shorter side', () => {
    const rows = pairLines([ctx(1), del(2), del(3), del(4), add(2), ctx(5)]);
    expect(rows.map((r) => [r.a?.text ?? null, r.b?.text ?? null])).toEqual([
      ['c1', 'c1'],
      ['d2', 'a2'],
      ['d3', null],
      ['d4', null],
      ['c5', 'c5'],
    ]);
    // Only the first row of a change run carries the source index (the block anchor).
    expect(rows.map((r) => r.li)).toEqual([0, 1, -1, -1, 5]);
  });

  it('fills the old side when more lines were added than removed', () => {
    const rows = pairLines([del(1), add(1), add(2), add(3)]);
    expect(rows.map((r) => [r.a?.text ?? null, r.b?.text ?? null])).toEqual([
      ['d1', 'a1'],
      [null, 'a2'],
      [null, 'a3'],
    ]);
  });

  it('keeps old and new line numbers aligned row for row', () => {
    const { rows } = buildRows(parseDiff(FULL), 'split');
    const pairs = rows.filter((r) => r.type === 'pair');
    // Every row is either both sides or a filler on one; each side counts up without gaps.
    const olds = pairs.flatMap((p) => (p.a ? [p.a.oldNo] : []));
    const news = pairs.flatMap((p) => (p.b ? [p.b.newNo] : []));
    expect(olds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(news).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(sides(rows).slice(1, 4)).toEqual([
      ['two', 'TWO'],
      [null, 'TWO.b'],
      [null, 'TWO.c'],
    ]);
    expect(sides(rows).slice(10, 12)).toEqual([
      ['nine', null],
      ['ten', null],
    ]);
  });
});

describe('buildRows', () => {
  it('gives the hunk layout a header per hunk and anchors each change block', () => {
    const { rows, blockRows } = buildRows(parseDiff(NORMAL), 'hunk');
    expect(rows.filter((r) => r.type === 'header')).toHaveLength(2);
    expect(rows[0]).toMatchObject({ type: 'header', hunk: 0 });
    expect(blockRows).toHaveLength(2);
    expect(rows[blockRows[0]!]).toMatchObject({ type: 'line', line: { text: 'two' }, block: 0 });
    expect(rows[blockRows[1]!]).toMatchObject({ type: 'line', line: { text: 'nine' }, block: 1 });
  });

  it('interleaves removed and added lines in the inline layout', () => {
    const { rows, blockRows } = buildRows(parseDiff(FULL), 'inline');
    const kinds = rows.flatMap((r) => (r.type === 'line' ? [r.line.kind] : []));
    expect(kinds.slice(0, 6)).toEqual(['ctx', 'del', 'add', 'add', 'add', 'ctx']);
    expect(blockRows).toEqual([1, 11]);
  });

  it('puts the hunk buttons of the normal diff before the matching change', () => {
    const { rows } = buildRows(parseDiff(FULL), 'split', parseDiff(NORMAL));
    const at = rows.flatMap((r, i) => (r.type === 'action' ? [[i, r.action]] : []));
    expect(at).toHaveLength(2);
    expect(rows[at[0]![0]! + 1]).toMatchObject({ type: 'pair', a: { text: 'two' } });
    expect(at[0]![1]).toBe(0);
    expect(rows[at[1]![0]! + 1]).toMatchObject({ type: 'pair', a: { text: 'nine' } });
    expect(at[1]![1]).toBe(1);
  });

  it('keeps the same change blocks in every layout', () => {
    const full = parseDiff(FULL);
    const inline = buildRows(full, 'inline', parseDiff(NORMAL));
    const split = buildRows(full, 'split', parseDiff(NORMAL));
    const hunk = buildRows(parseDiff(NORMAL), 'hunk');
    expect(inline.blockRows).toHaveLength(2);
    expect(split.blockRows).toHaveLength(2);
    expect(hunk.blockRows).toHaveLength(2);
  });

  it('measures the widest line per side', () => {
    const { cols } = buildRows(parseDiff(FULL), 'split');
    expect(cols).toEqual({ a: 6, b: 6 });
  });
});

describe('first change', () => {
  it('focuses the first change of a new diff and keeps the current one on layout change', () => {
    expect(focusBlock(3, -1)).toBe(0);
    expect(focusBlock(3, 2)).toBe(2);
    expect(focusBlock(3, 5)).toBe(0);
    expect(focusBlock(0, -1)).toBe(-1);
  });

  it('starts at the hunk header when it sits just above the change (hunk layout)', () => {
    const m = buildRows(parseDiff(NORMAL), 'hunk');
    // Hunk 1: header, 3 context lines, then the change.
    expect(scrollTargetRow(m.blockRows, 1, 3, m.rows)).toBe(m.blockRows[1]! - 4);
    expect(m.rows[scrollTargetRow(m.blockRows, 1, 3, m.rows)]).toMatchObject({ type: 'header' });
    expect(scrollTargetRow(m.blockRows, 0, 3, m.rows)).toBe(0);
  });

  it('scrolls so the change sits a few rows below the top', () => {
    expect(scrollTargetRow([10, 40], 0)).toBe(7);
    expect(scrollTargetRow([10, 40], 1)).toBe(37);
    expect(scrollTargetRow([1], 0)).toBe(0);
    expect(scrollTargetRow([], 0)).toBe(0);
  });

  it('lands on the first changed line of a real diff', () => {
    const { rows, blockRows } = buildRows(parseDiff(FULL), 'inline');
    const top = scrollTargetRow(blockRows, focusBlock(blockRows.length, -1));
    expect(top).toBe(0);
    const { rows: r2, blockRows: b2 } = buildRows(parseDiff(FULL), 'split');
    expect(r2[b2[1]!]).toMatchObject({ a: { text: 'nine' } });
    expect(scrollTargetRow(b2, 1)).toBe(b2[1]! - 3);
    expect(rows.length).toBe(15);
  });
});

describe('visualWidth', () => {
  it('expands tabs to the next tab stop', () => {
    expect(visualWidth('abc')).toBe(3);
    expect(visualWidth('\tx')).toBe(5);
    expect(visualWidth('ab\tx')).toBe(5);
    expect(visualWidth('abcd\tx', 4)).toBe(9);
  });
});

import { describe, expect, it } from 'vitest';

import { parseConflicts } from '@/lib/diff';
import {
  conflictOutput,
  layoutRows,
  resolvedText,
  toggleLine,
  toggleSide,
  unresolvedCount,
  type Pick,
} from './conflictModel';

const FILE = [
  'top',
  '<<<<<<< main',
  'a1',
  'a2',
  'a3',
  '||||||| base',
  'base1',
  '=======',
  'b1',
  '>>>>>>> other',
  'middle',
  '<<<<<<< main',
  'x',
  '||||||| base',
  '=======',
  'y1',
  'y2',
  '>>>>>>> other',
  'end',
].join('\n');

const parts = parseConflicts(FILE);
const c0 = parts.find((p) => p.type === 'conflict' && p.index === 0)! as Extract<
  (typeof parts)[number],
  { type: 'conflict' }
>;

describe('conflict picks', () => {
  it('keeps the base while nothing is picked', () => {
    expect(conflictOutput(c0, undefined)).toEqual([{ text: 'base1', kind: 'base' }]);
    expect(unresolvedCount(parts, [])).toBe(2);
    expect(resolvedText(parts, [])).toBe('top\nbase1\nmiddle\nend');
  });

  it('picks single lines, in file order, and drops them again', () => {
    let p = toggleLine(undefined, 'ours', 2);
    p = toggleLine(p, 'ours', 0);
    expect(p).toEqual({ ours: [0, 2], theirs: [], first: 'ours' });
    expect(conflictOutput(c0, p).map((l) => l.text)).toEqual(['a1', 'a3']);
    p = toggleLine(p, 'ours', 0);
    expect(p.ours).toEqual([2]);
    p = toggleLine(p, 'ours', 2);
    expect(p).toEqual({ ours: [], theirs: [], first: null });
  });

  it('puts the side picked first on top', () => {
    let p: Pick = toggleSide(undefined, 'theirs', 1);
    p = toggleSide(p, 'ours', 3);
    expect(conflictOutput(c0, p).map((l) => `${l.kind}:${l.text}`)).toEqual([
      'theirs:b1',
      'ours:a1',
      'ours:a2',
      'ours:a3',
    ]);
    // Dropping the first side hands the lead to the other one.
    p = toggleSide(p, 'theirs', 1);
    expect(p.first).toBe('ours');
  });

  it('toggles a whole side on and off', () => {
    const on = toggleSide(undefined, 'ours', 3);
    expect(on.ours).toEqual([0, 1, 2]);
    expect(toggleSide(on, 'ours', 3).ours).toEqual([]);
  });

  it('resolves the file from the picks', () => {
    const picks = [toggleSide(undefined, 'ours', 3), toggleSide(undefined, 'theirs', 2)];
    expect(resolvedText(parts, picks)).toBe('top\na1\na2\na3\nmiddle\ny1\ny2\nend');
    expect(unresolvedCount(parts, picks)).toBe(0);
  });
});

describe('pane rows', () => {
  it('keeps the three panes level, padding shorter versions', () => {
    const { a, b, out, starts } = layoutRows(parts, []);
    expect(a.length).toBe(b.length);
    expect(a.length).toBe(out.length);
    // Conflict 0: A has 3 lines, B 1, output (base) 1 → 3 rows each.
    expect(starts[0]).toBe(1);
    expect(a.slice(1, 4).map((r) => r.text)).toEqual(['a1', 'a2', 'a3']);
    expect(b.slice(1, 4).map((r) => r.text)).toEqual(['b1', null, null]);
    expect(out.slice(1, 4).map((r) => r.kind)).toEqual(['base', 'pad', 'pad']);
    // Line numbers count only real lines of each pane.
    expect(a[4]).toMatchObject({ text: 'middle', no: 5 });
    expect(b[4]).toMatchObject({ text: 'middle', no: 3 });
    expect(out[4]).toMatchObject({ text: 'middle', no: 3 });
    // The first row of a conflict carries the checkbox, also when that side is empty.
    expect(a[1]!.head && b[1]!.head).toBe(true);
  });

  it('grows a conflict when the output is longer than both sides', () => {
    const both = toggleSide(toggleSide(undefined, 'ours', 3), 'theirs', 1);
    const { a, out } = layoutRows(parts, [both]);
    expect(out.slice(1, 5).map((r) => r.text)).toEqual(['a1', 'a2', 'a3', 'b1']);
    expect(a[4]).toMatchObject({ kind: 'pad' });
  });
});

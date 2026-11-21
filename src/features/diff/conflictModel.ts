// The merge tool's model: which lines of each side are picked for every conflict, the output
// they produce, and the rows of the three panes (A, B, Output) kept level with each other so
// they scroll together line for line.

import type { ConflictPart } from '@/lib/diff';

export type Side = 'ours' | 'theirs';
type Conflict = Extract<ConflictPart, { type: 'conflict' }>;

/** Lines picked in one conflict (indexes into that side's lines), and which side went first. */
export interface Pick {
  ours: number[];
  theirs: number[];
  first: Side | null;
}

export const emptyPick = (): Pick => ({ ours: [], theirs: [], first: null });

const isEmpty = (p: Pick | undefined) => !p || (p.ours.length === 0 && p.theirs.length === 0);

/** Pick or drop one line of a side. */
export function toggleLine(p: Pick | undefined, side: Side, line: number): Pick {
  const cur = p ?? emptyPick();
  const has = cur[side].includes(line);
  const lines = has
    ? cur[side].filter((l) => l !== line)
    : [...cur[side], line].sort((a, b) => a - b);
  return withFirst({ ...cur, [side]: lines }, side);
}

/** Pick every line of a side in this conflict, or drop them all when they already are. */
export function toggleSide(p: Pick | undefined, side: Side, count: number): Pick {
  const cur = p ?? emptyPick();
  const all = cur[side].length === count && count > 0;
  const lines = all ? [] : Array.from({ length: count }, (_, i) => i);
  return withFirst({ ...cur, [side]: lines }, side);
}

/** The side picked first comes first in the output; it resets when a side is left empty. */
function withFirst(p: Pick, touched: Side): Pick {
  const other: Side = touched === 'ours' ? 'theirs' : 'ours';
  let first = p.first;
  if (p.ours.length === 0 && p.theirs.length === 0) first = null;
  else if (first === null || p[first].length === 0) first = p[touched].length ? touched : other;
  return { ...p, first };
}

export type OutKind = Side | 'base';

/** What one conflict contributes to the output: the picked lines, or the base while unpicked. */
export function conflictOutput(
  c: Conflict,
  p: Pick | undefined,
): { text: string; kind: OutKind }[] {
  if (isEmpty(p)) return (c.base ?? []).map((text) => ({ text, kind: 'base' as const }));
  const order: Side[] = p!.first === 'theirs' ? ['theirs', 'ours'] : ['ours', 'theirs'];
  return order.flatMap((side) =>
    p![side].map((i) => ({ text: (side === 'ours' ? c.ours : c.theirs)[i] ?? '', kind: side })),
  );
}

/** The resolved file text. */
export function resolvedText(parts: ConflictPart[], picks: Pick[]): string {
  const out: string[] = [];
  for (const part of parts) {
    if (part.type === 'text') out.push(...part.lines);
    else out.push(...conflictOutput(part, picks[part.index]).map((l) => l.text));
  }
  return out.join('\n');
}

/** Conflicts nobody picked anything in yet (their base would be kept). */
export const unresolvedCount = (parts: ConflictPart[], picks: Pick[]) =>
  parts.filter((p) => p.type === 'conflict' && isEmpty(picks[p.index])).length;

export interface Row {
  /** Line text, or null for padding that keeps the panes level. */
  text: string | null;
  /** Line number in that pane's file. */
  no: number | null;
  kind: 'text' | OutKind | 'pad';
  /** Conflict this row belongs to. */
  conflict?: number;
  /** Index of the line within its side of the conflict (A / B panes). */
  line?: number;
  /** First row of its conflict (where the whole-conflict checkbox goes). */
  head?: boolean;
}

export interface Layout {
  a: Row[];
  b: Row[];
  out: Row[];
  /** Row index where each conflict starts (the same in all three panes). */
  starts: number[];
}

/**
 * Rows of the three panes. Text outside conflicts is the same everywhere; each conflict takes
 * as many rows as its longest version (A, B or the current output), padded in the others.
 */
export function layoutRows(parts: ConflictPart[], picks: Pick[]): Layout {
  const a: Row[] = [];
  const b: Row[] = [];
  const out: Row[] = [];
  const starts: number[] = [];
  let na = 1;
  let nb = 1;
  let no = 1;
  for (const part of parts) {
    if (part.type === 'text') {
      for (const text of part.lines) {
        a.push({ text, no: na++, kind: 'text' });
        b.push({ text, no: nb++, kind: 'text' });
        out.push({ text, no: no++, kind: 'text' });
      }
      continue;
    }
    const c = part.index;
    const result = conflictOutput(part, picks[c]);
    // At least one row, so an empty side still has a place for its checkbox.
    const height = Math.max(part.ours.length, part.theirs.length, result.length, 1);
    starts[c] = a.length;
    for (let i = 0; i < height; i++) {
      const head = i === 0;
      a.push(
        i < part.ours.length
          ? { text: part.ours[i]!, no: na++, kind: 'ours', conflict: c, line: i, head }
          : { text: null, no: null, kind: 'pad', conflict: c, head },
      );
      b.push(
        i < part.theirs.length
          ? { text: part.theirs[i]!, no: nb++, kind: 'theirs', conflict: c, line: i, head }
          : { text: null, no: null, kind: 'pad', conflict: c, head },
      );
      out.push(
        i < result.length
          ? { text: result[i]!.text, no: no++, kind: result[i]!.kind, conflict: c, head }
          : { text: null, no: null, kind: 'pad', conflict: c, head },
      );
    }
  }
  return { a, b, out, starts };
}

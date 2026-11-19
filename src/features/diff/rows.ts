// Flat row model for the diff viewer: one entry per rendered row, so the body can be virtualised
// and the split layout stays aligned (each split row holds both sides; its height is the taller).
import { changeBlocks, hunkAnchors, type DiffLine, type ParsedDiff } from '@/lib/diff';

export type DiffLayout = 'hunk' | 'inline' | 'split';

export type DiffRow =
  /** Hunk header (hunk layout only); `hunk` indexes the normal diff = the shown diff. */
  | { type: 'header'; hunk: number; text: string }
  /** Hunk buttons placed before the first change of a normal-diff hunk (inline / split). */
  | { type: 'action'; hunk: number; action: number }
  | { type: 'line'; hunk: number; line: DiffLine; block?: number }
  /** Split row: old side `a`, new side `b`; `null` is a filler (line exists on the other side). */
  | { type: 'pair'; hunk: number; a: DiffLine | null; b: DiffLine | null; block?: number };

export interface DiffRows {
  rows: DiffRow[];
  /** Row index where each change block (see `changeBlocks`) starts. */
  blockRows: number[];
  /** Widest line, in columns (tabs expanded), per side. Inline/hunk use `b` for both. */
  cols: { a: number; b: number };
}

export const TAB_SIZE = 4;

/** Display width of a line in monospace columns, with tabs expanded to `tab` stops. */
export function visualWidth(text: string, tab = TAB_SIZE): number {
  let w = 0;
  for (let i = 0; i < text.length; i++)
    w = text.charCodeAt(i) === 9 ? (Math.floor(w / tab) + 1) * tab : w + 1;
  return w;
}

/**
 * Pair the lines of a hunk for the split layout: context lines face themselves, and each run of
 * deletions faces the additions that follow it, row by row; the shorter side gets fillers.
 * `li` is the index (in the hunk) of the first source line of the row, or -1 for continuation rows.
 */
export function pairLines(lines: DiffLine[]) {
  const out: { a: DiffLine | null; b: DiffLine | null; li: number; lis: number[] }[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.kind === 'ctx' || l.kind === 'meta') {
      out.push({ a: l, b: l, li: i, lis: [i] });
      i++;
      continue;
    }
    const start = i;
    const dels: number[] = [];
    const adds: number[] = [];
    while (i < lines.length && lines[i]!.kind === 'del') dels.push(i++);
    while (i < lines.length && lines[i]!.kind === 'add') adds.push(i++);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      const da = dels[k];
      const ab = adds[k];
      out.push({
        a: da === undefined ? null : lines[da]!,
        b: ab === undefined ? null : lines[ab]!,
        li: k === 0 ? start : -1,
        lis: [da, ab].filter((x): x is number => x !== undefined),
      });
    }
  }
  return out;
}

/**
 * Build the rows of `shown` for `layout`. For inline/split, pass the normal (3-line context) diff
 * as `normal` to place the hunk buttons before the first change of each of its hunks.
 */
export function buildRows(
  shown: ParsedDiff,
  layout: DiffLayout,
  normal?: ParsedDiff | null,
): DiffRows {
  const rows: DiffRow[] = [];
  const blockRows: number[] = [];
  const cols = { a: 0, b: 0 };

  const blockAt = new Map<string, number>();
  changeBlocks(shown).forEach((b, i) => blockAt.set(`${b.hunk}:${b.line}`, i));

  // Hunk buttons for the whole-file layouts: normal hunk → line of its first change in `shown`.
  const actionAt = new Map<string, number>();
  if (layout !== 'hunk' && normal) {
    const byLine = new Map<string, number>();
    for (const a of hunkAnchors(normal)) byLine.set(`${a.kind}:${a.no}`, a.hunk);
    shown.hunks.forEach((h, hi) =>
      h.lines.forEach((l, li) => {
        const no = l.kind === 'add' ? l.newNo : l.kind === 'del' ? l.oldNo : null;
        const hit = no === null ? undefined : byLine.get(`${l.kind}:${no}`);
        if (hit !== undefined) actionAt.set(`${hi}:${li}`, hit);
      }),
    );
  }

  const mark = (block: number | undefined) => {
    if (block !== undefined) blockRows[block] = rows.length;
  };

  shown.hunks.forEach((h, hi) => {
    if (layout === 'hunk') rows.push({ type: 'header', hunk: hi, text: h.header });
    if (layout === 'split') {
      for (const p of pairLines(h.lines)) {
        const action = p.lis.map((li) => actionAt.get(`${hi}:${li}`)).find((x) => x !== undefined);
        if (action !== undefined) rows.push({ type: 'action', hunk: hi, action });
        const block = p.li >= 0 ? blockAt.get(`${hi}:${p.li}`) : undefined;
        mark(block);
        if (p.a) cols.a = Math.max(cols.a, visualWidth(p.a.text));
        if (p.b) cols.b = Math.max(cols.b, visualWidth(p.b.text));
        rows.push({ type: 'pair', hunk: hi, a: p.a, b: p.b, block });
      }
    } else {
      h.lines.forEach((line, li) => {
        const action = actionAt.get(`${hi}:${li}`);
        if (action !== undefined) rows.push({ type: 'action', hunk: hi, action });
        const block = blockAt.get(`${hi}:${li}`);
        mark(block);
        cols.b = Math.max(cols.b, visualWidth(line.text));
        rows.push({ type: 'line', hunk: hi, line, block });
      });
    }
  });
  if (layout !== 'split') cols.a = cols.b;
  return { rows, blockRows, cols };
}

/** Rows kept above a change when jumping to it, so it shows "a few lines below the top". */
export const LEAD_ROWS = 3;

/**
 * Which change to bring into view when a diff opens or the layout changes: the current one if it
 * still exists, else the first. `-1` when the diff has no changes.
 */
export function focusBlock(blockCount: number, current: number): number {
  if (blockCount === 0) return -1;
  return current >= 0 && current < blockCount ? current : 0;
}

/** Row to put at the top of the viewport so `block` sits `lead` rows below it. */
export function scrollTargetRow(blockRows: number[], block: number, lead = LEAD_ROWS): number {
  const row = blockRows[block];
  return row === undefined ? 0 : Math.max(0, row - lead);
}

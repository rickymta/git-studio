export type LineKind = 'add' | 'del' | 'ctx' | 'meta';

export interface DiffLine {
  kind: LineKind;
  /** Display text (no leading +/-/space, no trailing CR). */
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface Hunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
  /** Raw lines of the hunk (header included, CRs kept), used to build a patch. */
  raw: string[];
}

export interface ParsedDiff {
  /** File header lines (`diff --git`, `index`, `---`, `+++`, mode lines). */
  header: string[];
  hunks: Hunk[];
  binary: boolean;
  empty: boolean;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Parse the unified diff of a single file. Line endings inside lines are preserved in `raw`. */
export function parseDiff(text: string): ParsedDiff {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const header: string[] = [];
  const hunks: Hunk[] = [];
  let binary = false;
  let cur: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const line of lines) {
    const display = line.endsWith('\r') ? line.slice(0, -1) : line;
    const m = HUNK_RE.exec(display);
    if (m) {
      cur = {
        header: display,
        oldStart: Number(m[1]),
        oldCount: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newCount: m[4] === undefined ? 1 : Number(m[4]),
        lines: [],
        raw: [line],
      };
      hunks.push(cur);
      oldNo = cur.oldStart;
      newNo = cur.newStart;
      continue;
    }
    if (!cur) {
      if (display.startsWith('Binary files') || display.startsWith('GIT binary patch'))
        binary = true;
      header.push(display);
      continue;
    }
    cur.raw.push(line);
    const c = display[0];
    if (c === '+') {
      cur.lines.push({ kind: 'add', text: display.slice(1), oldNo: null, newNo: newNo++ });
    } else if (c === '-') {
      cur.lines.push({ kind: 'del', text: display.slice(1), oldNo: oldNo++, newNo: null });
    } else if (c === '\\') {
      cur.lines.push({ kind: 'meta', text: display, oldNo: null, newNo: null });
    } else {
      cur.lines.push({ kind: 'ctx', text: display.slice(1), oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return { header, hunks, binary, empty: text.trim() === '' };
}

/** A patch containing only hunk `index`, suitable for `git apply [--cached] [--reverse]`. */
export function hunkPatch(diff: ParsedDiff, index: number): string {
  const hunk = diff.hunks[index];
  if (!hunk) throw new Error(`No hunk ${index}`);
  // Keep only the header lines git apply needs.
  const header = diff.header.filter(
    (l) =>
      l.startsWith('diff --git') ||
      l.startsWith('--- ') ||
      l.startsWith('+++ ') ||
      l.startsWith('new file mode') ||
      l.startsWith('deleted file mode') ||
      l.startsWith('old mode') ||
      l.startsWith('new mode'),
  );
  return [...header, ...hunk.raw].join('\n') + '\n';
}

/** A run of consecutive added/removed lines: what ↑/↓ navigation jumps between. */
export interface ChangeBlock {
  hunk: number;
  /** Index of the first changed line inside the hunk. */
  line: number;
}

export function changeBlocks(diff: ParsedDiff): ChangeBlock[] {
  const out: ChangeBlock[] = [];
  diff.hunks.forEach((h, hi) => {
    let inBlock = false;
    h.lines.forEach((l, li) => {
      const changed = l.kind === 'add' || l.kind === 'del';
      if (changed && !inBlock) out.push({ hunk: hi, line: li });
      inBlock = changed;
    });
  });
  return out;
}

/** For each hunk of a normal diff, the line (old or new number) where its first change is. */
export function hunkAnchors(diff: ParsedDiff): { hunk: number; kind: 'add' | 'del'; no: number }[] {
  const out: { hunk: number; kind: 'add' | 'del'; no: number }[] = [];
  diff.hunks.forEach((h, hi) => {
    const first = h.lines.find((l) => l.kind === 'add' || l.kind === 'del');
    if (first?.kind === 'add') out.push({ hunk: hi, kind: 'add', no: first.newNo! });
    else if (first?.kind === 'del') out.push({ hunk: hi, kind: 'del', no: first.oldNo! });
  });
  return out;
}

// ---- merge conflicts ------------------------------------------------------------------------------

export type ConflictPart =
  | { type: 'text'; lines: string[] }
  | {
      type: 'conflict';
      index: number;
      ours: string[];
      base: string[] | null;
      theirs: string[];
      oursLabel: string;
      theirsLabel: string;
    };

/** Split a file with `<<<<<<<` / `|||||||` / `=======` / `>>>>>>>` markers into parts. */
export function parseConflicts(text: string): ConflictPart[] {
  const lines = text.split('\n');
  const parts: ConflictPart[] = [];
  let plain: string[] = [];
  let i = 0;
  let index = 0;
  const flush = () => {
    if (plain.length) parts.push({ type: 'text', lines: plain });
    plain = [];
  };
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.startsWith('<<<<<<<')) {
      plain.push(line);
      i++;
      continue;
    }
    // Find the end of this conflict before committing to it.
    let j = i + 1;
    let sep = -1;
    let baseAt = -1;
    while (j < lines.length && !lines[j]!.startsWith('>>>>>>>')) {
      if (lines[j]!.startsWith('|||||||') && baseAt < 0 && sep < 0) baseAt = j;
      else if (lines[j]!.startsWith('=======') && sep < 0) sep = j;
      j++;
    }
    if (j >= lines.length || sep < 0) {
      plain.push(line);
      i++;
      continue;
    }
    flush();
    const oursEnd = baseAt >= 0 ? baseAt : sep;
    parts.push({
      type: 'conflict',
      index: index++,
      ours: lines.slice(i + 1, oursEnd),
      base: baseAt >= 0 ? lines.slice(baseAt + 1, sep) : null,
      theirs: lines.slice(sep + 1, j),
      oursLabel: line.slice(7).trim(),
      theirsLabel: lines[j]!.slice(7).trim(),
    });
    i = j + 1;
  }
  flush();
  return parts;
}

export type ConflictChoice = { ours: boolean; theirs: boolean };

/** Output text for the chosen sides (ours first when both are taken). */
export function resolveConflicts(parts: ConflictPart[], choices: ConflictChoice[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (p.type === 'text') out.push(...p.lines);
    else {
      const c = choices[p.index] ?? { ours: false, theirs: false };
      if (c.ours) out.push(...p.ours);
      if (c.theirs) out.push(...p.theirs);
    }
  }
  return out.join('\n');
}

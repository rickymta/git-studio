export type LineKind = 'add' | 'del' | 'ctx' | 'meta';

export interface DiffLine {
  kind: LineKind;
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface Hunk {
  header: string;
  lines: DiffLine[];
  /** Raw lines of the hunk (header included), used to build a patch. */
  raw: string[];
}

export interface ParsedDiff {
  /** File header lines (`diff --git`, `index`, `---`, `+++`, mode lines). */
  header: string[];
  hunks: Hunk[];
  binary: boolean;
  empty: boolean;
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Parse the unified diff of a single file. */
export function parseDiff(text: string): ParsedDiff {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const header: string[] = [];
  const hunks: Hunk[] = [];
  let binary = false;
  let cur: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const line of lines) {
    const m = HUNK_RE.exec(line);
    if (m) {
      cur = { header: line, lines: [], raw: [line] };
      hunks.push(cur);
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      continue;
    }
    if (!cur) {
      if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) binary = true;
      header.push(line);
      continue;
    }
    cur.raw.push(line);
    const c = line[0];
    if (c === '+') {
      cur.lines.push({ kind: 'add', text: line.slice(1), oldNo: null, newNo: newNo++ });
    } else if (c === '-') {
      cur.lines.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++, newNo: null });
    } else if (c === '\\') {
      cur.lines.push({ kind: 'meta', text: line, oldNo: null, newNo: null });
    } else {
      cur.lines.push({ kind: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
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

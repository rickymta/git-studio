import { Columns2, Minus, Plus, Rows3, Undo2, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button, IconButton, Spinner, cn } from '@/components/ui';
import { hunkPatch, parseDiff, type DiffLine, type Hunk } from '@/lib/diff';
import { short } from '@/lib/format';
import { api } from '@/lib/ipc';
import { useRepo } from '@/stores/repo';
import { confirm } from '@/stores/ui';

export function DiffView() {
  const diff = useRepo((s) => s.diff)!;
  const close = useRepo((s) => s.closeDiff);
  const run = useRepo((s) => s.run);
  const parsed = useMemo(() => parseDiff(diff.text), [diff.text]);
  const [split, setSplit] = useState(() => {
    try {
      return localStorage.getItem('gitstudio.diffSplit') === '1';
    } catch {
      return false;
    }
  });
  const req = diff.request;
  const untracked = !!req.untracked;

  const toggleSplit = () => {
    setSplit((s) => {
      try {
        localStorage.setItem('gitstudio.diffSplit', s ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !s;
    });
  };

  const hunkAction = async (i: number, action: 'stage' | 'unstage' | 'discard') => {
    if (
      action === 'discard' &&
      !(await confirm(
        'Discard hunk',
        'Discard this change from the working tree? This cannot be undone.',
        'Discard',
        true,
      ))
    )
      return;
    const patch = hunkPatch(parsed, i);
    const label =
      action === 'stage' ? 'Stage hunk' : action === 'unstage' ? 'Unstage hunk' : 'Discard hunk';
    await run(label, (p) => api.applyPatch(p, patch, action !== 'discard', action !== 'stage'));
  };

  const title =
    req.source === 'commit'
      ? `${req.path} @ ${short(req.commit ?? '')}`
      : `${req.path} — ${req.source === 'staged' ? 'staged' : untracked ? 'untracked' : 'unstaged'}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <span className="min-w-0 flex-1 truncate font-medium" title={req.path}>
          {req.origPath && req.origPath !== req.path && (
            <span className="text-muted-foreground">{req.origPath} → </span>
          )}
          {title}
        </span>
        {diff.loading && <Spinner className="text-muted-foreground" />}
        {req.source === 'unstaged' && (
          <Button size="sm" onClick={() => run('Stage', (p) => api.stage(p, [req.path]))}>
            <Plus className="size-3.5" /> Stage file
          </Button>
        )}
        {req.source === 'staged' && (
          <Button size="sm" onClick={() => run('Unstage', (p) => api.unstage(p, [req.path]))}>
            <Minus className="size-3.5" /> Unstage file
          </Button>
        )}
        <IconButton label={split ? 'Unified view' : 'Split view'} onClick={toggleSplit}>
          {split ? <Rows3 className="size-4" /> : <Columns2 className="size-4" />}
        </IconButton>
        <IconButton label="Close diff (Esc)" onClick={close}>
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="selectable min-h-0 flex-1 overflow-auto bg-background font-mono text-xs leading-5">
        {parsed.binary && (
          <div className="p-6 text-center font-sans text-muted-foreground">
            Binary file — no text diff.
          </div>
        )}
        {!diff.loading && parsed.empty && (
          <div className="p-6 text-center font-sans text-muted-foreground">
            No changes to show (mode change or empty file).
          </div>
        )}
        {/* Combined diffs of conflicted files (@@@ hunks) are shown as plain text. */}
        {!parsed.empty && !parsed.binary && parsed.hunks.length === 0 && (
          <pre className="p-3 whitespace-pre-wrap">{diff.text}</pre>
        )}
        {parsed.hunks.map((h, i) => (
          <div key={i} className="mb-2">
            <div className="sticky top-0 z-10 flex h-7 items-center gap-2 border-y border-border bg-surface-muted px-3 font-sans text-muted-foreground">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{h.header}</span>
              {req.source === 'unstaged' && !untracked && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5"
                    onClick={() => hunkAction(i, 'discard')}
                  >
                    <Undo2 className="size-3" /> Discard hunk
                  </Button>
                  <Button size="sm" className="h-5" onClick={() => hunkAction(i, 'stage')}>
                    <Plus className="size-3" /> Stage hunk
                  </Button>
                </>
              )}
              {req.source === 'staged' && (
                <Button size="sm" className="h-5" onClick={() => hunkAction(i, 'unstage')}>
                  <Minus className="size-3" /> Unstage hunk
                </Button>
              )}
            </div>
            {split ? <SplitHunk hunk={h} /> : <UnifiedHunk hunk={h} />}
          </div>
        ))}
      </div>
    </div>
  );
}

const bg = (k: DiffLine['kind']) =>
  k === 'add' ? 'bg-diff-add' : k === 'del' ? 'bg-diff-del' : '';

function UnifiedHunk({ hunk }: { hunk: Hunk }) {
  return (
    <table className="w-full border-collapse">
      <tbody>
        {hunk.lines.map((l, j) => (
          <tr key={j} className={bg(l.kind)}>
            <td className="w-12 pr-2 text-right text-muted-foreground/70 select-none">
              {l.oldNo ?? ''}
            </td>
            <td className="w-12 pr-2 text-right text-muted-foreground/70 select-none">
              {l.newNo ?? ''}
            </td>
            <td
              className={cn(
                'w-4 text-center select-none',
                l.kind === 'add' && 'text-success',
                l.kind === 'del' && 'text-danger',
              )}
            >
              {l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ''}
            </td>
            <td
              className={cn(
                'pr-4 whitespace-pre-wrap break-all',
                l.kind === 'meta' && 'text-muted-foreground italic',
              )}
            >
              {l.text || ' '}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Pair deletions with following additions side by side. */
function pairLines(lines: DiffLine[]): [DiffLine | null, DiffLine | null][] {
  const out: [DiffLine | null, DiffLine | null][] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.kind === 'ctx' || l.kind === 'meta') {
      out.push([l, l]);
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind === 'del') dels.push(lines[i++]!);
    while (i < lines.length && lines[i]!.kind === 'add') adds.push(lines[i++]!);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++)
      out.push([dels[k] ?? null, adds[k] ?? null]);
  }
  return out;
}

function SplitHunk({ hunk }: { hunk: Hunk }) {
  const rows = useMemo(() => pairLines(hunk.lines), [hunk]);
  return (
    <table className="w-full table-fixed border-collapse">
      <tbody>
        {rows.map(([a, b], j) => (
          <tr key={j}>
            <td
              className={cn(
                'w-12 pr-2 text-right align-top text-muted-foreground/70 select-none',
                a && bg(a.kind),
              )}
            >
              {a?.oldNo ?? ''}
            </td>
            <td
              className={cn(
                'border-r border-border pr-2 align-top whitespace-pre-wrap break-all',
                a ? bg(a.kind) : 'bg-surface-muted/50',
              )}
            >
              {a?.text ?? ''}
            </td>
            <td
              className={cn(
                'w-12 pr-2 text-right align-top text-muted-foreground/70 select-none',
                b && bg(b.kind),
              )}
            >
              {b?.newNo ?? ''}
            </td>
            <td
              className={cn(
                'pr-2 align-top whitespace-pre-wrap break-all',
                b ? bg(b.kind) : 'bg-surface-muted/50',
              )}
            >
              {b?.text ?? ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

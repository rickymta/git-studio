import { Minus, Plus, RotateCcw, Undo2 } from 'lucide-react';
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';

import { Button, Spinner, cn } from '@/components/ui';
import {
  changeBlocks,
  hunkAnchors,
  hunkPatch,
  parseDiff,
  type DiffLine,
  type Hunk,
  type ParsedDiff,
} from '@/lib/diff';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { DiffRequest } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { confirm } from '@/stores/ui';

export type DiffLayout = 'hunk' | 'inline' | 'split';
/** Which hunk buttons make sense for this diff. */
export type HunkActions = 'unstaged' | 'staged' | 'commit' | 'none';

export interface DiffNav {
  go: (dir: 1 | -1) => void;
}

const FULL = 1_000_000;

const bg = (k: DiffLine['kind']) =>
  k === 'add' ? 'bg-diff-add' : k === 'del' ? 'bg-diff-del' : '';
const sign = (k: DiffLine['kind']) => (k === 'add' ? '+' : k === 'del' ? '−' : '');

/**
 * The diff itself in one of three layouts. Fetches what it needs: the normal diff (hunks for the
 * hunk layout and for staging), and the whole-file diff for the inline and split layouts.
 */
export function DiffBody({
  request,
  layout,
  ignoreWhitespace,
  wrap,
  encoding,
  actions,
  refreshKey,
  navRef,
  onBlocks,
}: {
  request: DiffRequest;
  layout: DiffLayout;
  ignoreWhitespace: boolean;
  wrap: boolean;
  encoding?: string;
  actions: HunkActions;
  /** Changes when the diff should be fetched again (e.g. after a refresh). */
  refreshKey?: unknown;
  navRef?: Ref<DiffNav>;
  onBlocks?: (current: number, total: number) => void;
}) {
  const path = useRepo((s) => s.path)!;
  const run = useRepo((s) => s.run);
  const [normal, setNormal] = useState<ParsedDiff | null>(null);
  const [full, setFull] = useState<ParsedDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(-1);

  const needFull = layout !== 'hunk';
  useEffect(() => {
    let alive = true;
    const base = { ...request, ignoreWhitespace, encoding };
    Promise.all([
      api.diff(path, base),
      needFull ? api.diff(path, { ...base, context: FULL }) : Promise.resolve(null),
    ])
      .then(([n, f]) => {
        if (!alive) return;
        setNormal(parseDiff(n));
        setFull(f === null ? null : parseDiff(f));
        setError(null);
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [path, request, ignoreWhitespace, encoding, needFull, refreshKey]);

  const shown = needFull ? full : normal;
  const blocks = useMemo(() => (shown ? changeBlocks(shown) : []), [shown]);

  useEffect(() => {
    onBlocks?.(current, blocks.length);
  }, [current, blocks.length, onBlocks]);

  useImperativeHandle(navRef, () => ({
    go: (dir) => {
      if (blocks.length === 0) return;
      const next =
        current < 0
          ? dir > 0
            ? 0
            : blocks.length - 1
          : (current + dir + blocks.length) % blocks.length;
      setCurrent(next);
      scroller.current
        ?.querySelector(`[data-block="${next}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
  }));

  // Hunk actions only from the normal diff, and never on a whitespace-insensitive one
  // (its hunks don't match the file byte for byte).
  const canAct = actions !== 'none' && !ignoreWhitespace && !!normal;
  const act = async (i: number, kind: 'stage' | 'unstage' | 'discard' | 'revert') => {
    if (!normal) return;
    if (
      (kind === 'discard' || kind === 'revert') &&
      !(await confirm(
        kind === 'discard' ? t('Discard hunk') : t('Revert hunk'),
        kind === 'discard'
          ? t('Discard this change from the working tree? This cannot be undone.')
          : t(
              'Undo this change of the commit in your working tree? You can review it before committing.',
            ),
        kind === 'discard' ? t('Discard') : t('Revert'),
        true,
      ))
    )
      return;
    const patch = hunkPatch(normal, i);
    const label =
      kind === 'stage'
        ? 'Stage hunk'
        : kind === 'unstage'
          ? 'Unstage hunk'
          : kind === 'discard'
            ? 'Discard hunk'
            : 'Revert hunk';
    // stage: index forward; unstage: index reverse; discard/revert: working tree reverse.
    const cached = kind === 'stage' || kind === 'unstage';
    const reverse = kind !== 'stage';
    await run(label, (p) => api.applyPatch(p, patch, cached, reverse, encoding));
  };

  const HunkButtons = ({ i }: { i: number }) =>
    !canAct ? null : (
      <span className="ml-auto flex gap-1.5 font-sans">
        {actions === 'unstaged' && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-5 border border-danger/60 text-danger"
              onClick={() => act(i, 'discard')}
            >
              <Undo2 className="size-3" /> {t('Discard Hunk')}
            </Button>
            <Button
              size="sm"
              className="h-5 border-success/60 bg-success-soft text-success"
              onClick={() => act(i, 'stage')}
            >
              <Plus className="size-3" /> {t('Stage Hunk')}
            </Button>
          </>
        )}
        {actions === 'staged' && (
          <Button
            size="sm"
            className="h-5 border-danger/60 bg-danger-soft text-danger"
            onClick={() => act(i, 'unstage')}
          >
            <Minus className="size-3" /> {t('Unstage Hunk')}
          </Button>
        )}
        {actions === 'commit' && (
          <Button
            size="sm"
            variant="ghost"
            className="h-5 border border-warning/60 text-warning"
            onClick={() => act(i, 'revert')}
          >
            <RotateCcw className="size-3" /> {t('Revert Hunk')}
          </Button>
        )}
      </span>
    );

  if (error) return <div className="p-6 text-danger">{error}</div>;
  if (!shown) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-muted-foreground" />
      </div>
    );
  }
  if (shown.binary) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        {t('Binary file — no text diff.')}
      </div>
    );
  }
  if (shown.empty || shown.hunks.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        {ignoreWhitespace
          ? t('Only whitespace changed.')
          : t('No changes to show (mode change or empty file).')}
      </div>
    );
  }

  // Anchor rows (block starts) and hunk-action positions for the whole-file layouts.
  const blockAt = new Map<string, number>();
  blocks.forEach((b, i) => blockAt.set(`${b.hunk}:${b.line}`, i));
  const actionAt = new Map<string, number>();
  if (needFull && normal && full) {
    for (const a of hunkAnchors(normal)) {
      full.hunks.forEach((h, hi) =>
        h.lines.forEach((l, li) => {
          if ((a.kind === 'add' ? l.newNo : l.oldNo) === a.no && l.kind === a.kind)
            actionAt.set(`${hi}:${li}`, a.hunk);
        }),
      );
    }
  }

  const textCls = wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre';

  return (
    <div
      ref={scroller}
      className="selectable h-full min-h-0 overflow-auto bg-background font-mono text-xs leading-5"
    >
      <div className={cn(!wrap && 'w-max min-w-full')}>
        {shown.hunks.map((h, hi) => (
          <div key={hi} className={cn(layout === 'hunk' && 'mb-2')}>
            {layout === 'hunk' && (
              <div className="sticky top-0 z-10 flex h-7 items-center gap-2 border-y border-border bg-surface-muted px-3 text-muted-foreground">
                <span className="min-w-0 truncate">{h.header}</span>
                <HunkButtons i={hi} />
              </div>
            )}
            {layout === 'split' ? (
              <SplitHunk
                hunk={h}
                hi={hi}
                textCls={textCls}
                blockAt={blockAt}
                current={current}
                actionAt={actionAt}
                renderActions={(i) => <HunkButtons i={i} />}
              />
            ) : (
              <UnifiedHunk
                hunk={h}
                hi={hi}
                textCls={textCls}
                blockAt={blockAt}
                current={current}
                actionAt={layout === 'inline' ? actionAt : undefined}
                renderActions={(i) => <HunkButtons i={i} />}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

interface HunkProps {
  hunk: Hunk;
  hi: number;
  textCls: string;
  blockAt: Map<string, number>;
  current: number;
  actionAt?: Map<string, number>;
  renderActions: (hunkIndex: number) => React.ReactNode;
}

function ActionRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky left-0 flex h-7 items-center border-y border-border/60 bg-surface-muted/70 px-3">
      {children}
    </div>
  );
}

function UnifiedHunk({ hunk, hi, textCls, blockAt, current, actionAt, renderActions }: HunkProps) {
  return (
    <>
      {hunk.lines.map((l, li) => {
        const block = blockAt.get(`${hi}:${li}`);
        const action = actionAt?.get(`${hi}:${li}`);
        return (
          <div key={li}>
            {action !== undefined && <ActionRow>{renderActions(action)}</ActionRow>}
            <div
              data-block={block}
              className={cn(
                'flex',
                bg(l.kind),
                block !== undefined &&
                  block === current &&
                  'outline-1 -outline-offset-1 outline-accent',
              )}
            >
              <span className="w-12 shrink-0 pr-2 text-right text-muted-foreground/70 select-none">
                {l.oldNo ?? ''}
              </span>
              <span className="w-12 shrink-0 pr-2 text-right text-muted-foreground/70 select-none">
                {l.newNo ?? ''}
              </span>
              <span
                className={cn(
                  'w-5 shrink-0 text-center select-none',
                  l.kind === 'add' && 'text-success',
                  l.kind === 'del' && 'text-danger',
                )}
              >
                {sign(l.kind)}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 pr-4',
                  textCls,
                  l.kind === 'meta' && 'text-muted-foreground italic',
                )}
              >
                {l.text || ' '}
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}

/** Pair deletions with the additions that follow them; keep the index of each source line. */
function pairLines(lines: DiffLine[]) {
  const out: { a: DiffLine | null; b: DiffLine | null; li: number }[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.kind === 'ctx' || l.kind === 'meta') {
      out.push({ a: l, b: l, li: i });
      i++;
      continue;
    }
    const start = i;
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind === 'del') dels.push(lines[i++]!);
    while (i < lines.length && lines[i]!.kind === 'add') adds.push(lines[i++]!);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++)
      out.push({ a: dels[k] ?? null, b: adds[k] ?? null, li: k === 0 ? start : -1 });
  }
  return out;
}

function SplitHunk({ hunk, hi, textCls, blockAt, current, actionAt, renderActions }: HunkProps) {
  const rows = useMemo(() => pairLines(hunk.lines), [hunk]);
  return (
    <div className="grid grid-cols-2">
      {rows.map(({ a, b, li }, r) => {
        const block = li >= 0 ? blockAt.get(`${hi}:${li}`) : undefined;
        const action = li >= 0 ? actionAt?.get(`${hi}:${li}`) : undefined;
        const outline = block !== undefined && block === current;
        const side = (l: DiffLine | null, which: 'a' | 'b') => (
          <div
            // `contents` rows have no box to scroll to; the left cell carries the anchor.
            data-block={which === 'a' ? block : undefined}
            className={cn(
              'flex min-w-0',
              l ? bg(l.kind) : 'diff-hatch',
              which === 'a' && 'border-r border-border',
              outline && 'outline-1 -outline-offset-1 outline-accent',
            )}
          >
            <span className="w-12 shrink-0 pr-2 text-right text-muted-foreground/70 select-none">
              {l ? ((which === 'a' ? l.oldNo : l.newNo) ?? '') : ''}
            </span>
            <span
              className={cn(
                'w-5 shrink-0 text-center select-none',
                l?.kind === 'add' && 'text-success',
                l?.kind === 'del' && 'text-danger',
              )}
            >
              {l ? sign(l.kind) : ''}
            </span>
            <span className={cn('min-w-0 flex-1 overflow-hidden pr-3', textCls)}>
              {l?.text ?? ''}
            </span>
          </div>
        );
        return (
          <div key={r} className="contents">
            {action !== undefined && (
              <div className="col-span-2">
                <ActionRow>{renderActions(action)}</ActionRow>
              </div>
            )}
            {side(a, 'a')}
            {side(b, 'b')}
          </div>
        );
      })}
    </div>
  );
}

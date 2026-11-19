import { useVirtualizer } from '@tanstack/react-virtual';
import { Minus, Plus, RotateCcw, Undo2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';

import { Button, Spinner, cn } from '@/components/ui';
import { changeBlocks, hunkPatch, parseDiff, type DiffLine, type ParsedDiff } from '@/lib/diff';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { DiffRequest } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { confirm } from '@/stores/ui';
import {
  TAB_SIZE,
  buildRows,
  focusBlock,
  scrollTargetRow,
  type DiffLayout,
  type DiffRow,
} from './rows';

export type { DiffLayout } from './rows';
/** Which hunk buttons make sense for this diff. */
export type HunkActions = 'unstaged' | 'staged' | 'commit' | 'none';

export interface DiffNav {
  go: (dir: 1 | -1) => void;
}

const FULL = 1_000_000;
const LINE_H = 20;
const BAR_H = 28;
/** Gap above every hunk header but the first (hunk layout). */
const HUNK_GAP = 8;

const bg = (k: DiffLine['kind']) =>
  k === 'add' ? 'bg-diff-add' : k === 'del' ? 'bg-diff-del' : '';
const sign = (k: DiffLine['kind']) => (k === 'add' ? '+' : k === 'del' ? '−' : '');
const signCls = (k: DiffLine['kind'] | undefined) =>
  cn(
    'w-5 shrink-0 text-center select-none',
    k === 'add' && 'text-success',
    k === 'del' && 'text-danger',
  );
const GUTTER = 'w-12 shrink-0 pr-2 text-right text-muted-foreground/70 select-none';

const rowHeight = (r: DiffRow) =>
  r.type === 'header' ? BAR_H + (r.hunk > 0 ? HUNK_GAP : 0) : r.type === 'action' ? BAR_H : LINE_H;

interface Loaded {
  key: string;
  normal: ParsedDiff;
  full: ParsedDiff | null;
}

/**
 * The diff itself in one of three layouts (GitKraken-style): hunks with 3 lines of context, the
 * whole file inline, or the whole file split old | new. Rows are virtualised; with word wrap they
 * are measured, and a split row is as tall as its taller side, so both sides stay aligned.
 * Opening a diff (or switching layout) scrolls the first / current change into view.
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
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const bars = useRef<(HTMLDivElement | null)[]>([null, null]);
  const [current, setCurrent] = useState(-1);
  const [viewW, setViewW] = useState(0);

  const needFull = layout !== 'hunk';
  // What the fetched data depends on (not refreshKey: a refresh keeps the old diff on screen).
  const fileKey = JSON.stringify([path, request, ignoreWhitespace, encoding ?? null]);
  const dataKey = `${fileKey}|${needFull}`;

  useEffect(() => {
    let alive = true;
    const base = { ...request, ignoreWhitespace, encoding };
    Promise.all([
      api.diff(path, base),
      needFull ? api.diff(path, { ...base, context: FULL }) : Promise.resolve(null),
    ])
      .then(([n, f]) => {
        if (!alive) return;
        setLoaded({ key: dataKey, normal: parseDiff(n), full: f === null ? null : parseDiff(f) });
        setError(null);
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [path, request, ignoreWhitespace, encoding, needFull, refreshKey, dataKey]);

  const ready = loaded?.key === dataKey ? loaded : null;
  const normal = ready?.normal ?? null;
  const shown = needFull ? (ready?.full ?? null) : normal;
  const model = useMemo(
    () => (shown ? buildRows(shown, layout, normal) : null),
    [shown, layout, normal],
  );
  const rows = model?.rows ?? [];
  const blockCount = useMemo(() => (shown ? changeBlocks(shown).length : 0), [shown]);

  // A new file starts from its first change; a new layout keeps the current one.
  useEffect(() => setCurrent(-1), [fileKey]);
  const pendingScroll = useRef<string | null>(null);
  const scrollKey = `${fileKey}|${layout}`;
  useLayoutEffect(() => {
    pendingScroll.current = scrollKey;
  }, [scrollKey]);

  useEffect(() => {
    onBlocks?.(current, blockCount);
  }, [current, blockCount, onBlocks]);

  const getItemKey = useCallback((i: number) => `${layout}:${i}`, [layout]);
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (rows[i] ? rowHeight(rows[i]) : LINE_H),
    getItemKey,
    overscan: 30,
  });

  // Row sizes change with the rows and with wrapping: forget the measured ones.
  useLayoutEffect(() => {
    virt.measure();
  }, [virt, model, wrap]);

  // Jump to the first (or current) change once the diff for this file + layout is on screen.
  useLayoutEffect(() => {
    if (!model || pendingScroll.current !== scrollKey) return;
    pendingScroll.current = null;
    const block = focusBlock(model.blockRows.length, current);
    if (block >= 0) {
      if (block !== current) setCurrent(block);
      virt.scrollToIndex(scrollTargetRow(model.blockRows, block), { align: 'start' });
    } else virt.scrollToOffset(0);
  }, [model, scrollKey, current, virt]);

  // Split layout: each side scrolls horizontally on its own (bars under the panes).
  const resetBars = useCallback(() => {
    for (const [i, b] of bars.current.entries()) {
      if (b) b.scrollLeft = 0;
      scroller.current?.style.setProperty(i === 0 ? '--sx-a' : '--sx-b', '0px');
    }
  }, []);
  useEffect(resetBars, [resetBars, fileKey, layout, wrap]);

  const hasBody = !!model;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasBody]);

  useImperativeHandle(navRef, () => ({
    go: (dir) => {
      if (!model || model.blockRows.length === 0) return;
      const n = model.blockRows.length;
      const next = current < 0 ? (dir > 0 ? 0 : n - 1) : (current + dir + n) % n;
      setCurrent(next);
      virt.scrollToIndex(model.blockRows[next]!, { align: 'center' });
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

  const hunkButtons = (i: number) =>
    !canAct ? null : (
      <span className="ml-auto flex gap-1.5 font-sans">
        {actions === 'unstaged' && (
          <>
            <Button
              size="sm"
              variant="ghost"
              title={t('Discard Hunk')}
              className="h-5 border border-danger/60 text-danger"
              onClick={() => act(i, 'discard')}
            >
              <Undo2 className="size-3" /> {t('Discard Hunk')}
            </Button>
            <Button
              size="sm"
              title={t('Stage Hunk')}
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
            title={t('Unstage Hunk')}
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
            title={t('Revert Hunk')}
            className="h-5 border border-warning/60 text-warning"
            onClick={() => act(i, 'revert')}
          >
            <RotateCcw className="size-3" /> {t('Revert Hunk')}
          </Button>
        )}
      </span>
    );

  if (error) return <div className="p-6 text-danger">{error}</div>;
  if (!shown || !model) {
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

  const split = layout === 'split';
  const textCls = wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre';
  const items = virt.getVirtualItems();
  // Bars (hunk header, hunk buttons) span the visible width even when the rows scroll sideways.
  const barStyle = viewW ? { width: viewW } : undefined;

  // Hunk layout: keep the header of the hunk at the top pinned while scrolling through it.
  const offset = virt.scrollOffset ?? 0;
  const top = items.find((it) => it.end > offset);
  const topRow = top ? rows[top.index] : undefined;
  const pinned =
    layout === 'hunk' && topRow && !(topRow.type === 'header' && top!.start >= offset)
      ? topRow.hunk
      : null;

  const header = (hi: number) => (
    <div
      style={barStyle}
      className="sticky left-0 flex h-7 items-center gap-2 border-y border-border bg-surface-muted px-3 text-muted-foreground"
    >
      <span className="min-w-0 truncate">{shown.hunks[hi]?.header}</span>
      {hunkButtons(hi)}
    </div>
  );

  const line = (l: DiffLine) => (
    <div className={cn('flex', bg(l.kind))}>
      <span className={GUTTER}>{l.oldNo ?? ''}</span>
      <span className={GUTTER}>{l.newNo ?? ''}</span>
      <span className={signCls(l.kind)}>{sign(l.kind)}</span>
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
  );

  const side = (l: DiffLine | null, which: 'a' | 'b') => {
    const edge = which === 'a' && 'border-r border-border';
    if (!l) return <div className={cn('diff-hatch min-w-0', edge)} />;
    return (
      <div className={cn('flex min-w-0 flex-col', edge)}>
        <div className={cn('flex', bg(l.kind))}>
          <span className={GUTTER}>{(which === 'a' ? l.oldNo : l.newNo) ?? ''}</span>
          <span className={signCls(l.kind)}>{sign(l.kind)}</span>
          {wrap ? (
            <span className={cn('min-w-0 flex-1 pr-3', textCls)}>{l.text || ' '}</span>
          ) : (
            <span className="min-w-0 flex-1 overflow-hidden pr-3">
              <span
                className={cn(
                  'block',
                  textCls,
                  l.kind === 'meta' && 'text-muted-foreground italic',
                )}
                style={{ transform: `translateX(var(--sx-${which}, 0px))` }}
              >
                {l.text || ' '}
              </span>
            </span>
          )}
        </div>
        {/* The other side wrapped to more lines: fill the gap under this one. */}
        {wrap && <div className="diff-hatch flex-1" />}
      </div>
    );
  };

  const renderRow = (r: DiffRow) => {
    switch (r.type) {
      case 'header':
        return <div className={cn(r.hunk > 0 && 'pt-2')}>{header(r.hunk)}</div>;
      case 'action':
        return (
          <div
            style={barStyle}
            className="sticky left-0 flex h-7 items-center border-y border-border/60 bg-surface-muted/70 px-3"
          >
            {hunkButtons(r.action)}
          </div>
        );
      case 'line':
        return line(r.line);
      case 'pair':
        return (
          <div className="grid grid-cols-2">
            {side(r.a, 'a')}
            {side(r.b, 'b')}
          </div>
        );
    }
  };

  // Without wrapping, the unified layouts scroll sideways as a whole: as wide as the widest line.
  const innerWidth = !wrap && !split ? `calc(${model.cols.b}ch + 140px)` : undefined;

  const onWheel = (e: React.WheelEvent) => {
    if (!split || wrap) return;
    const dx = e.deltaX || (e.shiftKey ? e.deltaY : 0);
    if (!dx || !scroller.current) return;
    const r = scroller.current.getBoundingClientRect();
    const bar = bars.current[e.clientX < r.left + r.width / 2 ? 0 : 1];
    if (bar) bar.scrollLeft += dx;
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div
        ref={scroller}
        onWheel={onWheel}
        style={{ tabSize: TAB_SIZE }}
        className={cn(
          'selectable min-h-0 flex-1 font-mono text-xs leading-5',
          split ? 'overflow-x-hidden overflow-y-auto' : 'overflow-auto',
        )}
      >
        {pinned !== null && <div className="sticky top-0 left-0 z-10 h-0">{header(pinned)}</div>}
        <div
          className="relative"
          style={{ height: virt.getTotalSize(), width: innerWidth, minWidth: '100%' }}
        >
          {items.map((it) => {
            const r = rows[it.index]!;
            const block = r.type === 'line' || r.type === 'pair' ? r.block : undefined;
            return (
              <div
                key={it.key}
                data-index={it.index}
                ref={wrap ? virt.measureElement : undefined}
                className={cn(
                  'absolute top-0 left-0 w-full',
                  block !== undefined &&
                    block === current &&
                    'z-[1] outline-1 -outline-offset-1 outline-accent',
                )}
                style={{ transform: `translateY(${it.start}px)` }}
              >
                {renderRow(r)}
              </div>
            );
          })}
        </div>
      </div>
      {split && !wrap && (
        <div className="flex shrink-0">
          {(['a', 'b'] as const).map((s, i) => (
            <div
              key={s}
              ref={(el) => {
                bars.current[i] = el;
              }}
              onScroll={(e) =>
                scroller.current?.style.setProperty(`--sx-${s}`, `${-e.currentTarget.scrollLeft}px`)
              }
              className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
            >
              <div
                className="h-px font-mono text-xs"
                style={{ width: `calc(${model.cols[s]}ch + 84px)` }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

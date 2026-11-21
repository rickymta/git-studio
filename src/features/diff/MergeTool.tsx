import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, ChevronDown, ChevronUp, Minus, Pencil, RotateCcw, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Checkbox } from '@/components/controls';
import { Button, IconButton, Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { ConflictPart } from '@/lib/diff';
import { t } from '@/lib/i18n';
import { CodeView } from './CodeView';
import {
  layoutRows,
  resolvedText,
  toggleLine,
  toggleSide,
  unresolvedCount,
  type Pick,
  type Row,
  type Side,
} from './conflictModel';

/** Row height in px: the three panes scroll together line for line, so all rows are equal. */
const ROW = 20;
const A = 'oklch(0.62 0.12 230)';
const B = 'oklch(0.74 0.14 80)';
const BASE = 'oklch(0.58 0.16 320)';
const sideColor = (s: Side) => (s === 'ours' ? A : B);
const mix = (c: string, pct: number) => `color-mix(in oklch, ${c} ${pct}%, transparent)`;

export interface SideInfo {
  /** Branch or short name of the side. */
  label: string;
  commit: string | null;
}

/**
 * GitKraken-style merge tool: the current branch (A) and the incoming side (B) on top, the
 * result below. Pick a whole conflict with its checkbox or single lines with the button in the
 * gutter (click again to drop them); unpicked conflicts show their base in the result. The
 * three panes keep the same rows, so scrolling one scrolls the others to the same line.
 */
export function MergeTool({
  path,
  parts,
  ours,
  theirs,
  wrap,
  saving,
  saveLabel,
  onSave,
  onClose,
}: {
  path: string;
  parts: ConflictPart[];
  ours: SideInfo;
  theirs: SideInfo;
  wrap: boolean;
  saving: boolean;
  saveLabel: string;
  /** Called with the resolved text and how many conflicts were left without a pick. */
  onSave: (text: string, unresolved: number) => void;
  onClose: () => void;
}) {
  const [picks, setPicks] = useState<Pick[]>([]);
  const [current, setCurrent] = useState(0);
  // Hand edits replace the generated output until Reset.
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState<string | null>(null);

  const layout = useMemo(() => layoutRows(parts, picks), [parts, picks]);
  const generated = useMemo(() => resolvedText(parts, picks), [parts, picks]);
  const unresolved = unresolvedCount(parts, picks);
  const total = layout.starts.length;
  const output = edited ?? generated;

  // ---- scrolling together ----
  const panes = useRef<(HTMLDivElement | null)[]>([null, null, null]);
  const onScroll = useCallback((from: number) => {
    const top = panes.current[from]?.scrollTop ?? 0;
    panes.current.forEach((el, i) => {
      if (el && i !== from && Math.abs(el.scrollTop - top) > 1) el.scrollTop = top;
    });
  }, []);
  const scrollTo = useCallback(
    (i: number) => {
      const row = layout.starts[i];
      if (row === undefined) return;
      const top = Math.max(0, (row - 4) * ROW);
      panes.current.forEach((el) => el && (el.scrollTop = top));
    },
    [layout.starts],
  );
  // Open on the first conflict.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || total === 0) return;
    opened.current = true;
    requestAnimationFrame(() => scrollTo(0));
  }, [total, scrollTo]);

  const go = (dir: 1 | -1) => {
    if (total === 0) return;
    const next = (current + dir + total) % total;
    setCurrent(next);
    scrollTo(next);
  };

  const update = useCallback((c: number, f: (p: Pick | undefined) => Pick) => {
    setEdited(null);
    setEditing(false);
    setCurrent(c);
    setPicks((prev) => {
      const next = [...prev];
      next[c] = f(next[c]);
      return next;
    });
  }, []);
  const pickLine = useCallback(
    (c: number, side: Side, line: number) => update(c, (p) => toggleLine(p, side, line)),
    [update],
  );
  const pickSide = useCallback(
    (c: number, side: Side) => {
      const part = parts.find((p) => p.type === 'conflict' && p.index === c);
      if (part?.type !== 'conflict') return;
      const n = side === 'ours' ? part.ours.length : part.theirs.length;
      update(c, (p) => toggleSide(p, side, n));
    },
    [parts, update],
  );
  const takeAll = (side: Side) => {
    setEdited(null);
    setEditing(false);
    setPicks(
      parts.flatMap((p) =>
        p.type === 'conflict'
          ? [
              {
                ours: side === 'ours' ? p.ours.map((_, i) => i) : [],
                theirs: side === 'theirs' ? p.theirs.map((_, i) => i) : [],
                first: side,
              },
            ]
          : [],
      ),
    );
  };
  const reset = () => {
    setPicks([]);
    setEdited(null);
    setEditing(false);
  };

  const save = () => onSave(output, edited === null ? unresolved : 0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const header = (side: Side) => {
    const info = side === 'ours' ? ours : theirs;
    return (
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-surface px-2">
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded border-2 text-xs font-bold"
          style={{ borderColor: sideColor(side), color: sideColor(side) }}
        >
          {side === 'ours' ? 'A' : 'B'}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {info.commit ? (
            <>
              {t('Commit {sha} on', { sha: info.commit.slice(0, 7) })}{' '}
              <span className="font-semibold italic" style={{ color: sideColor(side) }}>
                {info.label}
              </span>
            </>
          ) : (
            <span className="font-semibold italic" style={{ color: sideColor(side) }}>
              {info.label}
            </span>
          )}
        </span>
        <Button size="sm" variant="ghost" onClick={() => takeAll(side)}>
          {t('Take all')}
        </Button>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-warning-soft px-3">
        <span className="min-w-0 truncate font-medium">{path}</span>
        <span className="shrink-0 text-muted-foreground">
          {unresolved === 0
            ? t('All {n} conflicts have a choice', { n: total })
            : t('{n} of {total} conflicts unresolved', { n: unresolved, total })}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button size="sm" variant="ghost" onClick={reset} title={t('Clear every pick')}>
            <RotateCcw className="size-3.5" /> {t('Reset')}
          </Button>
          <Button size="sm" variant="primary" disabled={saving} onClick={save} title="Ctrl+S">
            {saving ? <Spinner /> : <Check className="size-3.5" />} {saveLabel}
          </Button>
          <IconButton label={t('Close')} onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 divide-x divide-border">
        {(['ours', 'theirs'] as const).map((side, k) => (
          <div key={side} className="flex min-h-0 min-w-0 flex-1 flex-col">
            {header(side)}
            <Pane
              rows={side === 'ours' ? layout.a : layout.b}
              side={side}
              picks={picks}
              current={current}
              paneRef={(el) => (panes.current[k] = el)}
              onScroll={() => onScroll(k)}
              onPickLine={pickLine}
              onPickSide={pickSide}
              parts={parts}
            />
          </div>
        ))}
      </div>

      <div className="flex h-8 shrink-0 items-center gap-2 border-y border-border bg-surface px-3">
        <span className="font-medium">{t('Output')}</span>
        {edited !== null && (
          <span className="text-xs text-muted-foreground">{t('edited by hand')}</span>
        )}
        <div className="flex flex-1 items-center justify-center gap-1.5">
          <span className="text-accent">
            {total > 0 ? t('conflict {n} of {total}', { n: current + 1, total }) : ''}
          </span>
          <IconButton label={t('Previous conflict')} onClick={() => go(-1)}>
            <ChevronUp className="size-4" />
          </IconButton>
          <IconButton label={t('Next conflict')} onClick={() => go(1)}>
            <ChevronDown className="size-4" />
          </IconButton>
        </div>
        <Button
          size="sm"
          variant={editing ? 'primary' : 'ghost'}
          onClick={() => {
            if (!editing && edited === null) setEdited(generated);
            setEditing(!editing);
          }}
          title={t('Type in the result yourself')}
        >
          <Pencil className="size-3.5" /> {t('Edit by hand')}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {editing ? (
          <CodeView
            value={output}
            path={path}
            editable
            wrap={wrap}
            onChange={(v) => setEdited(v)}
            onSave={save}
          />
        ) : edited !== null ? (
          // Hand-edited text no longer lines up with A / B: shown as is.
          <CodeView value={edited} path={path} wrap={wrap} />
        ) : (
          <Pane
            rows={layout.out}
            side={null}
            picks={picks}
            current={current}
            paneRef={(el) => (panes.current[2] = el)}
            onScroll={() => onScroll(2)}
            parts={parts}
          />
        )}
      </div>
    </div>
  );
}

/** One of the three panes: a virtualised list of equal-height rows. */
function Pane({
  rows,
  side,
  picks,
  current,
  paneRef,
  onScroll,
  onPickLine,
  onPickSide,
  parts,
}: {
  rows: Row[];
  /** A / B, or null for the output pane. */
  side: Side | null;
  picks: Pick[];
  current: number;
  paneRef: (el: HTMLDivElement | null) => void;
  onScroll: () => void;
  onPickLine?: (conflict: number, side: Side, line: number) => void;
  onPickSide?: (conflict: number, side: Side) => void;
  parts: ConflictPart[];
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // TanStack Virtual returns new functions on every render; nothing memoized depends on it.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => ref.current,
    estimateSize: () => ROW,
    overscan: 30,
  });
  const width = useMemo(() => rows.reduce((m, r) => Math.max(m, r.text?.length ?? 0), 0), [rows]);
  const sizes = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of parts)
      if (p.type === 'conflict')
        m.set(p.index, side === 'theirs' ? p.theirs.length : p.ours.length);
    return m;
  }, [parts, side]);

  return (
    <div
      ref={(el) => {
        ref.current = el;
        paneRef(el);
      }}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-auto font-mono text-xs"
    >
      <div
        style={{ height: virt.getTotalSize(), minWidth: `calc(${width}ch + 96px)` }}
        className="relative"
      >
        {virt.getVirtualItems().map((v) => {
          const r = rows[v.index]!;
          const pick = r.conflict !== undefined ? picks[r.conflict] : undefined;
          return (
            <PaneRow
              key={v.index}
              top={v.start}
              row={r}
              side={side}
              picked={side !== null && r.line !== undefined && !!pick?.[side].includes(r.line)}
              sideState={
                side !== null && r.head && r.conflict !== undefined
                  ? checkState(pick?.[side].length ?? 0, sizes.get(r.conflict) ?? 0)
                  : null
              }
              isCurrent={r.conflict === current}
              onPickLine={onPickLine}
              onPickSide={onPickSide}
            />
          );
        })}
      </div>
    </div>
  );
}

const checkState = (picked: number, size: number) =>
  size === 0 ? 'empty' : picked === 0 ? 'off' : picked === size ? 'on' : 'some';

const PaneRow = memo(function PaneRow({
  top,
  row: r,
  side,
  picked,
  sideState,
  isCurrent,
  onPickLine,
  onPickSide,
}: {
  top: number;
  row: Row;
  side: Side | null;
  picked: boolean;
  sideState: 'empty' | 'off' | 'some' | 'on' | null;
  isCurrent: boolean;
  onPickLine?: (conflict: number, side: Side, line: number) => void;
  onPickSide?: (conflict: number, side: Side) => void;
}) {
  const inConflict = r.conflict !== undefined;
  const color =
    r.kind === 'base'
      ? BASE
      : r.kind === 'ours'
        ? A
        : r.kind === 'theirs'
          ? B
          : side
            ? sideColor(side)
            : BASE;
  // Picked lines (and output lines) stand out; unpicked conflict lines stay faint.
  const strength =
    r.kind === 'pad' ? 6 : side === null ? (r.kind === 'text' ? 0 : 26) : picked ? 34 : 14;
  const canPick = side !== null && r.line !== undefined && r.conflict !== undefined;
  return (
    <div
      className={cn(
        'group absolute right-0 left-0 flex items-stretch',
        canPick && 'cursor-pointer',
      )}
      style={{
        top,
        height: ROW,
        background: inConflict ? mix(color, strength) : undefined,
        boxShadow: inConflict && isCurrent ? `inset 3px 0 0 ${color}` : undefined,
      }}
      onClick={canPick ? () => onPickLine?.(r.conflict!, side!, r.line!) : undefined}
    >
      {/* Whole-conflict checkbox on the conflict's first row. */}
      <div className="flex w-6 shrink-0 items-center justify-center">
        {sideState && sideState !== 'empty' && (
          <Checkbox
            checked={sideState === 'on'}
            indeterminate={sideState === 'some'}
            onChange={() => onPickSide?.(r.conflict!, side!)}
            aria-label={t('Pick all lines of this side')}
          />
        )}
        {side === null && (r.kind === 'ours' || r.kind === 'theirs') && (
          <span className="text-[10px] font-bold" style={{ color }}>
            {r.kind === 'ours' ? 'A' : 'B'}
          </span>
        )}
      </div>
      <div className="w-10 shrink-0 pr-2 text-right leading-5 text-muted-foreground select-none">
        {r.no ?? ''}
      </div>
      {/* Per-line pick: a tick when picked (minus on hover to drop it), a dot to pick it. */}
      <div className="flex w-5 shrink-0 items-center justify-center">
        {canPick &&
          (picked ? (
            <span
              className="flex size-3.5 items-center justify-center rounded-full text-white"
              style={{ background: 'var(--success)' }}
              title={t('Drop line')}
            >
              <Check className="size-2.5 group-hover:hidden" strokeWidth={3} />
              <Minus className="hidden size-2.5 group-hover:block" strokeWidth={3} />
            </span>
          ) : (
            <span
              className="size-3 rounded-full border border-muted-foreground/60 opacity-0 group-hover:opacity-100"
              title={t('Pick line')}
            />
          ))}
      </div>
      <pre
        className={cn(
          'flex-1 pr-3 leading-5 whitespace-pre',
          r.kind === 'text' && 'text-muted-foreground',
          r.kind === 'pad' &&
            'bg-[repeating-linear-gradient(135deg,transparent_0_4px,var(--border)_4px_5px)] opacity-40',
        )}
      >
        {r.text ?? ''}
      </pre>
    </div>
  );
});

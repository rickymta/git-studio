import { useEffect, useState } from 'react';

import { Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { DiffRequest, FileBlob } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { imageMime, imageSides, type BlobSide } from './image';

type Mode = 'side' | 'swipe' | 'onion';

interface Side {
  blob: FileBlob | null;
  url: string | null;
  size: { w: number; h: number } | null;
}

const empty: Side = { blob: null, url: null, size: null };

/** Transparent areas shown on a checkerboard. */
const checker: React.CSSProperties = {
  backgroundColor: 'var(--surface)',
  backgroundImage:
    'conic-gradient(var(--border) 25%, transparent 0 50%, var(--border) 0 75%, transparent 0)',
  backgroundSize: '16px 16px',
};

async function load(repo: string, side: BlobSide | null): Promise<Side> {
  if (!side) return empty;
  const blob = await api.fileBlob(repo, side.path, side.rev);
  if (!blob?.data) return { ...empty, blob };
  const mime = imageMime(side.path) ?? 'application/octet-stream';
  return { blob, url: `data:${mime};base64,${blob.data}`, size: null };
}

/**
 * Old and new version of an image: side by side, swipe, or onion skin. `only="after"` shows just
 * the new version (File View).
 */
export function ImageDiff({
  request,
  refreshKey,
  only,
}: {
  request: DiffRequest;
  refreshKey: unknown;
  only?: 'after';
}) {
  const repo = useRepo((s) => s.path)!;
  const [mode, setMode] = useState<Mode>('side');
  const [pos, setPos] = useState(50);
  const [state, setState] = useState<{ before: Side; after: Side } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const { before, after } = imageSides(request);
    Promise.all([load(repo, only ? null : before), load(repo, after)])
      .then(([b, a]) => {
        if (!alive) return;
        setState({ before: b, after: a });
        setError(null);
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [repo, request, refreshKey, only]);

  if (error) return <div className="p-6 text-muted-foreground">{error}</div>;
  if (!state)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-muted-foreground" />
      </div>
    );

  const { before, after } = state;
  const both = !!before.url && !!after.url;
  const measured = (which: 'before' | 'after') => (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const size = { w: img.naturalWidth, h: img.naturalHeight };
    setState((s) =>
      s && s[which].size?.w !== size.w ? { ...s, [which]: { ...s[which], size } } : s,
    );
  };

  const caption = (label: string, side: Side, tone: string) => (
    <div className="flex items-center justify-center gap-2 text-xs">
      <span className={cn('font-medium', tone)}>{label}</span>
      {side.blob && (
        <span className="text-muted-foreground tabular-nums">
          {side.size && `${side.size.w} × ${side.size.h} · `}
          {formatBytes(side.blob.size)}
        </span>
      )}
    </div>
  );

  const missing = (side: Side, text: string) => (
    <div className="flex min-h-32 items-center justify-center rounded border border-dashed border-border p-8 text-muted-foreground">
      {side.blob && !side.url
        ? t('Too large to preview ({size})', { size: formatBytes(side.blob.size) })
        : text}
    </div>
  );

  const img = (
    side: Side,
    which: 'before' | 'after',
    className?: string,
    style?: React.CSSProperties,
  ) =>
    side.url && (
      <img
        src={side.url}
        alt=""
        draggable={false}
        onLoad={measured(which)}
        className={cn('max-h-[70vh] max-w-full object-contain [grid-area:1/1]', className)}
        style={style}
      />
    );

  const seg = (m: Mode, label: string) => (
    <button
      type="button"
      className={cn(
        'h-6 px-2.5 text-xs',
        mode === m
          ? 'bg-accent-soft text-foreground'
          : 'text-muted-foreground hover:bg-surface-hover',
      )}
      onClick={() => setMode(m)}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {both && (
        <div className="flex shrink-0 items-center justify-center gap-3 border-b border-border py-2">
          <div className="flex overflow-hidden rounded-md border border-border">
            {seg('side', t('Side by side'))}
            {seg('swipe', t('Swipe'))}
            {seg('onion', t('Onion skin'))}
          </div>
          {mode !== 'side' && (
            <input
              type="range"
              min={0}
              max={100}
              value={pos}
              onChange={(e) => setPos(Number(e.target.value))}
              className="w-48 accent-[var(--accent)]"
              aria-label={mode === 'swipe' ? t('Swipe position') : t('Opacity')}
            />
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {only ? (
          <div className="flex flex-col items-center gap-2">
            {caption(t('Image'), after, 'text-foreground')}
            {after.url ? (
              <div className="grid" style={checker}>
                {img(after, 'after')}
              </div>
            ) : (
              missing(after, t('The file was deleted'))
            )}
          </div>
        ) : !both || mode === 'side' ? (
          <div className="grid grid-cols-2 items-start gap-6">
            <div className="flex min-w-0 flex-col items-center gap-2">
              {caption(t('Before'), before, 'text-danger')}
              {before.url ? (
                <div className="grid" style={checker}>
                  {img(before, 'before')}
                </div>
              ) : (
                missing(before, t('No file before this change'))
              )}
            </div>
            <div className="flex min-w-0 flex-col items-center gap-2">
              {caption(t('After'), after, 'text-success')}
              {after.url ? (
                <div className="grid" style={checker}>
                  {img(after, 'after')}
                </div>
              ) : (
                missing(after, t('The file was deleted'))
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="flex gap-8">
              {caption(t('Before'), before, 'text-danger')}
              {caption(t('After'), after, 'text-success')}
            </div>
            <div className="relative grid justify-items-start" style={checker}>
              {img(before, 'before')}
              {mode === 'swipe'
                ? img(after, 'after', undefined, { clipPath: `inset(0 0 0 ${pos}%)` })
                : img(after, 'after', undefined, { opacity: pos / 100 })}
              {mode === 'swipe' && (
                <div
                  className="pointer-events-none absolute inset-y-0 w-px bg-accent"
                  style={{ left: `${pos}%` }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

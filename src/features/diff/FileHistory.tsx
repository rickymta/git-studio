import { useEffect, useMemo, useState } from 'react';

import { Avatar, Spinner, cn } from '@/components/ui';
import { relativeTime, short } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { DecodedText, DiffRequest, FileHistoryEntry } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { CodeView } from './CodeView';
import { DiffBody, type DiffLayout } from './DiffBody';

const STATUS_WORD: Record<string, string> = {
  A: 'ADDED',
  M: 'MODIFIED',
  D: 'DELETED',
  R: 'RENAMED',
  C: 'COPIED',
  T: 'TYPE CHANGED',
};

/** Commits that touched one file (left) and that file at the chosen commit (right). */
export function FileHistory({
  path,
  layout,
  ignoreWhitespace,
  wrap,
  encoding,
}: {
  path: string;
  layout: DiffLayout;
  ignoreWhitespace: boolean;
  wrap: boolean;
  encoding?: string;
}) {
  const repo = useRepo((s) => s.path)!;
  const select = useRepo((s) => s.select);
  const [entries, setEntries] = useState<FileHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState(0);
  const [view, setView] = useState<'file' | 'diff'>('diff');
  const [file, setFile] = useState<DecodedText | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .fileHistory(repo, path)
      .then((e) => alive && setEntries(e))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [repo, path]);

  const entry = entries?.[picked];
  const request = useMemo<DiffRequest | null>(
    () =>
      entry
        ? {
            source: 'commit',
            path: entry.change.path,
            origPath: entry.change.origPath,
            commit: entry.hash,
            parent: entry.parents[0] ?? null,
          }
        : null,
    [entry],
  );

  useEffect(() => {
    if (!entry || view !== 'file') return;
    let alive = true;
    const deleted = entry.change.status === 'D';
    api
      .readFile(
        repo,
        deleted ? (entry.change.origPath ?? entry.change.path) : entry.change.path,
        deleted ? `${entry.hash}^` : entry.hash,
        encoding,
      )
      .then((f) => {
        if (!alive) return;
        setFile(f);
        setFileError(null);
      })
      .catch((e) => alive && setFileError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [repo, entry, view, encoding]);

  if (error) return <div className="p-6 text-danger">{error}</div>;
  if (!entries) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[340px] shrink-0 flex-col border-r border-border bg-surface">
        <div className="min-h-0 flex-1 overflow-auto">
          {entries.map((e, i) => (
            <div
              key={e.hash}
              role="button"
              tabIndex={0}
              onClick={() => setPicked(i)}
              onDoubleClick={() => select({ type: 'commit', hash: e.hash })}
              onKeyDown={(ev) => {
                if (ev.key === 'ArrowDown') setPicked(Math.min(entries.length - 1, i + 1));
                if (ev.key === 'ArrowUp') setPicked(Math.max(0, i - 1));
              }}
              title={t('Double-click to show the commit in the graph')}
              className={cn(
                'flex cursor-default gap-2.5 border-b border-border/60 px-3 py-2',
                i === picked ? 'bg-selection' : 'hover:bg-surface-hover',
              )}
            >
              <Avatar name={e.authorName} email={e.authorEmail} size={28} />
              <div className="min-w-0 flex-1">
                <div className="flex gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{e.subject}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {short(e.hash)}
                  </span>
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {t('{time} by {author}', {
                    time: relativeTime(e.authorTime),
                    author: e.authorName,
                  })}
                </div>
                {(e.change.status !== 'M' || e.change.origPath) && (
                  <div className="mt-0.5 truncate text-[11px] text-accent">
                    {t(STATUS_WORD[e.change.status] ?? e.change.status)}{' '}
                    <span className="text-muted-foreground">
                      {e.change.origPath
                        ? `${e.change.origPath} → ${e.change.path}`
                        : e.change.path}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div className="py-3 text-center text-xs text-muted-foreground">
            {t('End of History')}
          </div>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center justify-center border-b border-border">
          <div className="flex overflow-hidden rounded-md border border-border">
            {(['file', 'diff'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  'h-6 px-3 text-xs',
                  view === v
                    ? 'bg-accent-soft text-foreground'
                    : 'text-muted-foreground hover:bg-surface-hover',
                )}
              >
                {v === 'file' ? t('File View') : t('Diff View')}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {request && view === 'diff' && (
            <DiffBody
              request={request}
              layout={layout}
              ignoreWhitespace={ignoreWhitespace}
              wrap={wrap}
              encoding={encoding}
              actions="none"
            />
          )}
          {view === 'file' &&
            (fileError ? (
              <div className="p-6 text-danger">{fileError}</div>
            ) : file ? (
              file.binary ? (
                <div className="p-8 text-center text-muted-foreground">{t('Binary file')}</div>
              ) : (
                <CodeView value={file.text} path={path} wrap={wrap} />
              )
            ) : (
              <div className="flex h-full items-center justify-center">
                <Spinner className="text-muted-foreground" />
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

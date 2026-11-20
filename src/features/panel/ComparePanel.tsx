import { ArrowLeftRight, ArrowRight, GitCompareArrows, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { IconButton, Spinner, cn } from '@/components/ui';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { copyText } from '@/lib/native';
import type { Comparison, FileChange } from '@/lib/types';
import { useRepo, type CompareSide } from '@/stores/repo';
import { compareCommits } from '../actions';
import {
  EmptyFiles,
  FileList,
  SortButton,
  ViewToggle,
  sortFiles,
  useFileSort,
  useViewMode,
} from './FileList';

/** Badge naming one end of the comparison. */
function Side({ side, tone }: { side: CompareSide; tone: 'base' | 'target' }) {
  return (
    <span
      title={side.rev === side.label ? side.hash : `${side.label}\n${side.hash}`}
      className={cn(
        'max-w-[45%] min-w-0 truncate rounded border px-1.5 font-mono text-xs leading-5',
        tone === 'base' ? 'border-border text-muted-foreground' : 'border-accent/60 text-accent',
      )}
    >
      {side.label}
    </span>
  );
}

/**
 * What changes from one commit (or branch, tag) to another: commits each side has that the other
 * lacks, and the files that differ, each opening its base → target diff.
 */
export function ComparePanel({ base, target }: { base: CompareSide; target: CompareSide }) {
  const repo = useRepo((s) => s.path)!;
  const diff = useRepo((s) => s.diff);
  const openDiff = useRepo((s) => s.openDiff);
  const select = useRepo((s) => s.select);
  // Branch names follow their refs: list again when the repository changes.
  const refs = useRepo((s) => s.refs);
  const [mode, setMode] = useViewMode();
  const [sort, setSort] = useFileSort();
  const [result, setResult] = useState<{ key: string; data: Comparison | Error } | null>(null);
  const key = `${base.rev}\u0000${target.rev}`;

  useEffect(() => {
    let live = true;
    api
      .compareCommits(repo, base.rev, target.rev)
      .then((data) => live && setResult({ key, data }))
      .catch((e: Error) => live && setResult({ key, data: e }));
    return () => {
      live = false;
    };
  }, [repo, base.rev, target.rev, key, refs]);

  const data = result?.key === key ? result.data : null;
  const files = useMemo(
    () => (data && !(data instanceof Error) ? sortFiles(data.files, sort) : []),
    [data, sort],
  );

  const isActive = (f: FileChange) =>
    diff?.request.source === 'commit' &&
    diff.request.commit === target.rev &&
    diff.request.parent === base.rev &&
    diff.request.path === f.path;
  const open = (f: FileChange) =>
    openDiff({
      source: 'commit',
      path: f.path,
      origPath: f.origPath,
      commit: target.rev,
      parent: base.rev,
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="size-4 shrink-0 text-accent" />
          <span className="flex-1 text-[13px] font-semibold">{t('Compare')}</span>
          <IconButton label={t('Swap sides')} onClick={() => void compareCommits(target, base)}>
            <ArrowLeftRight className="size-3.5" />
          </IconButton>
          <IconButton
            label={t('Stop comparing')}
            onClick={() => void select({ type: 'commit', hash: target.hash })}
          >
            <X className="size-3.5" />
          </IconButton>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Side side={base} tone="base" />
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
          <Side side={target} tone="target" />
        </div>
        {data && !(data instanceof Error) && (
          <div className="mt-2 text-xs text-muted-foreground">
            {t('{ahead} commit(s) only on {target}, {behind} only on {base}', {
              ahead: data.ahead,
              behind: data.behind,
              target: target.label,
              base: base.label,
            })}
          </div>
        )}
      </div>

      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <span className="text-[13px] font-medium">
          {t('{n} files changed', { n: files.length })}
        </span>
        <div className="flex-1" />
        <SortButton sort={sort} onChange={setSort} />
        <ViewToggle mode={mode} onChange={setMode} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {!data ? (
          <div className="flex justify-center p-4">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : data instanceof Error ? (
          <div className="px-3 py-2 text-xs text-danger">{data.message}</div>
        ) : files.length === 0 ? (
          <EmptyFiles text={t('Both sides have the same files.')} />
        ) : (
          <FileList
            files={files}
            mode={mode}
            isActive={isActive}
            onOpen={open}
            menu={(f) => [{ label: t('Copy file path'), onSelect: () => copyText(f.path) }]}
          />
        )}
      </div>
    </div>
  );
}

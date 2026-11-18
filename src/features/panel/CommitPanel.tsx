import { ArrowLeftRight, Copy, X } from 'lucide-react';

import { Avatar, IconButton, Spinner } from '@/components/ui';
import { fullDate, short } from '@/lib/format';
import { t } from '@/lib/i18n';
import { copyText } from '@/lib/native';
import type { FileChange } from '@/lib/types';
import { useCompare } from '@/stores/compare';
import { useRepo } from '@/stores/repo';
import { FileList, FilesSection, ViewToggle, useViewMode } from './FileList';

export function CommitPanel({ hash }: { hash: string }) {
  const detail = useRepo((s) => s.detail);
  const diff = useRepo((s) => s.diff);
  const openDiff = useRepo((s) => s.openDiff);
  const select = useRepo((s) => s.select);
  const [mode, setMode] = useViewMode();
  const compare = useCompare();

  if (!detail || detail.hash !== hash) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-muted-foreground" />
      </div>
    );
  }
  const d = detail;
  const rest = d.body.split('\n').slice(1).join('\n').trim();
  const isActive = (f: FileChange) =>
    diff?.request.source === 'commit' &&
    diff.request.commit === d.hash &&
    diff.request.path === f.path;
  const comparing = compare.hash === d.hash;
  const isCompareActive = (f: FileChange) =>
    diff?.request.source === 'worktree' &&
    diff.request.commit === d.hash &&
    diff.request.path === f.path;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
        <span>{t('commit:')}</span>
        <code className="selectable font-mono text-foreground">{short(d.hash)}</code>
        <IconButton label={t('Copy SHA')} onClick={() => copyText(d.hash)}>
          <Copy className="size-3" />
        </IconButton>
        {d.parents.length > 0 && (
          <span className="ml-auto flex gap-1">
            {d.parents.length > 1 ? t('parents:') : t('parent:')}
            {d.parents.map((p) => (
              <button
                key={p}
                type="button"
                className="font-mono text-accent hover:underline"
                onClick={() => select({ type: 'commit', hash: p })}
              >
                {short(p)}
              </button>
            ))}
          </span>
        )}
      </div>
      <div className="shrink-0 border-b border-border p-3">
        <div className="selectable text-[15px] font-semibold">{d.subject}</div>
        {rest && (
          <pre className="selectable mt-2 max-h-48 overflow-auto font-sans whitespace-pre-wrap text-muted-foreground">
            {rest}
          </pre>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Avatar name={d.authorName} size={32} />
          <div className="min-w-0 text-xs">
            <div className="truncate">
              <span className="font-medium">{d.authorName}</span>{' '}
              <span className="text-muted-foreground">&lt;{d.authorEmail}&gt;</span>
            </div>
            <div className="text-muted-foreground">
              {t('authored {date}', { date: fullDate(d.authorTime) })}
            </div>
            {d.committerName !== d.authorName && (
              <div className="text-muted-foreground">
                {t('committed by {name}', { name: d.committerName })}
              </div>
            )}
          </div>
        </div>
      </div>
      {comparing && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-accent/10 px-3 text-xs">
          <ArrowLeftRight className="size-3.5 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">
            {t('Comparing {hash} ↔ working directory', { hash: short(d.hash) })}
          </span>
          {compare.loading && <Spinner className="size-3.5 text-muted-foreground" />}
          <IconButton label={t('Stop comparing')} onClick={() => compare.stop()}>
            <X className="size-3.5" />
          </IconButton>
        </div>
      )}
      <div className="flex h-10 shrink-0 items-center justify-end px-3">
        <ViewToggle mode={mode} onChange={setMode} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {comparing && (
          <FilesSection title={t('Changes since this commit')} count={compare.files?.length ?? 0}>
            {compare.files?.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                {t('The working directory matches this commit.')}
              </div>
            )}
            <FileList
              files={compare.files ?? []}
              mode={mode}
              isActive={isCompareActive}
              onOpen={(f) =>
                openDiff({ source: 'worktree', path: f.path, origPath: f.origPath, commit: d.hash })
              }
              menu={(f) => [{ label: t('Copy file path'), onSelect: () => copyText(f.path) }]}
            />
          </FilesSection>
        )}
        <FilesSection title={t('Changed Files')} count={d.files.length}>
          <FileList
            files={d.files}
            mode={mode}
            isActive={isActive}
            onOpen={(f) =>
              openDiff({
                source: 'commit',
                path: f.path,
                origPath: f.origPath,
                commit: d.hash,
                parent: d.parents[0] ?? null,
              })
            }
            menu={(f) => [{ label: t('Copy file path'), onSelect: () => copyText(f.path) }]}
          />
        </FilesSection>
      </div>
    </div>
  );
}

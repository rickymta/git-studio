import { Copy } from 'lucide-react';

import { Avatar, IconButton, Spinner } from '@/components/ui';
import { fullDate, short } from '@/lib/format';
import { copyText } from '@/lib/native';
import type { FileChange } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { FileList, FilesSection, ViewToggle, useViewMode } from './FileList';

export function CommitPanel({ hash }: { hash: string }) {
  const detail = useRepo((s) => s.detail);
  const diff = useRepo((s) => s.diff);
  const openDiff = useRepo((s) => s.openDiff);
  const select = useRepo((s) => s.select);
  const [mode, setMode] = useViewMode();

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
        <span>commit:</span>
        <code className="selectable font-mono text-foreground">{short(d.hash)}</code>
        <IconButton label="Copy SHA" onClick={() => copyText(d.hash)}>
          <Copy className="size-3" />
        </IconButton>
        {d.parents.length > 0 && (
          <span className="ml-auto flex gap-1">
            parent{d.parents.length > 1 ? 's' : ''}:
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
            <div className="text-muted-foreground">authored {fullDate(d.authorTime)}</div>
            {d.committerName !== d.authorName && (
              <div className="text-muted-foreground">committed by {d.committerName}</div>
            )}
          </div>
        </div>
      </div>
      <div className="flex h-10 shrink-0 items-center justify-end px-3">
        <ViewToggle mode={mode} onChange={setMode} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <FilesSection title="Changed Files" count={d.files.length}>
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
            menu={(f) => [{ label: 'Copy file path', onSelect: () => copyText(f.path) }]}
          />
        </FilesSection>
      </div>
    </div>
  );
}

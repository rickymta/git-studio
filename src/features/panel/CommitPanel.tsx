import { Copy } from 'lucide-react';

import { Avatar, IconButton, SectionTitle, Spinner } from '@/components/ui';
import { fullDate, short } from '@/lib/format';
import { copyText } from '@/lib/native';
import { useRepo } from '@/stores/repo';
import { FileRow } from './FileList';

export function CommitPanel({ hash }: { hash: string }) {
  const detail = useRepo((s) => s.detail);
  const diff = useRepo((s) => s.diff);
  const openDiff = useRepo((s) => s.openDiff);
  const select = useRepo((s) => s.select);

  if (!detail || detail.hash !== hash) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-muted-foreground" />
      </div>
    );
  }
  const d = detail;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>commit</span>
          <code className="selectable font-mono">{short(d.hash)}</code>
          <IconButton label="Copy SHA" onClick={() => copyText(d.hash)}>
            <Copy className="size-3" />
          </IconButton>
          {d.parents.length > 0 && (
            <span className="ml-auto flex gap-1">
              parent{d.parents.length > 1 ? 's' : ''}
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
        <div className="selectable mt-2 text-[14px] font-semibold">{d.subject}</div>
        {d.body.split('\n').slice(1).join('\n').trim() && (
          <pre className="selectable mt-2 max-h-48 overflow-auto font-sans whitespace-pre-wrap text-muted-foreground">
            {d.body.split('\n').slice(1).join('\n').trim()}
          </pre>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Avatar name={d.authorName} size={28} />
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
      <SectionTitle>
        {d.files.length} file{d.files.length === 1 ? '' : 's'} changed
      </SectionTitle>
      <div className="min-h-0 flex-1 overflow-auto">
        {d.files.map((f) => (
          <FileRow
            key={f.path}
            file={f}
            active={
              diff?.request.source === 'commit' &&
              diff.request.commit === d.hash &&
              diff.request.path === f.path
            }
            onClick={() =>
              openDiff({
                source: 'commit',
                path: f.path,
                origPath: f.origPath,
                commit: d.hash,
                parent: d.parents[0] ?? null,
              })
            }
            menu={() => [{ label: 'Copy path', onSelect: () => copyText(f.path) }]}
          />
        ))}
      </div>
    </div>
  );
}

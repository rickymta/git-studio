import { Check, GitCommitHorizontal, Minus, Plus, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button, IconButton, Spinner, Textarea, cn } from '@/components/ui';
import { joinPath } from '@/lib/format';
import { api } from '@/lib/ipc';
import { copyText, revealPath } from '@/lib/native';
import type { FileChange } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { confirm } from '@/stores/ui';
import { commitChanges } from '../actions';
import { EmptyFiles, FileList, FilesSection, ViewToggle, useViewMode } from './FileList';

const SUMMARY_MAX = 72;

export function WipPanel() {
  const info = useRepo((s) => s.info);
  const diff = useRepo((s) => s.diff);
  const openDiff = useRepo((s) => s.openDiff);
  const run = useRepo((s) => s.run);
  const busy = useRepo((s) => s.busy);
  const path = useRepo((s) => s.path)!;
  const [mode, setMode] = useViewMode();
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [amend, setAmend] = useState(false);
  const [identity, setIdentity] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    api
      .identity(path)
      .then(setIdentity)
      .catch(() => setIdentity(null));
  }, [path]);

  if (!info) return null;
  const st = info.status;
  const total = st.staged.length + st.unstaged.length + st.conflicted.length;

  const isActive = (source: 'staged' | 'unstaged') => (f: FileChange) =>
    diff?.request.source === source && diff.request.path === f.path;

  const show = (source: 'staged' | 'unstaged') => (f: FileChange) =>
    openDiff({ source, path: f.path, origPath: f.origPath, untracked: f.status === '?' });

  const discard = async (files: FileChange[]) => {
    const what = files.length === 1 ? files[0]!.path : `${files.length} files`;
    if (
      !(await confirm(
        'Discard changes',
        `Discard changes in ${what}? This cannot be undone.`,
        'Discard',
        true,
      ))
    )
      return;
    await run('Discard', (p) =>
      api.discard(
        p,
        files.filter((f) => f.status !== '?').map((f) => f.path),
        files.filter((f) => f.status === '?').map((f) => f.path),
      ),
    );
  };

  const toggleAmend = async (on: boolean) => {
    setAmend(on);
    if (on && !summary.trim()) {
      try {
        const msg = await api.headMessage(path);
        const [first, ...rest] = msg.split('\n');
        setSummary(first ?? '');
        setBody(rest.join('\n').trim());
      } catch {
        /* no HEAD */
      }
    }
  };

  const message = body.trim() ? `${summary.trim()}\n\n${body.trim()}` : summary.trim();
  const canCommit =
    !!summary.trim() && (st.staged.length > 0 || amend) && st.conflicted.length === 0;

  const commit = async () => {
    if (await commitChanges(message, amend)) {
      setSummary('');
      setBody('');
      setAmend(false);
    }
  };

  const stage = (paths: string[]) => run('Stage', (p) => api.stage(p, paths));
  const unstage = (paths: string[]) => run('Unstage', (p) => api.unstage(p, paths));
  const common = (f: FileChange) => [
    { label: 'Copy file path', onSelect: () => copyText(f.path) },
    { label: 'Open file', onSelect: () => revealPath(joinPath(path, f.path)) },
  ];

  let commitLabel = 'Stage Changes to Commit';
  if (st.conflicted.length > 0) commitLabel = 'Resolve conflicts to commit';
  else if (amend) commitLabel = 'Amend Previous Commit';
  else if (st.staged.length > 0 && !summary.trim()) commitLabel = 'Type a Commit Summary';
  else if (st.staged.length > 0)
    commitLabel = `Commit Changes to ${st.staged.length} File${st.staged.length > 1 ? 's' : ''}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        {total > 0 && (
          <IconButton label="Discard all changes" onClick={() => discard(st.unstaged)}>
            <Trash2 className="size-4 text-danger" />
          </IconButton>
        )}
        <span className="min-w-0 flex-1 truncate">
          {total} file change{total === 1 ? '' : 's'} on{' '}
          <span className="rounded bg-accent-soft px-1.5 py-0.5 font-medium text-accent">
            {st.branch ?? 'detached HEAD'}
          </span>
        </span>
      </div>
      <div className="flex h-10 shrink-0 items-center justify-end px-3">
        <ViewToggle mode={mode} onChange={setMode} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {st.conflicted.length > 0 && (
          <FilesSection title="Conflicted Files" count={st.conflicted.length} tone="danger">
            <FileList
              files={st.conflicted}
              mode={mode}
              isActive={isActive('unstaged')}
              onOpen={(f) => openDiff({ source: 'unstaged', path: f.path })}
              menu={(f) => [
                {
                  label: 'Take ours (current branch)',
                  onSelect: () => run('Resolve', (p) => api.resolve(p, [f.path], 'ours')),
                },
                {
                  label: 'Take theirs (incoming)',
                  onSelect: () => run('Resolve', (p) => api.resolve(p, [f.path], 'theirs')),
                },
                { label: 'Mark as resolved', onSelect: () => stage([f.path]) },
                'sep',
                ...common(f),
              ]}
              actions={(f) => (
                <IconButton
                  label="Mark resolved"
                  onClick={(e) => {
                    e.stopPropagation();
                    void stage([f.path]);
                  }}
                >
                  <Check className="size-3.5" />
                </IconButton>
              )}
            />
          </FilesSection>
        )}

        <FilesSection
          title="Unstaged Files"
          count={st.unstaged.length}
          right={
            st.unstaged.length > 0 && (
              <button
                type="button"
                onClick={() => stage([])}
                className="h-6 rounded border border-success/60 bg-success-soft px-2 text-xs font-medium text-success hover:brightness-110"
              >
                Stage All Changes
              </button>
            )
          }
        >
          {st.unstaged.length === 0 ? (
            <EmptyFiles text="No unstaged changes" />
          ) : (
            <FileList
              files={st.unstaged}
              mode={mode}
              isActive={isActive('unstaged')}
              onOpen={show('unstaged')}
              menu={(f) => [
                { label: 'Stage file', onSelect: () => stage([f.path]) },
                { label: 'Discard changes', danger: true, onSelect: () => discard([f]) },
                'sep',
                ...common(f),
              ]}
              actions={(f) => (
                <>
                  <IconButton
                    label="Discard"
                    onClick={(e) => {
                      e.stopPropagation();
                      void discard([f]);
                    }}
                  >
                    <Undo2 className="size-3.5" />
                  </IconButton>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void stage([f.path]);
                    }}
                    className="flex h-5 items-center gap-0.5 rounded bg-success-soft px-1.5 text-xs text-success"
                  >
                    <Plus className="size-3" /> Stage
                  </button>
                </>
              )}
            />
          )}
        </FilesSection>

        <FilesSection
          title="Staged Files"
          count={st.staged.length}
          right={
            st.staged.length > 0 && (
              <button
                type="button"
                onClick={() => unstage([])}
                className="h-6 rounded border border-danger/60 bg-danger-soft px-2 text-xs font-medium text-danger hover:brightness-110"
              >
                Unstage All Changes
              </button>
            )
          }
        >
          {st.staged.length === 0 ? (
            <EmptyFiles text="Stage files to include them in the commit" />
          ) : (
            <FileList
              files={st.staged}
              mode={mode}
              isActive={isActive('staged')}
              onOpen={show('staged')}
              menu={(f) => [
                { label: 'Unstage file', onSelect: () => unstage([f.path]) },
                'sep',
                ...common(f),
              ]}
              actions={(f) => (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void unstage([f.path]);
                  }}
                  className="flex h-5 items-center gap-0.5 rounded bg-danger-soft px-1.5 text-xs text-danger"
                >
                  <Minus className="size-3" /> Unstage
                </button>
              )}
            />
          )}
        </FilesSection>
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <div className="mb-2 flex items-center gap-1.5 font-medium">
          <GitCommitHorizontal className="size-4" /> Commit
        </div>
        {identity && (!identity.name || !identity.email) && (
          <div className="mb-2 rounded-md bg-warning-soft p-2 text-xs">
            Git user name/email is not set. Set it in Settings before committing.
          </div>
        )}
        <label className="mb-2 flex items-center gap-2">
          <input
            type="checkbox"
            checked={amend}
            onChange={(e) => toggleAmend(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          Amend previous commit
        </label>
        <div className="rounded-md border border-border bg-background focus-within:border-accent">
          <div className="flex items-center">
            <input
              className="h-9 min-w-0 flex-1 bg-transparent px-3 text-[14px] outline-none placeholder:text-muted-foreground"
              placeholder="Commit summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canCommit) void commit();
              }}
            />
            <span
              className={cn(
                'pr-3 text-xs tabular-nums',
                SUMMARY_MAX - summary.length < 0 ? 'text-danger' : 'text-muted-foreground',
              )}
              title="Characters left before the 72-character guideline"
            >
              {SUMMARY_MAX - summary.length}
            </span>
          </div>
          <Textarea
            className="rounded-none border-0 border-t border-border bg-transparent focus:border-border"
            rows={4}
            placeholder="Description"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canCommit) void commit();
            }}
          />
        </div>
        <Button
          variant={canCommit ? 'primary' : 'ghost'}
          className={cn(
            'mt-2 h-9 w-full',
            !canCommit && 'border border-success/40 bg-success-soft text-success',
          )}
          disabled={!canCommit || !!busy}
          onClick={commit}
        >
          {busy === 'Commit' && <Spinner />}
          <GitCommitHorizontal className="size-4" />
          {commitLabel}
        </Button>
      </div>
    </div>
  );
}

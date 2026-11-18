import { Check, Minus, Plus, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button, IconButton, SectionTitle, Spinner, Textarea } from '@/components/ui';
import { api } from '@/lib/ipc';
import { copyText, revealPath } from '@/lib/native';
import type { FileChange } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { confirm, toast } from '@/stores/ui';
import { joinPath } from '@/lib/format';
import { FileRow } from './FileList';

export function WipPanel() {
  const info = useRepo((s) => s.info);
  const diff = useRepo((s) => s.diff);
  const openDiff = useRepo((s) => s.openDiff);
  const run = useRepo((s) => s.run);
  const busy = useRepo((s) => s.busy);
  const path = useRepo((s) => s.path)!;
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

  const isActive = (f: FileChange, source: 'staged' | 'unstaged') =>
    diff?.request.source === source && diff.request.path === f.path;

  const show = (f: FileChange, source: 'staged' | 'unstaged') =>
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
    const ok = await run('Commit', (p) => api.commitChanges(p, message, amend));
    if (ok) {
      setSummary('');
      setBody('');
      setAmend(false);
      toast('success', amend ? 'Commit amended' : 'Committed');
    }
  };

  const fileMenu = (f: FileChange) => () => [
    { label: 'Copy path', onSelect: () => copyText(f.path) },
    { label: 'Open file', onSelect: () => revealPath(joinPath(path, f.path)) },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {st.conflicted.length > 0 && (
          <>
            <SectionTitle>
              <span className="text-danger">Conflicts ({st.conflicted.length})</span>
            </SectionTitle>
            {st.conflicted.map((f) => (
              <FileRow
                key={'c' + f.path}
                file={f}
                active={isActive(f, 'unstaged')}
                onClick={() => openDiff({ source: 'unstaged', path: f.path })}
                menu={() => [
                  {
                    label: 'Take ours (current branch)',
                    onSelect: () => run('Resolve', (p) => api.resolve(p, [f.path], 'ours')),
                  },
                  {
                    label: 'Take theirs (incoming)',
                    onSelect: () => run('Resolve', (p) => api.resolve(p, [f.path], 'theirs')),
                  },
                  {
                    label: 'Mark as resolved (stage)',
                    onSelect: () => run('Stage', (p) => api.stage(p, [f.path])),
                  },
                  'sep',
                  { label: 'Open file', onSelect: () => revealPath(joinPath(path, f.path)) },
                ]}
                actions={
                  <IconButton
                    label="Mark resolved"
                    onClick={(e) => {
                      e.stopPropagation();
                      void run('Stage', (p) => api.stage(p, [f.path]));
                    }}
                  >
                    <Check className="size-3.5" />
                  </IconButton>
                }
              />
            ))}
          </>
        )}

        <SectionTitle
          right={
            st.unstaged.length > 0 && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 normal-case"
                  onClick={() => discard(st.unstaged)}
                >
                  Discard all
                </Button>
                <Button
                  size="sm"
                  className="h-6 normal-case"
                  onClick={() => run('Stage all', (p) => api.stage(p, []))}
                >
                  Stage all
                </Button>
              </>
            )
          }
        >
          Unstaged ({st.unstaged.length})
        </SectionTitle>
        {st.unstaged.map((f) => (
          <FileRow
            key={'u' + f.path}
            file={f}
            active={isActive(f, 'unstaged')}
            onClick={() => show(f, 'unstaged')}
            menu={() => [
              { label: 'Stage', onSelect: () => run('Stage', (p) => api.stage(p, [f.path])) },
              { label: 'Discard changes', danger: true, onSelect: () => discard([f]) },
              'sep',
              ...fileMenu(f)(),
            ]}
            actions={
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
                <IconButton
                  label="Stage"
                  onClick={(e) => {
                    e.stopPropagation();
                    void run('Stage', (p) => api.stage(p, [f.path]));
                  }}
                >
                  <Plus className="size-3.5" />
                </IconButton>
              </>
            }
          />
        ))}

        <SectionTitle
          right={
            st.staged.length > 0 && (
              <Button
                size="sm"
                className="h-6 normal-case"
                onClick={() => run('Unstage all', (p) => api.unstage(p, []))}
              >
                Unstage all
              </Button>
            )
          }
        >
          Staged ({st.staged.length})
        </SectionTitle>
        {st.staged.map((f) => (
          <FileRow
            key={'s' + f.path}
            file={f}
            active={isActive(f, 'staged')}
            onClick={() => show(f, 'staged')}
            menu={() => [
              { label: 'Unstage', onSelect: () => run('Unstage', (p) => api.unstage(p, [f.path])) },
              'sep',
              ...fileMenu(f)(),
            ]}
            actions={
              <IconButton
                label="Unstage"
                onClick={(e) => {
                  e.stopPropagation();
                  void run('Unstage', (p) => api.unstage(p, [f.path]));
                }}
              >
                <Minus className="size-3.5" />
              </IconButton>
            }
          />
        ))}
        {st.staged.length + st.unstaged.length + st.conflicted.length === 0 && (
          <div className="px-4 py-6 text-center text-muted-foreground">Working tree clean.</div>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        {identity && (!identity.name || !identity.email) && (
          <div className="mb-2 rounded-md bg-warning-soft p-2 text-xs">
            Git user name/email is not set. Set it in Settings before committing.
          </div>
        )}
        <div className="relative">
          <input
            className="h-8 w-full rounded-md border border-border bg-background px-2.5 pr-10 outline-none placeholder:text-muted-foreground focus:border-accent"
            placeholder="Summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canCommit) void commit();
            }}
          />
          <span
            className={`absolute top-2 right-2 text-xs ${summary.length > 72 ? 'text-warning' : 'text-muted-foreground'}`}
          >
            {summary.length}
          </span>
        </div>
        <Textarea
          className="mt-2"
          rows={4}
          placeholder="Description (optional)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canCommit) void commit();
          }}
        />
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={amend}
            onChange={(e) => toggleAmend(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          Amend previous commit
        </label>
        <Button
          variant="primary"
          className="mt-2 h-9 w-full"
          disabled={!canCommit || !!busy}
          onClick={commit}
        >
          {busy === 'Commit' && <Spinner />}
          {amend
            ? 'Amend commit'
            : st.staged.length > 0
              ? `Commit ${st.staged.length} file${st.staged.length > 1 ? 's' : ''}`
              : 'Stage files to commit'}
        </Button>
        <div className="mt-1 text-center text-[11px] text-muted-foreground">
          Ctrl+Enter to commit
        </div>
      </div>
    </div>
  );
}

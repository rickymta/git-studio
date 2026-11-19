import { ArrowLeftRight, Copy, Pencil, TriangleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { Avatar, IconButton, Spinner, cn } from '@/components/ui';
import { short } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { copyText } from '@/lib/native';
import type { FileChange, FileStatus } from '@/lib/types';
import { useCompare } from '@/stores/compare';
import { useRepo } from '@/stores/repo';
import { amendHeadMessage, canAmendMessage, headIsPushed } from '../actions';
import { SUMMARY_MAX, joinMessage, splitMessage } from './commitMessage';
import {
  FileList,
  FilesSection,
  SortButton,
  ViewToggle,
  sortFiles,
  useFileSort,
  useViewMode,
} from './FileList';

/** "11/17/2026 @ 12:12 AM" */
function authoredAt(unix: number): string {
  const d = new Date(unix * 1000);
  return `${d.toLocaleDateString()} @ ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

/** `Co-authored-by: Name <email>` trailers. */
function coAuthors(body: string): { name: string; email: string }[] {
  const out: { name: string; email: string }[] = [];
  for (const line of body.split('\n')) {
    const m = /^co-authored-by:\s*(.+?)\s*<([^>]*)>\s*$/i.exec(line.trim());
    if (m) out.push({ name: m[1]!, email: m[2]! });
  }
  return out;
}

function usePersistedNumber(key: string, initial: number): [number, (v: number) => void] {
  const [v, setV] = useState(() => {
    try {
      const n = Number(localStorage.getItem(key));
      return n > 0 ? n : initial;
    } catch {
      return initial;
    }
  });
  return [
    v,
    (n) => {
      setV(n);
      try {
        localStorage.setItem(key, String(n));
      } catch {
        /* ignore */
      }
    },
  ];
}

const SUMMARY: { status: FileStatus[]; mark: string; cls: string; label: string }[] = [
  { status: ['M', 'T'], mark: '✎', cls: 'text-warning', label: '{n} modified' },
  { status: ['A'], mark: '+', cls: 'text-success', label: '{n} added' },
  { status: ['D'], mark: '−', cls: 'text-danger', label: '{n} deleted' },
  { status: ['R', 'C'], mark: '→', cls: 'text-accent', label: '{n} renamed' },
];

/** Heading of the summary / description parts, styled like the panel's other section titles. */
function MessageLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex h-6 items-center gap-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
      <span className="flex-1">{children}</span>
      {right}
    </div>
  );
}

const EDIT_FIELD =
  'w-full min-w-0 rounded-md border border-border bg-surface-muted/40 px-2.5 outline-none placeholder:text-muted-foreground focus:border-accent disabled:opacity-60';

const EDIT_BUTTON =
  'inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border font-medium whitespace-nowrap hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-50';

/** Details of a selected commit, laid out like GitKraken's commit panel. */
export function CommitPanel({ hash }: { hash: string }) {
  const detail = useRepo((s) => s.detail);
  const diff = useRepo((s) => s.diff);
  const openDiff = useRepo((s) => s.openDiff);
  const select = useRepo((s) => s.select);
  const repo = useRepo((s) => s.path)!;
  const [mode, setMode] = useViewMode();
  const [sort, setSort] = useFileSort();
  const compare = useCompare();
  const [allFiles, setAllFiles] = useState(false);
  const [tree, setTree] = useState<string[] | null>(null);
  const [msgH, setMsgH] = usePersistedNumber('gitstudio.commit.messageHeight', 170);
  const dragStart = useRef(0);
  // Re-render when HEAD / upstream state changes (whether the message is editable).
  useRepo((s) => s.info);
  // In-place message edit of HEAD; tied to the commit it was started on.
  const [edit, setEdit] = useState<{
    hash: string;
    summary: string;
    description: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  // "View all files": the whole tree of this commit.
  useEffect(() => {
    if (!allFiles) return;
    let alive = true;
    api
      .listFiles(repo, hash)
      .then((files) => alive && setTree(files))
      .catch(() => alive && setTree([]));
    return () => {
      alive = false;
    };
  }, [allFiles, repo, hash]);

  const d = detail && detail.hash === hash ? detail : null;

  const files = useMemo<FileChange[]>(() => {
    if (!d) return [];
    if (!allFiles || !tree) return sortFiles(d.files, sort);
    const changed = new Map(d.files.map((f) => [f.path, f]));
    const rows: FileChange[] = tree.map(
      (p) => changed.get(p) ?? { path: p, origPath: null, status: ' ' as FileStatus },
    );
    // Deleted files are not in the tree any more; keep them visible.
    for (const f of d.files) if (f.status === 'D') rows.push(f);
    return sortFiles(rows, sort);
  }, [d, allFiles, tree, sort]);

  if (!d) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-muted-foreground" />
      </div>
    );
  }

  const [, ...bodyLines] = d.body.split('\n');
  const body = bodyLines.join('\n').trim();
  const coauthors = coAuthors(d.body);
  const isActive = (f: FileChange) =>
    diff?.request.source === 'commit' &&
    diff.request.commit === d.hash &&
    diff.request.path === f.path;
  const comparing = compare.hash === d.hash;
  const isCompareActive = (f: FileChange) =>
    diff?.request.source === 'worktree' &&
    diff.request.commit === d.hash &&
    diff.request.path === f.path;

  const editable = canAmendMessage(d.hash);
  const editing = editable && edit?.hash === d.hash ? edit : null;
  const pushed = editing ? headIsPushed() : false;

  const startEdit = () => {
    if (!editable || editing) return;
    // Selecting text to copy it should not switch to editing.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;
    setEdit({ hash: d.hash, ...splitMessage(d.body) });
  };
  const cancelEdit = () => setEdit(null);
  const saveEdit = async () => {
    if (!editing || saving || !editing.summary.trim()) return;
    const message = joinMessage(editing.summary, editing.description);
    const { summary, description } = splitMessage(d.body);
    if (message === joinMessage(summary, description)) {
      setEdit(null);
      return;
    }
    setSaving(true);
    try {
      if (await amendHeadMessage(d.hash, message)) setEdit(null);
    } finally {
      setSaving(false);
    }
  };
  const onEditKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void saveEdit();
    }
  };

  const open = (f: FileChange) =>
    openDiff({
      source: 'commit',
      path: f.path,
      origPath: f.origPath,
      commit: d.hash,
      parent: d.parents[0] ?? null,
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* commit: <sha> */}
      <div className="flex h-11 shrink-0 items-center justify-center gap-1.5 border-b border-border px-3 text-[13px] text-muted-foreground">
        <span>{t('commit:')}</span>
        <code className="selectable font-mono text-foreground">{short(d.hash)}</code>
        <IconButton label={t('Copy SHA')} onClick={() => copyText(d.hash)}>
          <Copy className="size-3.5" />
        </IconButton>
      </div>

      {/* Message */}
      <div className="shrink-0 px-3 pt-3">
        {editing ? (
          <div
            className="flex flex-col rounded-md border border-accent bg-background"
            style={{ height: msgH }}
          >
            <div className="shrink-0 px-3 pt-1.5 pb-2.5">
              <MessageLabel
                right={
                  <span
                    className={cn(
                      'tabular-nums normal-case',
                      SUMMARY_MAX - editing.summary.length < 0 && 'text-danger',
                    )}
                    title={t('Characters left before the 72-character guideline')}
                  >
                    {SUMMARY_MAX - editing.summary.length}
                  </span>
                }
              >
                {t('Summary')}
              </MessageLabel>
              <input
                autoFocus
                aria-label={t('Commit summary')}
                placeholder={t('Commit summary')}
                className={cn(EDIT_FIELD, 'h-9 text-[16px] font-semibold')}
                value={editing.summary}
                disabled={saving}
                onChange={(e) => setEdit({ ...editing, summary: e.target.value })}
                onKeyDown={onEditKey}
              />
            </div>
            <div className="flex min-h-0 flex-1 flex-col border-t border-border px-3 pt-1.5 pb-2.5">
              <MessageLabel>{t('Description')}</MessageLabel>
              <textarea
                aria-label={t('Description')}
                placeholder={t('Description')}
                className={cn(
                  EDIT_FIELD,
                  'min-h-0 flex-1 resize-none py-1.5 text-[13.5px] leading-relaxed',
                )}
                value={editing.description}
                disabled={saving}
                onChange={(e) => setEdit({ ...editing, description: e.target.value })}
                onKeyDown={onEditKey}
              />
            </div>
          </div>
        ) : (
          <div
            className={cn(
              'selectable group relative flex flex-col overflow-hidden rounded-md border border-border bg-background',
              editable && 'cursor-text hover:border-accent/60',
            )}
            style={{ height: msgH }}
            title={editable ? t('Click to edit the message of this commit') : undefined}
            onClick={startEdit}
          >
            {editable && (
              <Pencil className="absolute top-2 right-2.5 size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
            )}
            <div className="max-h-[60%] shrink-0 overflow-auto px-3 pt-1.5 pb-2.5">
              <MessageLabel>{t('Summary')}</MessageLabel>
              <div className="text-[16px] leading-snug font-semibold">{d.subject}</div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto border-t border-border px-3 pt-1.5 pb-2.5">
              <MessageLabel>{t('Description')}</MessageLabel>
              {body ? (
                <pre className="font-sans text-[13.5px] leading-relaxed whitespace-pre-wrap text-foreground/85">
                  {body}
                </pre>
              ) : (
                <div className="text-[13px] text-muted-foreground italic">
                  {t('No description')}
                </div>
              )}
            </div>
          </div>
        )}
        <div
          role="separator"
          aria-orientation="horizontal"
          title={t('Drag to resize, double-click to reset')}
          onDoubleClick={() => setMsgH(170)}
          onPointerDown={(e) => {
            e.preventDefault();
            const y0 = e.clientY;
            dragStart.current = msgH;
            const move = (ev: PointerEvent) =>
              setMsgH(Math.min(600, Math.max(110, dragStart.current + ev.clientY - y0)));
            const up = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
              document.body.style.cursor = '';
            };
            document.body.style.cursor = 'row-resize';
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
          className="group flex h-3 cursor-row-resize items-center justify-center"
        >
          <span className="h-[3px] w-14 rounded-full bg-border group-hover:bg-accent" />
        </div>
        {editing && (
          <div className="pb-3">
            {pushed && (
              <div className="mb-2 flex items-start gap-1.5 rounded-md bg-warning-soft p-2 text-xs">
                <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" />
                {t(
                  'This commit is already pushed. Updating its message rewrites it; the branch will then need a force push.',
                )}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                className={cn(EDIT_BUTTON, 'border-success/60 bg-success-soft text-success')}
                disabled={!editing.summary.trim() || saving}
                onClick={() => void saveEdit()}
                title="Ctrl+Enter"
              >
                {saving && <Spinner />}
                {t('Update Message')}
              </button>
              <button
                type="button"
                className={cn(EDIT_BUTTON, 'border-danger/60 bg-danger-soft text-danger')}
                disabled={saving}
                onClick={cancelEdit}
                title="Esc"
              >
                {t('Cancel Amend')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Author, parent, co-authors */}
      <div className="shrink-0 px-3 pb-2">
        <div className="flex items-start gap-3">
          <Avatar name={d.authorName} size={40} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-medium" title={d.authorEmail}>
              {d.authorName}
            </div>
            <div className="text-[13px] text-muted-foreground">
              {t('authored {date}', { date: authoredAt(d.authorTime) })}
            </div>
            {d.committerName !== d.authorName && (
              <div className="text-[13px] text-muted-foreground">
                {t('committed by {name}', { name: d.committerName })}
              </div>
            )}
          </div>
          {d.parents.length > 0 && (
            <div className="flex shrink-0 flex-col items-end text-[13px] text-muted-foreground">
              {d.parents.map((p, i) => (
                <span key={p}>
                  {i === 0 ? (d.parents.length > 1 ? t('parents:') : t('parent:')) : ''}{' '}
                  <button
                    type="button"
                    className="font-mono text-accent hover:underline"
                    onClick={() => select({ type: 'commit', hash: p })}
                  >
                    {short(p)}
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        {coauthors.length > 0 && (
          <div className="mt-2 flex items-center gap-2 text-[13px] text-muted-foreground">
            {t('Co-authors:')}
            <span className="flex gap-1">
              {coauthors.map((c) => (
                <span key={c.email} title={`${c.name} <${c.email}>`}>
                  <Avatar name={c.name} size={22} />
                </span>
              ))}
            </span>
          </div>
        )}
      </div>

      {comparing && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-y border-border bg-accent/10 px-3 text-xs">
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

      {/* Change summary + file list tools */}
      <div className="shrink-0 border-t border-border px-3 pt-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px]">
          {SUMMARY.map((s) => {
            const n = d.files.filter((f) => s.status.includes(f.status)).length;
            return n === 0 ? null : (
              <span key={s.label} className="flex items-center gap-1.5">
                <span className={cn('font-bold', s.cls)}>{s.mark}</span>
                {t(s.label, { n })}
              </span>
            );
          })}
        </div>
        <div className="flex h-11 items-center gap-2">
          <SortButton sort={sort} onChange={setSort} />
          <div className="flex-1" />
          <ViewToggle mode={mode} onChange={setMode} />
          <label className="ml-2 flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <input
              type="checkbox"
              checked={allFiles}
              onChange={(e) => setAllFiles(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            {t('View all files')}
          </label>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pb-2">
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
        {allFiles && !tree ? (
          <div className="flex justify-center p-4">
            <Spinner className="text-muted-foreground" />
          </div>
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

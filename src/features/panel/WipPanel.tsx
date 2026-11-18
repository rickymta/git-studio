import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  GitCommitHorizontal,
  Minus,
  Plus,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Button, IconButton, Spinner, cn, type MenuItem } from '@/components/ui';
import { joinPath } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { copyText, revealPath } from '@/lib/native';
import type { FileChange } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { confirm, toast } from '@/stores/ui';
import { commitChanges, push, stashStaged } from '../actions';
import {
  EmptyFiles,
  FILES_DRAG,
  FileList,
  SortButton,
  ViewToggle,
  sortFiles,
  useFileSort,
  useViewMode,
} from './FileList';

const SUMMARY_MAX = 72;
type ListId = 'unstaged' | 'staged';

function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  return [
    v,
    (next) => {
      setV(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
  ];
}

/** Vertical drag handle; reports the pointer's Y delta from the drag start. */
function RowHandle({ onStart, onDrag }: { onStart: () => void; onDrag: (dy: number) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      onPointerDown={(e) => {
        e.preventDefault();
        onStart();
        const y0 = e.clientY;
        const move = (ev: PointerEvent) => onDrag(ev.clientY - y0);
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          document.body.style.cursor = '';
        };
        document.body.style.cursor = 'row-resize';
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
      className="group relative z-10 flex h-2 shrink-0 cursor-row-resize items-center justify-center"
    >
      <span className="h-[3px] w-12 rounded-full bg-border group-hover:bg-accent" />
    </div>
  );
}

export function WipPanel() {
  const info = useRepo((s) => s.info);
  const diff = useRepo((s) => s.diff);
  const openDiff = useRepo((s) => s.openDiff);
  const run = useRepo((s) => s.run);
  const busy = useRepo((s) => s.busy);
  const path = useRepo((s) => s.path)!;
  const [mode, setMode] = useViewMode();
  const [sort, setSort] = useFileSort();
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  /** Bottom composer: commit the staged files, or stash them (GitKraken's Stash tab). */
  const [composer, setComposer] = useState<'commit' | 'stash'>('commit');
  const [stashTitle, setStashTitle] = useState('');
  const [stashBody, setStashBody] = useState('');
  const [amend, setAmend] = useState(false);
  const [identity, setIdentity] = useState<{ name: string; email: string } | null>(null);
  const [selection, setSelection] = useState<{
    list: ListId;
    paths: Set<string>;
    anchor: string | null;
  }>({ list: 'unstaged', paths: new Set(), anchor: null });
  const [openLists, setOpenLists] = usePersisted('gitstudio.wip.open', {
    unstaged: true,
    staged: true,
  });
  // Share of the file area given to the Unstaged list (0.15 – 0.85).
  const [split, setSplit] = usePersisted('gitstudio.wip.split', 0.55);
  const [commitH, setCommitH] = usePersisted('gitstudio.wip.commitHeight', 300);
  const [optionsOpen, setOptionsOpen] = usePersisted('gitstudio.wip.options', false);
  const [pushAfter, setPushAfter] = usePersisted('gitstudio.wip.pushAfter', false);
  const [dropTarget, setDropTarget] = useState<ListId | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  // Values at the start of a handle drag.
  const dragStart = useRef({ split: 0.55, commit: 300 });

  useEffect(() => {
    api
      .identity(path)
      .then(setIdentity)
      .catch(() => setIdentity(null));
  }, [path]);

  const st = info?.status;
  const unstaged = useMemo(() => sortFiles(st?.unstaged ?? [], sort), [st?.unstaged, sort]);
  const staged = useMemo(() => sortFiles(st?.staged ?? [], sort), [st?.staged, sort]);
  const conflicted = st?.conflicted ?? [];
  if (!info || !st) return null;

  const total = new Set([...st.unstaged, ...st.staged, ...conflicted].map((f) => f.path)).size;

  // Selection only counts paths still present in its list.
  const listFiles = (l: ListId) => (l === 'unstaged' ? unstaged : staged);
  const selectedIn = (l: ListId) =>
    selection.list === l
      ? new Set(
          listFiles(l)
            .filter((f) => selection.paths.has(f.path))
            .map((f) => f.path),
        )
      : new Set<string>();

  const onSelect = (l: ListId) => (f: FileChange, e: React.MouseEvent) => {
    const files = listFiles(l);
    const same = selection.list === l;
    if (e.shiftKey && same && selection.anchor) {
      const a = files.findIndex((x) => x.path === selection.anchor);
      const b = files.findIndex((x) => x.path === f.path);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelection({
        list: l,
        paths: new Set(files.slice(lo, hi + 1).map((x) => x.path)),
        anchor: selection.anchor,
      });
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(same ? selection.paths : []);
      if (next.has(f.path)) next.delete(f.path);
      else next.add(f.path);
      setSelection({ list: l, paths: next, anchor: f.path });
    } else {
      setSelection({ list: l, paths: new Set([f.path]), anchor: f.path });
    }
  };

  const isActive = (source: ListId) => (f: FileChange) =>
    diff?.request.source === source && diff.request.path === f.path;

  const show = (source: ListId) => (f: FileChange) =>
    openDiff({ source, path: f.path, origPath: f.origPath, untracked: f.status === '?' });

  const stage = (paths: string[]) => run(t('Stage'), (p) => api.stage(p, paths));
  const unstage = (paths: string[]) => run(t('Unstage'), (p) => api.unstage(p, paths));

  const discard = async (files: FileChange[]) => {
    if (files.length === 0) return;
    const question =
      files.length === 1
        ? t('Discard changes in {path}? This cannot be undone.', { path: files[0]!.path })
        : t('Discard changes in {n} files? This cannot be undone.', { n: files.length });
    if (!(await confirm(t('Discard changes'), question, t('Discard'), true))) return;
    await run(t('Discard'), (p) =>
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
  const canCommit = !!summary.trim() && (staged.length > 0 || amend) && conflicted.length === 0;

  const commit = async () => {
    if (!(await commitChanges(message, amend))) return;
    setSummary('');
    setBody('');
    setAmend(false);
    if (pushAfter) await push();
  };

  // Whole sentences per case so translations never glue fragments together.
  const andPush = canCommit && pushAfter;
  // Ctrl+Enter commits; Ctrl+Shift+Enter stages everything first.
  const onCommitKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (e.shiftKey && summary.trim() && conflicted.length === 0) {
      void (async () => {
        if (await run('Stage', (p) => api.stage(p, []))) await commit();
      })();
    } else if (canCommit) void commit();
  };

  let commitLabel: string;
  if (conflicted.length > 0) commitLabel = t('Resolve Conflicts to Commit');
  else if (staged.length === 0 && !amend) commitLabel = t('Stage Changes to Commit');
  else if (!summary.trim()) commitLabel = t('Type a Message to Commit');
  else if (amend)
    commitLabel = andPush ? t('Amend Previous Commit and Push') : t('Amend Previous Commit');
  else if (staged.length === 1)
    commitLabel = andPush ? t('Commit Changes to 1 File and Push') : t('Commit Changes to 1 File');
  else
    commitLabel = andPush
      ? t('Commit Changes to {n} Files and Push', { n: staged.length })
      : t('Commit Changes to {n} Files', { n: staged.length });

  const fileMenu =
    (l: ListId) =>
    (f: FileChange): MenuItem[] => {
      const sel = selectedIn(l);
      const many = sel.has(f.path) && sel.size > 1;
      const targets = many ? listFiles(l).filter((x) => sel.has(x.path)) : [f];
      const n = targets.length;
      return [
        l === 'unstaged'
          ? {
              label: many ? t('Stage {n} files', { n }) : t('Stage file'),
              onSelect: () => stage(targets.map((x) => x.path)),
            }
          : {
              label: many ? t('Unstage {n} files', { n }) : t('Unstage file'),
              onSelect: () => unstage(targets.map((x) => x.path)),
            },
        ...(l === 'unstaged'
          ? [
              {
                label: many ? t('Discard changes {n} files', { n }) : t('Discard changes'),
                danger: true,
                onSelect: () => discard(targets),
              },
            ]
          : []),
        'sep' as const,
        {
          label: t('Open in editor'),
          onSelect: () =>
            api
              .openEditor(joinPath(path, f.path))
              .catch((e) => toast('error', t('Could not open editor'), (e as Error).message)),
        },
        { label: t('Open with default app'), onSelect: () => revealPath(joinPath(path, f.path)) },
        { label: t('Copy file path'), onSelect: () => copyText(f.path) },
      ];
    };

  // ---- drag & drop between lists ----
  const dropProps = (target: ListId) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(FILES_DRAG)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dropTarget !== target) setDropTarget(target);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropTarget(null);
    },
    onDrop: (e: React.DragEvent) => {
      setDropTarget(null);
      const raw = e.dataTransfer.getData(FILES_DRAG);
      if (!raw) return;
      e.preventDefault();
      const { from, paths } = JSON.parse(raw) as { from: ListId; paths: string[] };
      if (from === target) return;
      void (target === 'staged' ? stage(paths) : unstage(paths));
    },
  });

  // "{n} file changes on <branch>": the branch name is a styled chip inside the sentence.
  const headerParts = (
    total === 1
      ? t('{n} file change on {branch}', { n: total })
      : t('{n} file changes on {branch}', { n: total })
  ).split('{branch}');

  const unstagedSel = selectedIn('unstaged');
  const stagedSel = selectedIn('staged');
  const bothOpen = openLists.unstaged && openLists.staged;

  const unstagedPane = (
    <Pane
      title={t('Unstaged Files')}
      count={unstaged.length + conflicted.length}
      open={openLists.unstaged}
      onToggle={() => setOpenLists({ ...openLists, unstaged: !openLists.unstaged })}
      drop={dropTarget === 'unstaged'}
      dropProps={dropProps('unstaged')}
      style={
        bothOpen ? { flexBasis: `${split * 100}%` } : openLists.unstaged ? { flex: 1 } : undefined
      }
      action={
        unstagedSel.size > 1 ? (
          <PillButton tone="success" onClick={() => stage([...unstagedSel])}>
            {t('Stage {n} Files', { n: unstagedSel.size })}
          </PillButton>
        ) : unstaged.length > 0 ? (
          <PillButton tone="success" onClick={() => stage([])}>
            {t('Stage All Changes')}
          </PillButton>
        ) : null
      }
    >
      {conflicted.length > 0 && (
        <>
          <div className="px-3 pt-1 pb-0.5 text-xs font-medium text-danger">{t('Conflicts')}</div>
          <FileList
            files={conflicted}
            mode={mode}
            isActive={isActive('unstaged')}
            onOpen={(f) => openDiff({ source: 'unstaged', path: f.path })}
            menu={(f) => [
              {
                label: t('Take ours (current branch)'),
                onSelect: () => run(t('Resolve'), (p) => api.resolve(p, [f.path], 'ours')),
              },
              {
                label: t('Take theirs (incoming)'),
                onSelect: () => run(t('Resolve'), (p) => api.resolve(p, [f.path], 'theirs')),
              },
              { label: t('Mark as resolved'), onSelect: () => stage([f.path]) },
            ]}
            actions={(f) => (
              <PillButton tone="success" small onClick={() => stage([f.path])}>
                <Check className="size-3" /> {t('Mark Resolved')}
              </PillButton>
            )}
          />
        </>
      )}
      {unstaged.length === 0 && conflicted.length === 0 ? (
        <EmptyFiles text={t('No unstaged changes')} />
      ) : (
        <FileList
          files={unstaged}
          mode={mode}
          isActive={isActive('unstaged')}
          onOpen={show('unstaged')}
          selected={unstagedSel}
          onSelect={onSelect('unstaged')}
          dragSource="unstaged"
          menu={fileMenu('unstaged')}
          actions={(f) => (
            <>
              <IconButton
                label={t('Discard changes')}
                onClick={(e) => {
                  e.stopPropagation();
                  void discard([f]);
                }}
              >
                <Undo2 className="size-3.5" />
              </IconButton>
              <PillButton
                tone="success"
                small
                onClick={() =>
                  stage(
                    unstagedSel.has(f.path) && unstagedSel.size > 1 ? [...unstagedSel] : [f.path],
                  )
                }
              >
                <Plus className="size-3" /> {t('Stage File')}
              </PillButton>
            </>
          )}
        />
      )}
    </Pane>
  );

  const stagedPane = (
    <Pane
      title={t('Staged Files')}
      count={staged.length}
      open={openLists.staged}
      onToggle={() => setOpenLists({ ...openLists, staged: !openLists.staged })}
      drop={dropTarget === 'staged'}
      dropProps={dropProps('staged')}
      style={
        bothOpen
          ? { flexBasis: `${(1 - split) * 100}%` }
          : openLists.staged
            ? { flex: 1 }
            : undefined
      }
      action={
        stagedSel.size > 1 ? (
          <PillButton tone="danger" onClick={() => unstage([...stagedSel])}>
            {t('Unstage {n} Files', { n: stagedSel.size })}
          </PillButton>
        ) : staged.length > 0 ? (
          <PillButton tone="danger" onClick={() => unstage([])}>
            {t('Unstage All Changes')}
          </PillButton>
        ) : null
      }
    >
      {staged.length === 0 ? (
        <EmptyFiles text={t('Drag files here or use Stage to include them in the commit')} />
      ) : (
        <FileList
          files={staged}
          mode={mode}
          isActive={isActive('staged')}
          onOpen={show('staged')}
          selected={stagedSel}
          onSelect={onSelect('staged')}
          dragSource="staged"
          menu={fileMenu('staged')}
          actions={(f) => (
            <PillButton
              tone="danger"
              small
              onClick={() =>
                unstage(stagedSel.has(f.path) && stagedSel.size > 1 ? [...stagedSel] : [f.path])
              }
            >
              <Minus className="size-3" /> {t('Unstage File')}
            </PillButton>
          )}
        />
      )}
    </Pane>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <IconButton
          label={t('Discard all changes')}
          disabled={st.unstaged.length === 0}
          onClick={() => discard(st.unstaged)}
          className="border border-danger/50"
        >
          <Trash2 className="size-3.5 text-danger" />
        </IconButton>
        <span className="min-w-0 flex-1 truncate text-center">
          {headerParts[0]}
          <span className="rounded bg-accent-soft px-1.5 py-0.5 font-medium text-accent">
            {st.branch ?? t('detached HEAD')}
          </span>
          {headerParts[1]}
        </span>
      </div>
      <div className="flex h-10 shrink-0 items-center gap-2 px-2">
        <SortButton sort={sort} onChange={setSort} />
        <div className="flex-1" />
        <ViewToggle mode={mode} onChange={setMode} />
      </div>

      {/* File lists */}
      <div ref={areaRef} className="flex min-h-0 flex-1 flex-col">
        {unstagedPane}
        {bothOpen && (
          <RowHandle
            onStart={() => (dragStart.current.split = split)}
            onDrag={(dy) => {
              const h = areaRef.current?.clientHeight ?? 400;
              setSplit(Math.min(0.85, Math.max(0.15, dragStart.current.split + dy / h)));
            }}
          />
        )}
        {stagedPane}
      </div>

      {/* Commit */}
      <RowHandle
        onStart={() => (dragStart.current.commit = commitH)}
        onDrag={(dy) => setCommitH(Math.min(560, Math.max(190, dragStart.current.commit - dy)))}
      />
      <div
        className="flex shrink-0 flex-col border-t border-border px-3 pt-2 pb-3"
        style={{ height: commitH }}
      >
        <div className="mb-2 flex items-center gap-1 border-b border-border">
          {(
            [
              ['commit', t('Commit'), <GitCommitHorizontal key="c" className="size-4" />],
              ['stash', t('Stash'), <Archive key="s" className="size-4" />],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setComposer(id)}
              className={cn(
                'flex items-center gap-1.5 border-b-2 px-2 pb-1.5',
                composer === id
                  ? 'border-accent font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {icon} {label}
            </button>
          ))}
        </div>
        {composer === 'stash' ? (
          <>
            <div className="flex min-h-0 flex-1 flex-col rounded-md bg-background">
              <input
                className="h-10 min-w-0 bg-transparent px-3 text-[16px] font-semibold outline-none placeholder:text-muted-foreground"
                placeholder={t('Stash title')}
                value={stashTitle}
                onChange={(e) => setStashTitle(e.target.value)}
              />
              <textarea
                className="min-h-0 w-full flex-1 resize-none bg-transparent px-3 py-1 outline-none placeholder:text-muted-foreground"
                placeholder={t('Description')}
                value={stashBody}
                onChange={(e) => setStashBody(e.target.value)}
              />
            </div>
            <Button
              variant={staged.length ? 'primary' : 'ghost'}
              className={cn(
                'mt-2 h-9 w-full shrink-0',
                !staged.length && 'border border-success/40 bg-success-soft/60 text-success/80',
              )}
              disabled={!staged.length || !!busy}
              onClick={async () => {
                const ok = await stashStaged(stashTitle, stashBody);
                if (ok) {
                  setStashTitle('');
                  setStashBody('');
                }
              }}
            >
              <Archive className="size-4" />
              {staged.length
                ? staged.length === 1
                  ? t('Stash 1 Staged File')
                  : t('Stash {n} Staged Files', { n: staged.length })
                : t('Stage Changes to Stash')}
            </Button>
          </>
        ) : (
          <>
            {identity && (!identity.name || !identity.email) && (
              <div className="mb-2 rounded-md bg-warning-soft p-2 text-xs">
                {t(
                  'Git user name/email is not set. Set it in Preferences → Profile before committing.',
                )}
              </div>
            )}
            <label className="mb-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={amend}
                onChange={(e) => toggleAmend(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              {t('Amend previous commit')}
            </label>
            <div className="flex min-h-0 flex-1 flex-col rounded-md bg-background">
              <div className="flex items-center">
                <input
                  className="h-10 min-w-0 flex-1 bg-transparent px-3 text-[16px] font-semibold outline-none placeholder:text-muted-foreground"
                  id="commit-summary"
                  placeholder={t('Commit summary')}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  onKeyDown={(e) => {
                    onCommitKey(e);
                  }}
                />
                <span
                  className={cn(
                    'pr-3 text-xs tabular-nums',
                    SUMMARY_MAX - summary.length < 0 ? 'text-danger' : 'text-muted-foreground',
                  )}
                  title={t('Characters left before the 72-character guideline')}
                >
                  {SUMMARY_MAX - summary.length}
                </span>
              </div>
              <textarea
                className="min-h-0 w-full flex-1 resize-none bg-transparent px-3 py-1 outline-none placeholder:text-muted-foreground"
                placeholder={t('Description')}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  onCommitKey(e);
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => setOptionsOpen(!optionsOpen)}
              className="mt-2 flex items-center gap-1 self-start text-muted-foreground hover:text-foreground"
            >
              {optionsOpen ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              {t('Commit options')}
              {!optionsOpen && pushAfter && (
                <span className="ml-1 text-xs text-accent">{t('· push after committing')}</span>
              )}
            </button>
            {optionsOpen && (
              <label className="mt-1.5 ml-1 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={pushAfter}
                  onChange={(e) => setPushAfter(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                {t('Push after committing')}
                {!st.upstream && pushAfter && (
                  <span className="text-xs text-muted-foreground">
                    {t('(sets the upstream on first push)')}
                  </span>
                )}
              </label>
            )}
            <Button
              variant={canCommit ? 'primary' : 'ghost'}
              className={cn(
                'mt-2 h-9 w-full shrink-0',
                !canCommit && 'border border-success/40 bg-success-soft/60 text-success/80',
              )}
              disabled={!canCommit || !!busy}
              onClick={commit}
              title="Ctrl+Enter"
            >
              {busy === 'Commit' ||
              busy === 'Push' ||
              busy === t('Commit') ||
              busy === t('Push') ? (
                <Spinner />
              ) : (
                <GitCommitHorizontal className="size-4" />
              )}
              {commitLabel}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function Pane({
  title,
  count,
  open,
  onToggle,
  action,
  drop,
  dropProps,
  style,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  action: ReactNode;
  drop: boolean;
  dropProps: React.HTMLAttributes<HTMLDivElement>;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      {...dropProps}
      className={cn(
        'flex min-h-0 flex-col transition-colors',
        open ? 'shrink grow' : 'shrink-0',
        drop && 'bg-accent-soft outline-2 -outline-offset-2 outline-accent outline-dashed',
      )}
      style={open ? { minHeight: 72, ...style } : undefined}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 pr-2 pl-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1 text-[14px] font-medium"
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <span className="truncate">
            {title} ({count})
          </span>
        </button>
        {action}
      </div>
      {open && <div className="min-h-0 flex-1 overflow-auto py-0.5">{children}</div>}
    </div>
  );
}

function PillButton({
  tone,
  small,
  onClick,
  children,
}: {
  tone: 'success' | 'danger';
  small?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex shrink-0 items-center gap-1 rounded border font-medium whitespace-nowrap hover:brightness-125',
        small ? 'h-5 px-1.5 text-[11px]' : 'h-6 px-2 text-xs',
        tone === 'success'
          ? 'border-success/60 bg-success-soft text-success'
          : 'border-danger/60 bg-danger-soft text-danger',
      )}
    >
      {children}
    </button>
  );
}

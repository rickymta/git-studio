import { AlertTriangle, Check, GitMerge, Rows3, Columns2, AlignJustify, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Select } from '@/components/controls';
import { Button, IconButton, Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import { parseConflicts } from '@/lib/diff';
import { short } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type {
  FileChange,
  MergePreview as Preview,
  PreviewConflict,
  PreviewFile,
  TextFormat,
} from '@/lib/types';
import { useMergePreview, type MergePreviewSpec } from '@/stores/mergePreview';
import { useRepo } from '@/stores/repo';
import { confirm, toast } from '@/stores/ui';
import * as A from '../actions';
import { DiffBody } from '../diff/DiffBody';
import { MergeTool } from '../diff/MergeTool';
import type { DiffLayout } from '../diff/rows';

type Mode = 'merge' | 'noFf' | 'squash';

interface Resolution {
  text: string;
  format: TextFormat;
}

/** The merge preview, shown over the app while a merge is being prepared. */
export function MergePreviewHost() {
  const spec = useMergePreview((s) => s.spec);
  if (!spec) return null;
  return <MergePreview spec={spec} key={spec.theirs} />;
}

/**
 * Merge preview: what merging `spec.theirs` into the checked-out branch changes, worked out
 * with `git merge-tree` (nothing on disk changes). Conflicts can be resolved here with the merge
 * tool before merging; the merge then applies those resolutions and commits when none is left.
 */
function MergePreview({ spec }: { spec: MergePreviewSpec }) {
  const repo = useRepo((s) => s.path)!;
  const branch = useRepo((s) => s.info?.status.branch ?? 'HEAD');
  const close = useMergePreview((s) => s.close);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** A file the merge changes without conflict, shown as the diff the merge applies to it. */
  const [change, setChange] = useState<FileChange | null>(null);
  const [files, setFiles] = useState<Record<string, PreviewFile | 'loading'>>({});
  const [resolved, setResolved] = useState<Record<string, Resolution>>({});
  const [mode, setMode] = useState<Mode>('merge');
  const [merging, setMerging] = useState(false);

  /** Paths whose versions were asked for (loaded once). */
  const requested = useRef(new Set<string>());
  /** Show a conflict, loading its versions the first time. */
  const open = (c: PreviewConflict | null | undefined) => {
    setSelected(c?.path ?? null);
    if (c) setChange(null);
    if (!c || requested.current.has(c.path)) return;
    requested.current.add(c.path);
    setFiles((all) => ({ ...all, [c.path]: 'loading' }));
    api
      .mergePreviewFile(repo, c, branch, spec.label)
      .then((f) => setFiles((cur) => ({ ...cur, [c.path]: f })))
      .catch((e) => {
        toast('error', t('Could not read {path}', { path: c.path }), (e as Error).message);
        setFiles((cur) => ({ ...cur, [c.path]: { merged: null, format: null } }));
      });
  };

  useEffect(() => {
    let alive = true;
    api
      .mergePreview(repo, spec.theirs)
      .then((p) => {
        if (!alive) return;
        setPreview(p);
        // Start on the first conflict; without any, on the first file the merge changes.
        if (p.conflicts.length) open(p.conflicts[0]);
        else setChange(p.files[0] ?? null);
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
    // `open` only uses state setters and these same values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, spec.theirs]);

  const conflict = preview?.conflicts.find((c) => c.path === selected) ?? null;

  const textConflicts = useMemo(
    () => (preview?.conflicts ?? []).filter((c) => c.kind === 'contents' || c.kind === 'add/add'),
    [preview],
  );
  const left = (preview?.conflicts ?? []).filter((c) => !resolved[c.path]);
  const changed = (preview?.files ?? []).filter(
    (f) => !preview?.conflicts.some((c) => c.path === f.path),
  );

  const saveResolution = async (c: PreviewConflict, text: string, unresolved: number) => {
    const f = files[c.path];
    if (!f || f === 'loading' || !f.format) return;
    if (
      unresolved > 0 &&
      !(await confirm(
        t('Some conflicts have no choice'),
        t('{n} conflict(s) have nothing picked; their base version will be saved.', {
          n: unresolved,
        }),
        t('Save anyway'),
      ))
    )
      return;
    const next = { ...resolved, [c.path]: { text, format: f.format } };
    setResolved(next);
    // On to the next conflict nobody resolved yet.
    open(preview?.conflicts.find((x) => !next[x.path]));
  };

  const doMerge = async () => {
    if (!preview) return;
    if (preview.conflicts.length === 0) {
      // Clean: the usual merge (undoable).
      setMerging(true);
      const ok = await A.mergeClean(spec.theirs, mode);
      if (ok && spec.after && mode !== 'squash') await spec.after();
      setMerging(false);
      if (ok) close();
      return;
    }
    const open = preview.conflicts.filter((c) => !resolved[c.path]);
    if (
      open.length > 0 &&
      !(await confirm(
        t('Merge with conflicts left?'),
        t(
          '{n} file(s) are not resolved yet. The merge will stop with them conflicted, to finish in the changes panel.',
          { n: open.length },
        ),
        t('Merge'),
      ))
    )
      return;
    setMerging(true);
    const run = useRepo.getState().run;
    const theirs = preview.theirs;
    const ok = await run(t('Merge'), async (p) => {
      try {
        if (mode === 'squash') await api.mergeSquash(p, theirs);
        else await api.merge(p, theirs, mode === 'noFf');
      } catch (e) {
        // Conflicts were expected: the resolutions go in below. Anything else is a real failure.
        if (preview.conflicts.length === 0) throw e;
        const info = await api.info(p);
        if (info.status.conflicted.length === 0) throw e;
      }
      for (const [path, r] of Object.entries(resolved)) {
        await api.writeFile(p, path, r.text, r.format);
        await api.stage(p, [path]);
      }
    });
    if (!ok) {
      setMerging(false);
      return;
    }
    const info = useRepo.getState().info;
    const stillConflicted = info?.status.conflicted.length ?? 0;
    if (stillConflicted > 0) {
      setMerging(false);
      close();
      toast(
        'warning',
        t('{n} file(s) still conflicted', { n: stillConflicted }),
        t('Resolve them in the changes panel, then continue the merge.'),
      );
      void useRepo.getState().select({ type: 'wip' });
      return;
    }
    // Every conflict resolved here: finish the merge commit.
    if (info?.state === 'merging') {
      const done = await run(t('Commit merge'), (p) => api.continueOp(p));
      if (!done) {
        setMerging(false);
        return;
      }
    }
    if (mode === 'squash') {
      toast(
        'success',
        t('Changes of {name} are staged: commit them to finish the squash merge', {
          name: spec.label,
        }),
      );
      void useRepo.getState().select({ type: 'wip' });
    } else {
      toast('success', t('Merged {name}', { name: spec.label }));
    }
    if (spec.after && mode !== 'squash') await spec.after();
    setMerging(false);
    close();
  };

  const summary = !preview
    ? ''
    : preview.upToDate
      ? t('Already up to date: nothing to merge.')
      : preview.fastForward
        ? t('Fast-forward: {branch} moves to {name} without a merge commit.', {
            branch,
            name: spec.label,
          })
        : t('{files} file(s) change · {conflicts} conflict(s)', {
            files: preview.files.length,
            conflicts: preview.conflicts.length,
          });

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
        <GitMerge className="size-4 text-accent" />
        <span className="min-w-0 truncate font-semibold">
          {t('Merge preview: {name} into {branch}', { name: spec.label, branch })}
        </span>
        <span
          className={cn(
            'shrink-0 text-muted-foreground',
            preview && preview.conflicts.length > 0 && 'text-warning',
          )}
        >
          {summary}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Select
            value={mode}
            onChange={(v) => setMode(v as Mode)}
            className="h-7 w-72 text-xs"
            disabled={!preview || preview.upToDate}
            options={[
              { value: 'merge', label: t('Fast-forward if possible, else a merge commit') },
              { value: 'noFf', label: t('Always create a merge commit (--no-ff)') },
              { value: 'squash', label: t('Squash: stage all changes, commit them yourself') },
            ]}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={!preview || preview.upToDate || merging}
            onClick={() => void doMerge()}
            title={
              preview && preview.conflicts.length > 0
                ? t('{n} of {total} conflicts resolved', {
                    n: preview.conflicts.length - left.length,
                    total: preview.conflicts.length,
                  })
                : undefined
            }
          >
            {merging ? <Spinner /> : <GitMerge className="size-3.5" />}{' '}
            {spec.actionLabel ?? t('Merge')}
          </Button>
          <IconButton label={t('Close')} onClick={close}>
            <X className="size-4" />
          </IconButton>
        </div>
      </div>

      {error ? (
        <div className="p-6 text-danger">{error}</div>
      ) : !preview ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="text-muted-foreground" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Files: conflicts first, then the other changes. */}
          <div className="flex w-72 shrink-0 flex-col overflow-auto border-r border-border bg-surface">
            <div className="px-3 pt-3 pb-1 text-xs text-muted-foreground">
              {short(preview.ours)} ← {short(preview.theirs)}
            </div>
            {preview.conflicts.length > 0 && (
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {t('Conflicts')} ({preview.conflicts.length - left.length}/
                {preview.conflicts.length})
              </div>
            )}
            {preview.conflicts.map((c) => (
              <button
                key={c.path}
                type="button"
                onClick={() => open(c)}
                className={cn(
                  'flex items-center gap-2 px-3 py-1 text-left hover:bg-surface-hover',
                  selected === c.path && 'bg-selection/45',
                )}
              >
                {resolved[c.path] ? (
                  <Check className="size-3.5 shrink-0 text-success" />
                ) : (
                  <AlertTriangle className="size-3.5 shrink-0 text-warning" />
                )}
                <span className="min-w-0 flex-1 truncate">{c.path}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{c.kind}</span>
              </button>
            ))}
            {changed.length > 0 && (
              <div className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {t('Changes')} ({changed.length})
              </div>
            )}
            {changed.map((f) => (
              <button
                key={f.path}
                type="button"
                title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
                onClick={() => {
                  setSelected(null);
                  setChange(f);
                }}
                className={cn(
                  'flex items-center gap-2 px-3 py-0.5 text-left hover:bg-surface-hover',
                  change?.path === f.path && 'bg-selection/45',
                )}
              >
                <span className="w-3 shrink-0 font-mono text-xs text-muted-foreground">
                  {f.status}
                </span>
                <span className="min-w-0 flex-1 truncate">{f.path}</span>
              </button>
            ))}
            {preview.messages.length > 0 && (
              <details className="mt-auto border-t border-border px-3 py-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer">{t('Git notes')}</summary>
                {preview.messages.map((m, i) => (
                  <div key={i} className="mt-1 break-words">
                    {m}
                  </div>
                ))}
              </details>
            )}
          </div>

          <div className="min-h-0 min-w-0 flex-1">
            {change && preview.tree && !conflict ? (
              <ChangePane
                key={change.path}
                file={change}
                ours={preview.ours}
                tree={preview.tree}
                branch={branch}
                incoming={spec.label}
              />
            ) : (
              <ConflictPane
                conflict={conflict}
                file={conflict ? files[conflict.path] : undefined}
                textConflict={!!conflict && textConflicts.includes(conflict)}
                ours={{ label: branch, commit: preview.ours }}
                theirs={{ label: spec.label, commit: preview.theirs }}
                onSave={(text, unresolved) =>
                  conflict && void saveResolution(conflict, text, unresolved)
                }
                onClose={() => setSelected(null)}
                empty={
                  preview.conflicts.length === 0
                    ? preview.upToDate
                      ? t('Already up to date: nothing to merge.')
                      : t('No conflicts: this merge goes through cleanly.')
                    : left.length === 0
                      ? t('Every conflict is resolved. Merge to apply them.')
                      : t('Pick a conflicted file on the left to resolve it.')
                }
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const LAYOUT_KEY = 'gitstudio.diff.layout';
const readLayout = (): DiffLayout => {
  try {
    const v = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '"hunk"') as DiffLayout;
    return v === 'inline' || v === 'split' ? v : 'hunk';
  } catch {
    return 'hunk';
  }
};

/**
 * A file the merge changes cleanly: the diff from the current branch to the merge result, i.e.
 * the places the merge will change once it is done. Same layouts as the diff view.
 */
function ChangePane({
  file,
  ours,
  tree,
  branch,
  incoming,
}: {
  file: FileChange;
  ours: string;
  tree: string;
  branch: string;
  incoming: string;
}) {
  const [layout, setLayoutState] = useState<DiffLayout>(readLayout);
  const setLayout = (l: DiffLayout) => {
    setLayoutState(l);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(l));
    } catch {
      /* ignore */
    }
  };
  const request = useMemo(
    () => ({
      source: 'commit' as const,
      commit: tree,
      parent: ours,
      path: file.path,
      origPath: file.origPath ?? null,
    }),
    [tree, ours, file.path, file.origPath],
  );
  const layouts: { value: DiffLayout; label: string; icon: React.ReactNode }[] = [
    { value: 'hunk', label: t('Hunks'), icon: <Rows3 className="size-3.5" /> },
    { value: 'inline', label: t('Whole file'), icon: <AlignJustify className="size-3.5" /> },
    { value: 'split', label: t('Split'), icon: <Columns2 className="size-3.5" /> },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 truncate font-medium" title={file.path}>
          {file.path}
        </span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {t('What changes on {branch} once {incoming} is merged', { branch, incoming })}
        </span>
        <div className="ml-auto flex shrink-0 overflow-hidden rounded-md border border-border">
          {layouts.map((l) => (
            <button
              key={l.value}
              type="button"
              title={l.label}
              aria-label={l.label}
              onClick={() => setLayout(l.value)}
              className={cn(
                'flex h-6 items-center px-2',
                layout === l.value
                  ? 'bg-accent-soft text-foreground'
                  : 'text-muted-foreground hover:bg-surface-hover',
              )}
            >
              {l.icon}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <DiffBody
          request={request}
          layout={layout}
          ignoreWhitespace={false}
          wrap={false}
          actions="none"
        />
      </div>
    </div>
  );
}

function ConflictPane({
  conflict,
  file,
  textConflict,
  ours,
  theirs,
  onSave,
  onClose,
  empty,
}: {
  conflict: PreviewConflict | null;
  file: PreviewFile | 'loading' | undefined;
  textConflict: boolean;
  ours: { label: string; commit: string };
  theirs: { label: string; commit: string };
  onSave: (text: string, unresolved: number) => void;
  onClose: () => void;
  empty: string;
}) {
  const parts = useMemo(
    () => (file && file !== 'loading' && file.merged ? parseConflicts(file.merged) : []),
    [file],
  );
  if (!conflict) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-center text-muted-foreground">
        {empty}
      </div>
    );
  }
  if (!file || file === 'loading') {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-muted-foreground" />
      </div>
    );
  }
  if (!textConflict || !file.merged || !parts.some((p) => p.type === 'conflict')) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-center text-muted-foreground">
        {t('{path}: {kind} conflict. Choose a whole side after merging, in the changes panel.', {
          path: conflict.path,
          kind: conflict.kind,
        })}
      </div>
    );
  }
  return (
    <MergeTool
      key={conflict.path}
      path={conflict.path}
      parts={parts}
      ours={ours}
      theirs={theirs}
      wrap={false}
      saving={false}
      saveLabel={t('Save resolution')}
      onSave={onSave}
      onClose={onClose}
    />
  );
}

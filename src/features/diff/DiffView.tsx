import {
  ArrowDown,
  ArrowUp,
  Check,
  Columns2,
  History,
  ListCollapse,
  Minus,
  Pencil,
  Pilcrow,
  Plus,
  ScanText,
  TextAlignJustify,
  TextWrap,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button, Dropdown, IconButton, Spinner, type MenuItem } from '@/components/ui';
import { cn } from '@/lib/cn';
import { parseDiff } from '@/lib/diff';
import { short } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { Blame, DecodedText, TextFormat } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { confirm, toast } from '@/stores/ui';
import { StatusMark } from '../panel/FileList';
import { CodeView, type BlameInfo } from './CodeView';
import { ConflictView } from './ConflictView';
import { DiffBody, type DiffLayout, type DiffNav, type HunkActions } from './DiffBody';
import { FileHistory } from './FileHistory';
import { imageMime } from './image';
import { ImageDiff } from './ImageDiff';

import { Checkbox, Select } from '@/components/controls';

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

const segBtn = (on: boolean) =>
  cn(
    'flex h-6 items-center gap-1 px-2 text-xs',
    on ? 'bg-accent-soft text-foreground' : 'text-muted-foreground hover:bg-surface-hover',
  );

export function DiffView() {
  const diff = useRepo((s) => s.diff)!;
  const close = useRepo((s) => s.closeDiff);
  const run = useRepo((s) => s.run);
  const select = useRepo((s) => s.select);
  const repo = useRepo((s) => s.path)!;
  const info = useRepo((s) => s.info);
  const req = diff.request;

  const [layout, setLayout] = usePersisted<DiffLayout>('gitstudio.diff.layout', 'hunk');
  const [ignoreWs, setIgnoreWs] = usePersisted('gitstudio.diff.ignoreWs', false);
  const [wrap, setWrap] = usePersisted('gitstudio.diff.wrap', false);
  const [view, setView] = useState<'diff' | 'file'>('diff');
  const [tool, setTool] = useState<'blame' | 'history' | null>(null);
  const [editing, setEditing] = useState(false);
  const [encOverride, setEncOverride] = useState<string | undefined>(undefined);
  const [file, setFile] = useState<DecodedText | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saveFormat, setSaveFormat] = useState<TextFormat | null>(null);
  const [blame, setBlame] = useState<Blame | null>(null);
  const [marks, setMarks] = useState<Map<number, 'add' | 'mod'> | undefined>(undefined);
  const [encodings, setEncodings] = useState<string[]>([]);
  const [nav, setNav] = useState({ current: -1, total: 0 });
  const navRef = useRef<DiffNav>(null);

  const conflicted =
    req.source === 'unstaged' && !!info?.status.conflicted.some((f) => f.path === req.path);
  const status =
    info?.status.unstaged.find((f) => f.path === req.path)?.status ??
    info?.status.staged.find((f) => f.path === req.path)?.status ??
    (conflicted ? 'U' : 'M');
  const deletedHere = status === 'D';
  // Raster images get a picture diff; SVG keeps its (more useful) text diff.
  const image = ![null, 'image/svg+xml'].includes(imageMime(req.path));
  // Version shown in File View / Blame / used to detect the encoding.
  const rev = req.source === 'commit' ? req.commit : undefined;
  const canEdit =
    (req.source === 'unstaged' || req.source === 'staged' || req.source === 'worktree') &&
    !deletedHere &&
    !conflicted;

  useEffect(() => {
    api
      .encodings()
      .then(setEncodings)
      .catch(() => {});
  }, []);

  // The file text (also gives the encoding the diff is decoded with).
  useEffect(() => {
    let alive = true;
    api
      .readFile(repo, req.path, rev, encOverride)
      .then((f) => {
        if (!alive) return;
        setFile(f);
        setFileError(null);
      })
      .catch((e) => {
        if (!alive) return;
        setFile(null);
        setFileError((e as Error).message);
      });
    return () => {
      alive = false;
    };
  }, [repo, req.path, rev, encOverride, diff.text]);

  const encoding = encOverride ?? (file && !file.binary ? file.format.encoding : undefined);

  // Blame for the shown version.
  useEffect(() => {
    if (tool !== 'blame' || !file) return;
    let alive = true;
    api
      .blame(repo, req.path, rev)
      .then((b) => alive && setBlame(b))
      .catch((e) => toast('error', t('Could not load blame'), (e as Error).message));
    return () => {
      alive = false;
    };
  }, [tool, repo, req.path, rev, file]);

  // Changed lines tinted in File View.
  useEffect(() => {
    if (view !== 'file' && tool !== 'blame') return;
    let alive = true;
    api
      .diff(repo, { ...req, encoding })
      .then((text) => {
        if (!alive) return;
        const m = new Map<number, 'add' | 'mod'>();
        for (const h of parseDiff(text).hunks) {
          const hasDel = h.lines.some((l) => l.kind === 'del');
          for (const l of h.lines)
            if (l.kind === 'add' && l.newNo) m.set(l.newNo, hasDel ? 'mod' : 'add');
        }
        setMarks(m);
      })
      .catch(() => alive && setMarks(undefined));
    return () => {
      alive = false;
    };
  }, [view, tool, repo, req, encoding]);

  const blameInfo = useMemo<BlameInfo | null>(
    () =>
      tool === 'blame' && blame
        ? {
            lines: blame.lines,
            commits: new Map(blame.commits.map((c) => [c.hash, c])),
            onPick: (hash) => void select({ type: 'commit', hash }),
          }
        : null,
    [tool, blame, select],
  );

  const actions: HunkActions =
    req.source === 'unstaged'
      ? req.untracked
        ? 'none'
        : 'unstaged'
      : req.source === 'staged'
        ? 'staged'
        : req.source === 'commit'
          ? 'commit'
          : 'none';

  const dirty = editing && file !== null && draft !== file.text;

  const startEdit = () => {
    if (!file || file.binary) return;
    if (file.size > 8 * 1024 * 1024) {
      toast('info', t('This file is too large to edit here.'));
      return;
    }
    setDraft(file.text);
    setSaveFormat(file.format);
    setEditing(true);
  };

  const stopEdit = async () => {
    if (
      dirty &&
      !(await confirm(
        t('Discard edits'),
        t('Close the editor without saving your changes?'),
        t('Discard'),
        true,
      ))
    )
      return;
    setEditing(false);
  };

  const save = async () => {
    if (!saveFormat) return;
    const ok = await run('Save file', (p) => api.writeFile(p, req.path, draft, saveFormat));
    if (ok) {
      toast('success', t('Saved {path}', { path: req.path }));
      setEditing(false);
      setEncOverride(saveFormat.encoding);
    }
  };

  const onClose = async () => {
    if (
      dirty &&
      !(await confirm(
        t('Discard edits'),
        t('Close the editor without saving your changes?'),
        t('Discard'),
        true,
      ))
    )
      return;
    close();
  };

  const sourceLabel =
    req.source === 'unstaged'
      ? t('Unstaged')
      : req.source === 'staged'
        ? t('Staged')
        : req.source === 'worktree'
          ? t('{sha} ↔ working directory', { sha: short(req.commit ?? '') })
          : short(req.commit ?? '');

  const encodingMenu: MenuItem[] = [
    ...(encodings.length ? encodings : ['UTF-8']).map((e) => ({
      label: e,
      icon: (encoding ?? 'UTF-8').toLowerCase() === e.toLowerCase() ? '✓' : undefined,
      onSelect: () => setEncOverride(e),
    })),
  ];

  const slash = req.path.lastIndexOf('/');

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Title row */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <StatusMark status={status} />
        <span className="min-w-0 flex-1 truncate" title={req.path}>
          {req.origPath && req.origPath !== req.path && (
            <span className="text-muted-foreground">{req.origPath} → </span>
          )}
          {slash >= 0 && (
            <span className="text-muted-foreground">{req.path.slice(0, slash + 1)}</span>
          )}
          <span className="font-medium">{req.path.slice(slash + 1)}</span>
        </span>
        {diff.loading && <Spinner className="text-muted-foreground" />}
        {file && !file.binary && (
          <Dropdown items={encodingMenu}>
            <button
              type="button"
              title={t('Reopen with encoding')}
              className="rounded px-1.5 text-[11px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            >
              {(encoding ?? 'UTF-8').toUpperCase()}
              {file.format.bom && ' BOM'} · {file.format.eol.toUpperCase()}
            </button>
          </Dropdown>
        )}
        {file?.lossy && (
          <span
            className="text-[11px] text-warning"
            title={t('Some bytes could not be decoded with this encoding')}
          >
            ⚠
          </span>
        )}
        {req.source === 'unstaged' && (
          <Button
            size="sm"
            title={t('Stage File')}
            className="h-6 border-success/60 bg-success-soft text-success"
            onClick={() => run('Stage', (p) => api.stage(p, [req.path]))}
          >
            <Plus className="size-3.5" /> {t('Stage File')}
          </Button>
        )}
        {req.source === 'staged' && (
          <Button
            size="sm"
            title={t('Unstage File')}
            className="h-6 border-danger/60 bg-danger-soft text-danger"
            onClick={() => run('Unstage', (p) => api.unstage(p, [req.path]))}
          >
            <Minus className="size-3.5" /> {t('Unstage File')}
          </Button>
        )}
        <IconButton label={t('Close (Esc)')} onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>

      {/* Tool row */}
      {!conflicted && (
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          {canEdit && !editing && (
            <Button
              size="sm"
              className="h-6"
              title={t('Edit This File')}
              onClick={startEdit}
              disabled={!file || file.binary}
            >
              <Pencil className="size-3.5" /> {t('Edit This File')}
            </Button>
          )}
          {editing && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-accent">
              <Pencil className="size-3.5" /> {t('Editing')}
              {dirty && <span className="text-warning">●</span>}
            </span>
          )}
          <div className="flex flex-1 items-center justify-center gap-2">
            <span className="rounded bg-accent-soft px-2 py-0.5 text-xs">{sourceLabel}</span>
            {!editing && tool !== 'history' && (
              <div className="flex overflow-hidden rounded-md border border-border">
                <button
                  type="button"
                  title={t('File View')}
                  className={segBtn(view === 'file')}
                  onClick={() => setView('file')}
                >
                  {t('File View')}
                </button>
                <button
                  type="button"
                  title={t('Diff View')}
                  className={segBtn(view === 'diff' && tool !== 'blame')}
                  onClick={() => {
                    setView('diff');
                    setTool(null);
                  }}
                >
                  {t('Diff View')}
                </button>
              </div>
            )}
          </div>
          {!editing && (
            <>
              <div className="flex overflow-hidden rounded-md border border-border">
                <button
                  type="button"
                  title={t('Blame')}
                  className={segBtn(tool === 'blame')}
                  disabled={deletedHere}
                  onClick={() => setTool(tool === 'blame' ? null : 'blame')}
                >
                  <ScanText className="size-3.5" /> {t('Blame')}
                </button>
                <button
                  type="button"
                  title={t('History')}
                  className={segBtn(tool === 'history')}
                  onClick={() => setTool(tool === 'history' ? null : 'history')}
                >
                  <History className="size-3.5" /> {t('History')}
                </button>
              </div>
              {view === 'diff' && tool === null && !image && (
                <div className="flex items-center">
                  <IconButton
                    label={t('Previous change')}
                    onClick={() => navRef.current?.go(-1)}
                    disabled={nav.total === 0}
                  >
                    <ArrowUp className="size-4" />
                  </IconButton>
                  <IconButton
                    label={t('Next change')}
                    onClick={() => navRef.current?.go(1)}
                    disabled={nav.total === 0}
                  >
                    <ArrowDown className="size-4" />
                  </IconButton>
                  <span className="w-12 text-center text-[11px] text-muted-foreground tabular-nums">
                    {nav.total ? `${nav.current < 0 ? '–' : nav.current + 1}/${nav.total}` : ''}
                  </span>
                </div>
              )}
              {(view === 'diff' || tool === 'history') && tool !== 'blame' && !image && (
                <div className="flex overflow-hidden rounded-md border border-border">
                  <button
                    type="button"
                    title={t('Hunk view')}
                    className={segBtn(layout === 'hunk')}
                    onClick={() => setLayout('hunk')}
                  >
                    <ListCollapse className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    title={t('Inline view')}
                    className={segBtn(layout === 'inline')}
                    onClick={() => setLayout('inline')}
                  >
                    <TextAlignJustify className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    title={t('Split view')}
                    className={segBtn(layout === 'split')}
                    onClick={() => setLayout('split')}
                  >
                    <Columns2 className="size-3.5" />
                  </button>
                </div>
              )}
              <div className="flex overflow-hidden rounded-md border border-border">
                <button
                  type="button"
                  title={t('Ignore leading/trailing whitespace')}
                  className={segBtn(ignoreWs)}
                  onClick={() => setIgnoreWs(!ignoreWs)}
                >
                  <Pilcrow className="size-3.5" />
                </button>
                <button
                  type="button"
                  title={t('Word wrap')}
                  className={segBtn(wrap)}
                  onClick={() => setWrap(!wrap)}
                >
                  <TextWrap className="size-3.5" />
                </button>
              </div>
            </>
          )}
          {editing && saveFormat && (
            <div className="flex items-center gap-2 text-xs">
              <Select
                value={saveFormat.encoding}
                onChange={(v) => setSaveFormat({ ...saveFormat, encoding: v })}
                title={t('Save with encoding')}
                className="h-6 rounded px-1.5 text-xs"
                options={(encodings.length ? encodings : ['UTF-8'])
                  .concat(
                    encodings.some((x) => x.toLowerCase() === saveFormat.encoding.toLowerCase())
                      ? []
                      : [saveFormat.encoding],
                  )
                  .map((e) => ({ value: e, label: e }))}
              />
              <label className="flex items-center gap-1">
                <Checkbox
                  checked={saveFormat.bom}
                  onChange={(v) => setSaveFormat({ ...saveFormat, bom: v })}
                />
                BOM
              </label>
              <Select
                value={saveFormat.eol}
                onChange={(v) => setSaveFormat({ ...saveFormat, eol: v as TextFormat['eol'] })}
                title={t('Line endings')}
                className="h-6 rounded px-1.5 text-xs"
                options={[
                  { value: 'lf', label: 'LF' },
                  { value: 'crlf', label: 'CRLF' },
                  ...(saveFormat.eol === 'mixed'
                    ? [{ value: 'mixed', label: t('Mixed (keep)') }]
                    : []),
                ]}
              />
              <Button size="sm" variant="ghost" title={t('Cancel')} onClick={stopEdit}>
                {t('Cancel')}
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={save}
                disabled={!dirty}
                title={`${t('Save')} (Ctrl+S)`}
              >
                <Check className="size-3.5" /> {t('Save')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Body */}
      <div className="min-h-0 flex-1">
        {conflicted ? (
          <ConflictView path={req.path} wrap={wrap} />
        ) : editing ? (
          <CodeView
            value={draft}
            path={req.path}
            editable
            wrap={wrap}
            onChange={setDraft}
            onSave={save}
          />
        ) : tool === 'history' ? (
          <FileHistory
            path={req.path}
            layout={layout}
            ignoreWhitespace={ignoreWs}
            wrap={wrap}
            encoding={encoding}
          />
        ) : view === 'file' || tool === 'blame' ? (
          fileError ? (
            <div className="p-6 text-muted-foreground">{fileError}</div>
          ) : !file ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="text-muted-foreground" />
            </div>
          ) : file.binary && image && tool !== 'blame' ? (
            <ImageDiff request={req} refreshKey={diff.text} only="after" />
          ) : file.binary ? (
            <div className="p-8 text-center text-muted-foreground">{t('Binary file')}</div>
          ) : (
            <CodeView
              value={file.text}
              path={req.path}
              wrap={wrap}
              lineMarks={marks}
              blame={blameInfo}
            />
          )
        ) : image ? (
          <ImageDiff request={req} refreshKey={diff.text} />
        ) : (
          <DiffBody
            request={req}
            layout={layout}
            ignoreWhitespace={ignoreWs}
            wrap={wrap}
            encoding={encoding}
            actions={actions}
            refreshKey={diff.text}
            navRef={navRef}
            onBlocks={(current, total) =>
              setNav((n) => (n.current === current && n.total === total ? n : { current, total }))
            }
          />
        )}
      </div>
    </div>
  );
}

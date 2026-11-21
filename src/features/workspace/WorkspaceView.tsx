import {
  AlertTriangle,
  ArrowDownToLine,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Download,
  ExternalLink,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  GitBranch,
  GitPullRequest,
  LayoutGrid,
  MoreHorizontal,
  RefreshCw,
  Search,
  SquareTerminal,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  Avatar,
  Button,
  ContextMenuWrap,
  Dropdown,
  IconButton,
  Spinner,
  type MenuItem,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { openUrl, revealPath } from '@/lib/native';
import type { PullRequest, RepoSummary, Workspace, WorkspaceFolder } from '@/lib/types';
import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';
import { ask, confirm, openDialog, toast } from '@/stores/ui';
import { samePath, summaryKey, useWorkspaces } from '@/stores/workspace';
import { acceptDrop, applyDrop, folderMenu, moveTargets, newFolder } from './folderActions';
import { beginDrag, DROP_ATTR, useFolderDrag } from './folderDrag';
import * as F from './folders';
import { DragGhost, FolderTree } from './FolderTree';
import { ColorSwatches } from './WorkspaceDialogs';
import { addRepoFolder } from './workspaceActions';

type Filter = 'all' | 'changes' | 'behind' | 'ahead' | 'problems';

const FILTERS: { key: Filter; label: string; test: (s: RepoSummary) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'changes', label: 'Uncommitted', test: (s) => s.changes > 0 },
  { key: 'behind', label: 'Behind', test: (s) => s.behind > 0 },
  { key: 'ahead', label: 'Unpushed', test: (s) => s.ahead > 0 },
  {
    key: 'problems',
    label: 'Needs attention',
    test: (s) => !!s.error || s.conflicts > 0 || (s.state !== null && s.state !== 'clean'),
  },
];

/** GitHub pull-request lookups running at once. */
const PR_LOOKUPS = 4;

/** Columns shared by the header, folder rows and repository rows. */
const GRID =
  'grid grid-cols-[minmax(200px,1.3fr)_minmax(140px,1fr)_96px_96px_minmax(200px,1.6fr)_60px_120px] items-center gap-3';

/** Left padding per folder level in the list. */
const INDENT = 20;

interface WorkspacePr extends PullRequest {
  repoName: string;
}

const blank = (p: string): RepoSummary => ({
  path: p,
  name: p.split(/[\\/]/).pop() ?? p,
  error: null,
  branch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  changes: 0,
  conflicts: 0,
  state: null,
  lastCommit: null,
  github: null,
  gitlab: null,
  wip: { modified: 0, added: 0, deleted: 0, renamed: 0 },
});

export function WorkspaceView() {
  const ws = useWorkspaces((s) => s.active());
  const summaries = useWorkspaces((s) => s.summaries);
  const loading = useWorkspaces((s) => s.summariesLoading);
  const running = useWorkspaces((s) => s.running);
  const addTarget = useWorkspaces((s) => s.addTarget);
  const { refreshSummaries, bulk, addRepos, removeRepo, update, remove, setAddTarget } =
    useWorkspaces.getState();
  const tabs = useRepo((s) => s.tabs);
  const open = useRepo((s) => s.open);
  const user = useGitHub((s) => s.user);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [prs, setPrs] = useState<WorkspacePr[] | null>(null);
  const [prsLoading, setPrsLoading] = useState(false);

  useEffect(() => {
    void refreshSummaries();
  }, [ws?.id, ws?.repos.length, refreshSummaries]);

  // The folder shown is the one new repositories go into; a deleted folder falls back to the root.
  const folders = useMemo(() => ws?.folders ?? [], [ws]);
  const selected = folders.some((f) => f.id === addTarget) ? addTarget : F.ROOT;
  const select = setAddTarget;

  const rows = useMemo(() => {
    const map = new Map<string, RepoSummary>();
    for (const p of ws?.repos ?? []) map.set(p, summaries[summaryKey(p)] ?? blank(p));
    return map;
  }, [ws, summaries]);

  /** Repositories in the shown folder and below it. */
  const scope = useMemo(
    () => (ws ? F.reposIn(ws, selected, true).map((p) => rows.get(p)!) : []),
    [ws, selected, rows],
  );

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, scope.filter(f.test).length])),
    [scope],
  );

  const filtering = query.trim() !== '' || filter !== 'all';
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const test = FILTERS.find((f) => f.key === filter)!.test;
    return new Set(
      scope
        .filter(test)
        .filter(
          (r) =>
            !q ||
            r.name.toLowerCase().includes(q) ||
            r.path.toLowerCase().includes(q) ||
            (r.branch ?? '').toLowerCase().includes(q),
        )
        .map((r) => r.path),
    );
  }, [scope, query, filter]);

  /** Repositories in each folder and below it ('' = the whole workspace). */
  const folderCounts = useMemo(() => {
    const out: Record<string, number> = { [F.ROOT]: ws?.repos.length ?? 0 };
    if (ws) for (const f of folders) out[f.id] = F.reposIn(ws, f.id, true).length;
    return out;
  }, [ws, folders]);

  const loadPrs = async () => {
    const withGh = [...rows.values()].filter((r) => r.github);
    if (!user || withGh.length === 0) return;
    setPrsLoading(true);
    try {
      // A few lookups at a time: a workspace of hundreds of repositories would otherwise send
      // hundreds of GitHub requests at once (rate limits, and other calls left waiting).
      const all: WorkspacePr[][] = [];
      let next = 0;
      const worker = async () => {
        for (let i = next++; i < withGh.length; i = next++) {
          const r = withGh[i]!;
          all[i] = await api
            .ghPulls(r.github!.owner, r.github!.repo)
            .then((list) => list.map((pr) => ({ ...pr, repoName: r.name })))
            .catch(() => [] as WorkspacePr[]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(PR_LOOKUPS, withGh.length) }, worker));
      setPrs(all.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    } finally {
      setPrsLoading(false);
    }
  };

  const ghKey = [...rows.values()]
    .filter((r) => r.github)
    .map((r) => `${r.github!.owner}/${r.github!.repo}`)
    .join(',');
  useEffect(() => {
    if (!user || !ghKey) return;
    // Deferred so the summaries render first; PR lookups hit the network.
    const t = setTimeout(() => void loadPrs(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.login, ghKey]);

  if (!ws) return null;

  const openAll = async (paths: string[]) => {
    for (const p of paths) {
      if (!tabs.some((t) => samePath(t.path, p))) {
        // Opening adds a tab; the last one opened stays active.
        await open(p);
      }
    }
    if (paths[0]) await open(paths[0]);
  };

  const addTabs = async () => {
    const n = await addRepos(
      ws.id,
      tabs.map((t) => t.path),
    );
    toast(
      'success',
      n === 1
        ? t('Added {n} open tab', { n })
        : n
          ? t('Added {n} open tabs', { n })
          : t('All open tabs are already in this workspace'),
    );
  };

  const rename = async () => {
    const v = await ask({
      title: t('Rename workspace'),
      fields: [{ name: 'name', label: t('Name'), initial: ws.name, required: true }],
      confirmLabel: t('Rename'),
    });
    if (v) await update(ws.id, { name: (v.name as string).trim() });
  };

  const del = async () => {
    if (
      await confirm(
        t('Delete workspace'),
        t('Delete the workspace “{name}”? Repositories on disk are not touched.', {
          name: ws.name,
        }),
        t('Delete'),
        true,
      )
    )
      await remove(ws.id);
  };

  const removeFromWs = async (r: RepoSummary) => {
    if (
      await confirm(
        t('Remove from workspace'),
        t('Remove {repo} from “{workspace}”? The folder on disk is not touched.', {
          repo: r.name,
          workspace: ws.name,
        }),
        t('Remove'),
      )
    )
      await removeRepo(ws.id, r.path);
  };

  const trail = F.pathTo(folders, selected);
  const here = trail.at(-1);

  const addMenu: MenuItem[] = [
    {
      label: t('Open a repository folder…'),
      icon: <FolderOpen className="size-3.5" />,
      onSelect: addRepoFolder,
    },
    {
      label: t('Scan a folder for repositories…'),
      icon: <FolderSearch className="size-3.5" />,
      onSelect: () => openDialog('scanWorkspace'),
    },
    {
      label: t('Clone a repository…'),
      icon: <Download className="size-3.5" />,
      onSelect: () => openDialog('clone'),
    },
    {
      label: t('Add open tabs ({n})', { n: tabs.length }),
      icon: <LayoutGrid className="size-3.5" />,
      disabled: tabs.length === 0,
      onSelect: addTabs,
    },
    'sep',
    {
      label: here ? t('New subfolder…') : t('New folder…'),
      icon: <FolderPlus className="size-3.5" />,
      disabled: !F.canNest(folders, selected),
      onSelect: () => void newFolder(ws, selected),
    },
  ];

  const moreMenu: MenuItem[] = [
    { label: t('Rename workspace…'), onSelect: rename },
    'sep',
    {
      label: t('Delete workspace'),
      danger: true,
      icon: <Trash2 className="size-3.5" />,
      onSelect: del,
    },
  ];

  const visiblePaths = scope.filter((r) => matches.has(r.path)).map((r) => r.path);
  const anyRunning = Object.keys(running).length > 0;

  const repoRow = (r: RepoSummary, depth: number, folder: string) => (
    <RepoRow
      key={r.path}
      ws={ws}
      s={r}
      depth={depth}
      folder={folder}
      running={running[summaryKey(r.path)]}
      isOpen={tabs.some((t) => samePath(t.path, r.path))}
      prCount={prs?.filter((p) => p.repoName === r.name).length}
      onOpen={() => open(r.path)}
      onFetch={() => bulk('fetch', [r.path])}
      onPull={() => bulk('pull', [r.path])}
      onRemove={() => void removeFromWs(r)}
    />
  );

  /** What `folder` holds — its subfolders, then its repositories — at `depth` in the list. */
  const contents = (folder: string, depth: number): ReactNode[] => {
    const out: ReactNode[] = [];
    for (const f of F.childrenOf(folders, folder)) {
      const inside = F.reposIn(ws, f.id, true);
      const hits = inside.filter((p) => matches.has(p));
      if (filtering && hits.length === 0) continue;
      const expanded = filtering || !f.collapsed;
      out.push(
        <FolderRow
          key={`f:${f.id}`}
          ws={ws}
          f={f}
          depth={depth}
          expanded={expanded}
          repos={hits.map((p) => rows.get(p)!)}
          total={inside.length}
          running={hits.some((p) => running[summaryKey(p)])}
          onShow={() => select(f.id)}
          onOpenAll={() => openAll(hits)}
          onFetch={() => bulk('fetch', hits)}
          onPull={() =>
            bulk(
              'pull',
              hits.filter((p) => (summaries[summaryKey(p)]?.behind ?? 1) > 0),
            )
          }
        />,
      );
      if (expanded) {
        const inner = contents(f.id, depth + 1);
        out.push(
          ...(inner.length
            ? inner
            : [
                <div
                  key={`e:${f.id}`}
                  {...{ [DROP_ATTR]: f.id }}
                  style={{ paddingLeft: 16 + (depth + 1) * INDENT }}
                  className="border-b border-border py-2 pr-4 text-xs text-muted-foreground italic last:border-b-0"
                >
                  {t(
                    'Empty folder: drag repositories here, or use “Move to folder” on a repository.',
                  )}
                </div>,
              ]),
        );
      }
    }
    for (const p of F.reposIn(ws, folder))
      if (matches.has(p)) out.push(repoRow(rows.get(p)!, depth, folder));
    return out;
  };

  const list = contents(selected, 0);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto [scrollbar-gutter:stable]">
      <DragGhost />
      <div className="w-full px-[2.7rem] py-5">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="size-3.5 rounded-full" style={{ background: ws.color }} />
          <h1 className="text-xl font-semibold">{ws.name}</h1>
          <span className="text-muted-foreground">
            {ws.repos.length === 1
              ? t('{n} repository', { n: ws.repos.length })
              : t('{n} repositories', { n: ws.repos.length })}
            {folders.length > 0 &&
              ` · ${folders.length === 1 ? t('{n} folder', { n: folders.length }) : t('{n} folders', { n: folders.length })}`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Dropdown items={addMenu}>
              <Button variant="primary">
                <FolderPlus className="size-4" /> {t('Add repositories')}{' '}
                <ChevronDown className="size-3.5" />
              </Button>
            </Dropdown>
            <Button
              onClick={() => bulk('fetch', visiblePaths)}
              disabled={anyRunning || visiblePaths.length === 0}
              title={t('Fetch every repository in the list')}
            >
              <RefreshCw className="size-4" /> {t('Fetch all')}
            </Button>
            <Button
              onClick={() =>
                bulk(
                  'pull',
                  visiblePaths.filter((p) => (summaries[summaryKey(p)]?.behind ?? 1) > 0),
                )
              }
              disabled={anyRunning || visiblePaths.length === 0}
              title={t(
                'Fast-forward every repository that is behind (never creates merge commits)',
              )}
            >
              <ArrowDownToLine className="size-4" /> {t('Pull all')}
            </Button>
            <Button
              onClick={() => openAll(visiblePaths)}
              disabled={visiblePaths.length === 0}
              title={t('Open every repository in the list as a tab')}
            >
              <LayoutGrid className="size-4" /> {t('Open all')}
            </Button>
            <Dropdown items={moreMenu}>
              <Button aria-label={t('Workspace options')}>
                <MoreHorizontal className="size-4" />
              </Button>
            </Dropdown>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          {t('Colour')}{' '}
          <ColorSwatches value={ws.color} onChange={(c) => update(ws.id, { color: c })} />
        </div>

        <div className="mt-5 grid grid-cols-[220px_minmax(0,1fr)] items-start gap-5">
          {/* Folders */}
          <aside className="sticky top-0 max-h-[calc(100vh-8rem)] overflow-auto rounded-lg border border-border bg-surface p-2">
            <FolderTree ws={ws} selected={selected} counts={folderCounts} onSelect={select} />
          </aside>

          <div className="min-w-0">
            {/* Where we are */}
            <div className="mb-2 flex min-h-7 flex-wrap items-center gap-1 text-sm">
              <button
                type="button"
                {...{ [DROP_ATTR]: F.ROOT }}
                onClick={() => select(F.ROOT)}
                className={cn(
                  'rounded px-1.5 py-0.5 hover:bg-surface-hover',
                  here ? 'text-muted-foreground' : 'font-semibold',
                )}
              >
                {t('All repositories')}
              </button>
              {trail.map((f, i) => (
                <span key={f.id} className="flex items-center gap-1">
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                  <button
                    type="button"
                    {...{ [DROP_ATTR]: f.id }}
                    onClick={() => select(f.id)}
                    className={cn(
                      'flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-hover',
                      i === trail.length - 1 ? 'font-semibold' : 'text-muted-foreground',
                    )}
                  >
                    <Folder className="size-3.5" style={{ color: ws.color }} />
                    {f.name}
                  </button>
                </span>
              ))}
              {here && (
                <Dropdown items={folderMenu(ws, here, select)}>
                  <IconButton label={t('Folder options')}>
                    <MoreHorizontal className="size-3.5" />
                  </IconButton>
                </Dropdown>
              )}
              <span className="ml-2 text-xs text-muted-foreground">
                {scope.length === 1
                  ? t('{n} repository', { n: scope.length })
                  : t('{n} repositories', { n: scope.length })}
              </span>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-72">
                <Search className="absolute top-2 left-2.5 size-3.5 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('Filter by name, path or branch')}
                  className="h-8 w-full rounded-md border border-border bg-background pr-2 pl-8 outline-none focus:border-accent"
                />
              </div>
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    'h-7 rounded-full border px-3 text-xs',
                    filter === f.key
                      ? 'border-accent bg-accent-soft text-foreground'
                      : 'border-border text-muted-foreground hover:bg-surface-hover',
                  )}
                >
                  {t(f.label)} <span className="ml-1 tabular-nums opacity-70">{counts[f.key]}</span>
                </button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => refreshSummaries()}
                disabled={loading}
              >
                {loading ? <Spinner /> : <RefreshCw className="size-3.5" />} {t('Refresh')}
              </Button>
            </div>

            {/* Repositories, grouped by folder */}
            <div
              className="mt-3 overflow-hidden rounded-lg border border-border bg-surface"
              {...{ [DROP_ATTR]: selected }}
            >
              <div
                className={cn(
                  GRID,
                  'border-b border-border px-4 py-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase',
                )}
              >
                <span>{t('Repository')}</span>
                <span>{t('Branch')}</span>
                <span>{t('Sync')}</span>
                <span>{t('Changes')}</span>
                <span>{t('Last activity')}</span>
                <span>{t('PRs')}</span>
                <span />
              </div>
              {ws.repos.length === 0 && (
                <div className="flex flex-col items-center gap-3 p-10 text-center text-muted-foreground">
                  {t('This workspace has no repositories yet.')}
                  <div className="flex gap-2">
                    <Button onClick={() => openDialog('scanWorkspace')}>
                      <FolderSearch className="size-4" /> {t('Scan a folder')}
                    </Button>
                    <Button onClick={addRepoFolder}>
                      <FolderOpen className="size-4" /> {t('Open a folder')}
                    </Button>
                    <Button onClick={() => openDialog('clone')}>
                      <Download className="size-4" /> {t('Clone')}
                    </Button>
                  </div>
                </div>
              )}
              {ws.repos.length > 0 && list.length === 0 && (
                <div className="p-8 text-center text-muted-foreground">
                  {filtering
                    ? t('No repository matches.')
                    : t(
                        'Empty folder: drag repositories here, or use “Move to folder” on a repository.',
                      )}
                </div>
              )}
              {list}
            </div>
          </div>
        </div>

        {/* Pull requests across the workspace */}
        {[...rows.values()].some((r) => r.github) && (
          <div className="mt-6">
            <div className="mb-2 flex items-center gap-2">
              <GitPullRequest className="size-4 text-muted-foreground" />
              <h2 className="font-semibold">{t('Pull requests')}</h2>
              {prs && (
                <span className="text-muted-foreground">{t('{n} open', { n: prs.length })}</span>
              )}
              {user && (
                <IconButton
                  label={t('Refresh pull requests')}
                  className="ml-auto"
                  onClick={loadPrs}
                >
                  {prsLoading ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                </IconButton>
              )}
            </div>
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              {!user && (
                <div className="p-6 text-center text-muted-foreground">
                  {t('Connect GitHub to see open pull requests across this workspace.')}
                </div>
              )}
              {user && prs?.length === 0 && (
                <div className="p-6 text-center text-muted-foreground">
                  {t('No open pull requests.')}
                </div>
              )}
              {prs?.map((pr) => (
                <div
                  key={pr.htmlUrl}
                  role="button"
                  tabIndex={0}
                  onClick={() => openUrl(pr.htmlUrl)}
                  onKeyDown={(e) => e.key === 'Enter' && openUrl(pr.htmlUrl)}
                  className="flex cursor-default items-center gap-3 border-b border-border px-4 py-2 last:border-b-0 hover:bg-surface-hover"
                >
                  <Avatar name={pr.author} url={pr.authorAvatar} size={22} />
                  <span className="w-36 shrink-0 truncate text-xs text-muted-foreground">
                    {pr.repoName}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-muted-foreground">#{pr.number}</span> {pr.title}
                    {pr.draft && (
                      <span className="ml-2 rounded bg-surface-muted px-1.5 text-xs">
                        {t('Draft')}
                      </span>
                    )}
                  </span>
                  <span className="max-w-64 shrink-0 truncate text-xs text-muted-foreground">
                    {pr.headRef} → {pr.baseRef}
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                    {relativeTime(Date.parse(pr.updatedAt) / 1000)}
                  </span>
                  <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A folder's heading in the list: collapses it, and sums up what is inside. */
function FolderRow({
  ws,
  f,
  depth,
  expanded,
  repos,
  total,
  running,
  onShow,
  onOpenAll,
  onFetch,
  onPull,
}: {
  ws: Workspace;
  f: WorkspaceFolder;
  depth: number;
  expanded: boolean;
  /** Repositories inside (subfolders included) that pass the filters. */
  repos: RepoSummary[];
  total: number;
  running: boolean;
  onShow: () => void;
  onOpenAll: () => void;
  onFetch: () => void;
  onPull: () => void;
}) {
  const over = useFolderDrag((s) => s.over === f.id);
  const changed = repos.filter((r) => r.changes > 0).length;
  const behind = repos.filter((r) => r.behind > 0).length;
  const ahead = repos.filter((r) => r.ahead > 0).length;
  const problems = repos.filter(FILTERS[4]!.test).length;
  const latest = repos
    .map((r) => r.lastCommit)
    .filter((c) => c !== null)
    .sort((a, b) => b.time - a.time)[0];
  const toggle = () => void useWorkspaces.getState().toggleFolder(ws.id, f.id);
  const menu = (): MenuItem[] => [
    { label: t('Show only this folder'), onSelect: onShow },
    { label: t('Open all'), disabled: repos.length === 0, onSelect: onOpenAll },
    'sep',
    ...folderMenu(ws, f),
  ];
  return (
    <ContextMenuWrap items={menu}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        {...{ [DROP_ATTR]: f.id }}
        onClick={toggle}
        onDoubleClick={onShow}
        onKeyDown={(e) => e.key === 'Enter' && toggle()}
        onPointerDown={(e) =>
          beginDrag(
            e,
            { kind: 'folder', id: f.id, label: f.name },
            (it, to) => acceptDrop(ws, it, to),
            (it, to) => applyDrop(ws, it, to),
          )
        }
        style={{ paddingLeft: 16 + depth * INDENT }}
        className={cn(
          GRID,
          'group cursor-default border-b border-border bg-surface-muted/60 py-1.5 pr-4 last:border-b-0 hover:bg-surface-hover',
          over && 'ring-1 ring-accent ring-inset',
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5 font-medium">
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              expanded && 'rotate-90',
            )}
          />
          {expanded ? (
            <FolderOpen className="size-4 shrink-0" style={{ color: ws.color }} />
          ) : (
            <Folder className="size-4 shrink-0" style={{ color: ws.color }} />
          )}
          <span className="truncate">{f.name}</span>
          <span className="shrink-0 rounded-full bg-surface px-1.5 text-[11px] text-muted-foreground tabular-nums">
            {repos.length === total ? total : `${repos.length}/${total}`}
          </span>
        </div>
        <div />
        <div className="flex gap-2 text-xs tabular-nums">
          {behind > 0 && (
            <span className="text-warning" title={t('Behind')}>
              ↓{behind}
            </span>
          )}
          {ahead > 0 && (
            <span className="text-accent" title={t('Unpushed')}>
              ↑{ahead}
            </span>
          )}
        </div>
        <div className="flex gap-2 text-xs">
          {problems > 0 && (
            <span className="text-danger" title={t('Needs attention')}>
              ⚠ {problems}
            </span>
          )}
          {changed > 0 && (
            <span className="text-warning" title={t('Uncommitted')}>
              ✎ {changed}
            </span>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {latest && `${latest.author} · ${relativeTime(latest.time)}`}
        </div>
        <div />
        <div className="flex items-center justify-end">
          {running ? (
            <Spinner className="size-3.5" />
          ) : (
            <div className="flex opacity-0 group-hover:opacity-100">
              <IconButton
                label={t('Fetch this folder')}
                disabled={repos.length === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  onFetch();
                }}
              >
                <RefreshCw className="size-3.5" />
              </IconButton>
              <IconButton
                label={t('Pull this folder (fast-forward)')}
                disabled={repos.length === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  onPull();
                }}
              >
                <ArrowDownToLine className="size-3.5" />
              </IconButton>
              <IconButton
                label={t('Open all')}
                disabled={repos.length === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenAll();
                }}
              >
                <LayoutGrid className="size-3.5" />
              </IconButton>
              <Dropdown items={menu()}>
                <IconButton label={t('Folder options')} onClick={(e) => e.stopPropagation()}>
                  <MoreHorizontal className="size-3.5" />
                </IconButton>
              </Dropdown>
            </div>
          )}
        </div>
      </div>
    </ContextMenuWrap>
  );
}

function RepoRow({
  ws,
  s,
  depth,
  folder,
  running,
  isOpen,
  prCount,
  onOpen,
  onFetch,
  onPull,
  onRemove,
}: {
  ws: Workspace;
  s: RepoSummary;
  depth: number;
  folder: string;
  running: 'fetch' | 'pull' | undefined;
  isOpen: boolean;
  prCount: number | undefined;
  onOpen: () => void;
  onFetch: () => void;
  onPull: () => void;
  onRemove: () => void;
}) {
  const over = useFolderDrag((st) => st.over === folder && st.item !== null);
  const terminal = () =>
    api
      .openTerminal(s.path)
      .catch((e) => toast('error', t('Could not open terminal'), (e as Error).message));
  const moveTo = (to: string) => void useWorkspaces.getState().moveRepos(ws.id, [s.path], to);
  const menu = (): MenuItem[] => [
    { label: t('Open'), onSelect: onOpen },
    { label: t('Fetch'), onSelect: onFetch },
    { label: t('Pull (fast-forward)'), onSelect: onPull },
    'sep',
    {
      label: t('Move to folder'),
      icon: <FolderInput className="size-3.5" />,
      items: moveTargets(ws, folder, moveTo),
    },
    {
      label: t('New folder with this repository…'),
      icon: <FolderPlus className="size-3.5" />,
      disabled: !F.canNest(ws.folders ?? [], folder),
      onSelect: async () => {
        const id = await newFolder(ws, folder);
        if (id) moveTo(id);
      },
    },
    'sep',
    { label: t('Open terminal here'), onSelect: terminal },
    { label: t('Show in file explorer'), onSelect: () => revealPath(s.path) },
    'sep',
    { label: t('Remove from workspace'), danger: true, onSelect: onRemove },
  ];
  const busyState = s.state && s.state !== 'clean';
  return (
    <ContextMenuWrap items={menu}>
      <div
        role="button"
        tabIndex={0}
        {...{ [DROP_ATTR]: folder }}
        onClick={onOpen}
        onKeyDown={(e) => e.key === 'Enter' && onOpen()}
        onPointerDown={(e) =>
          beginDrag(
            e,
            { kind: 'repo', paths: [s.path], label: s.name },
            (it, to) => acceptDrop(ws, it, to),
            (it, to) => applyDrop(ws, it, to),
          )
        }
        style={{ paddingLeft: 16 + depth * INDENT }}
        className={cn(
          GRID,
          'group cursor-default border-b border-border py-2 pr-4 last:border-b-0 hover:bg-surface-hover',
          over && 'bg-accent-soft/40',
        )}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium">
            {isOpen && (
              <CircleDot className="size-3 shrink-0 text-accent" aria-label={t('Open in a tab')} />
            )}
            <span className="truncate">{s.name}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground" title={s.path}>
            {s.path}
          </div>
        </div>

        {s.error ? (
          <div className="col-span-4 flex items-center gap-1.5 text-xs text-danger" title={s.error}>
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="truncate">{s.error}</span>
          </div>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-1.5">
              <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{s.branch ?? t('detached')}</span>
            </div>
            <div className="text-xs tabular-nums">
              {!s.upstream ? (
                <span className="text-muted-foreground">{t('no upstream')}</span>
              ) : s.ahead + s.behind === 0 ? (
                <span className="text-success">{t('up to date')}</span>
              ) : (
                <span className="flex gap-2">
                  {s.behind > 0 && <span className="text-warning">↓{s.behind}</span>}
                  {s.ahead > 0 && <span className="text-accent">↑{s.ahead}</span>}
                </span>
              )}
            </div>
            <div className="text-xs">
              {busyState ? (
                <span className="text-danger">{s.state}</span>
              ) : s.conflicts > 0 ? (
                <span className="text-danger">{t('{n} conflicts', { n: s.conflicts })}</span>
              ) : s.changes > 0 ? (
                <span className="text-warning">✎ {s.changes}</span>
              ) : (
                <span className="text-muted-foreground">{t('clean')}</span>
              )}
            </div>
            <div className="min-w-0 text-xs">
              {s.lastCommit ? (
                <>
                  <div className="truncate">{s.lastCommit.subject}</div>
                  <div className="truncate text-muted-foreground">
                    {s.lastCommit.author} · {relativeTime(s.lastCommit.time)}
                  </div>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          </>
        )}
        <div className="text-xs text-muted-foreground tabular-nums">
          {s.github ? (prCount ?? '—') : ''}
        </div>
        <div className="flex items-center justify-end gap-0.5">
          {running ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Spinner className="size-3.5" /> {running === 'fetch' ? t('Fetching') : t('Pulling')}
            </span>
          ) : (
            <div className="flex opacity-0 group-hover:opacity-100">
              <IconButton
                label={t('Fetch')}
                onClick={(e) => {
                  e.stopPropagation();
                  onFetch();
                }}
              >
                <RefreshCw className="size-3.5" />
              </IconButton>
              <IconButton
                label={t('Pull (fast-forward)')}
                onClick={(e) => {
                  e.stopPropagation();
                  onPull();
                }}
              >
                <ArrowDownToLine className="size-3.5" />
              </IconButton>
              <IconButton
                label={t('Open terminal')}
                onClick={(e) => {
                  e.stopPropagation();
                  void terminal();
                }}
              >
                <SquareTerminal className="size-3.5" />
              </IconButton>
              <IconButton
                label={t('Remove from workspace')}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
              >
                <X className="size-3.5" />
              </IconButton>
            </div>
          )}
        </div>
      </div>
    </ContextMenuWrap>
  );
}

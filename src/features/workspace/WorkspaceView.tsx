import {
  AlertTriangle,
  ArrowDownToLine,
  ChevronDown,
  CircleDot,
  Download,
  ExternalLink,
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
import { useEffect, useMemo, useState } from 'react';

import {
  Avatar,
  Button,
  ContextMenuWrap,
  Dropdown,
  IconButton,
  Spinner,
  cn,
  type MenuItem,
} from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { api } from '@/lib/ipc';
import { openUrl, pickFolder, revealPath } from '@/lib/native';
import type { PullRequest, RepoSummary } from '@/lib/types';
import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';
import { ask, confirm, toast } from '@/stores/ui';
import { samePath, summaryKey, useWorkspaces } from '@/stores/workspace';
import { ColorSwatches, ScanDialog } from './WorkspaceDialogs';

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

interface WorkspacePr extends PullRequest {
  repoName: string;
}

export function WorkspaceView({ onClone }: { onClone: () => void }) {
  const ws = useWorkspaces((s) => s.active());
  const summaries = useWorkspaces((s) => s.summaries);
  const loading = useWorkspaces((s) => s.summariesLoading);
  const running = useWorkspaces((s) => s.running);
  const { refreshSummaries, bulk, addRepos, removeRepo, update, remove } = useWorkspaces.getState();
  const tabs = useRepo((s) => s.tabs);
  const open = useRepo((s) => s.open);
  const user = useGitHub((s) => s.user);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [scanOpen, setScanOpen] = useState(false);
  const [prs, setPrs] = useState<WorkspacePr[] | null>(null);
  const [prsLoading, setPrsLoading] = useState(false);

  useEffect(() => {
    void refreshSummaries();
  }, [ws?.id, ws?.repos.length, refreshSummaries]);

  const rows = useMemo(() => {
    if (!ws) return [];
    return ws.repos.map(
      (p) =>
        summaries[summaryKey(p)] ?? {
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
        },
    );
  }, [ws, summaries]);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter(f.test).length])),
    [rows],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const test = FILTERS.find((f) => f.key === filter)!.test;
    return rows
      .filter(test)
      .filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          r.path.toLowerCase().includes(q) ||
          (r.branch ?? '').toLowerCase().includes(q),
      );
  }, [rows, query, filter]);

  const loadPrs = async () => {
    const withGh = rows.filter((r) => r.github);
    if (!user || withGh.length === 0) return;
    setPrsLoading(true);
    try {
      const all = await Promise.all(
        withGh.map((r) =>
          api
            .ghPulls(r.github!.owner, r.github!.repo)
            .then((list) => list.map((pr) => ({ ...pr, repoName: r.name })))
            .catch(() => [] as WorkspacePr[]),
        ),
      );
      setPrs(all.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    } finally {
      setPrsLoading(false);
    }
  };

  const ghKey = rows
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

  const addFolder = async () => {
    const p = await pickFolder('Add a repository to this workspace');
    if (!p) return;
    try {
      const info = await api.info(p);
      const n = await addRepos(ws.id, [info.path]);
      toast(
        n ? 'success' : 'info',
        n ? `Added ${info.name}` : `${info.name} is already in this workspace`,
      );
    } catch (e) {
      toast('error', 'Not a Git repository', (e as Error).message);
    }
  };

  const addTabs = async () => {
    const n = await addRepos(
      ws.id,
      tabs.map((t) => t.path),
    );
    toast(
      'success',
      n
        ? `Added ${n} open tab${n === 1 ? '' : 's'}`
        : 'All open tabs are already in this workspace',
    );
  };

  const rename = async () => {
    const v = await ask({
      title: 'Rename workspace',
      fields: [{ name: 'name', label: 'Name', initial: ws.name, required: true }],
      confirmLabel: 'Rename',
    });
    if (v) await update(ws.id, { name: (v.name as string).trim() });
  };

  const del = async () => {
    if (
      await confirm(
        'Delete workspace',
        `Delete the workspace “${ws.name}”? Repositories on disk are not touched.`,
        'Delete',
        true,
      )
    )
      await remove(ws.id);
  };

  const addMenu: MenuItem[] = [
    {
      label: 'Open a repository folder…',
      icon: <FolderOpen className="size-3.5" />,
      onSelect: addFolder,
    },
    {
      label: 'Scan a folder for repositories…',
      icon: <FolderSearch className="size-3.5" />,
      onSelect: () => setScanOpen(true),
    },
    { label: 'Clone a repository…', icon: <Download className="size-3.5" />, onSelect: onClone },
    {
      label: `Add open tabs (${tabs.length})`,
      icon: <LayoutGrid className="size-3.5" />,
      disabled: tabs.length === 0,
      onSelect: addTabs,
    },
  ];

  const moreMenu: MenuItem[] = [
    { label: 'Rename workspace…', onSelect: rename },
    'sep',
    {
      label: 'Delete workspace',
      danger: true,
      icon: <Trash2 className="size-3.5" />,
      onSelect: del,
    },
  ];

  const visiblePaths = shown.map((r) => r.path);
  const anyRunning = Object.keys(running).length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <div className="mx-auto w-full max-w-6xl px-6 py-5">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="size-3.5 rounded-full" style={{ background: ws.color }} />
          <h1 className="text-xl font-semibold">{ws.name}</h1>
          <span className="text-muted-foreground">
            {ws.repos.length} repositor{ws.repos.length === 1 ? 'y' : 'ies'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Dropdown items={addMenu}>
              <Button variant="primary">
                <FolderPlus className="size-4" /> Add repositories{' '}
                <ChevronDown className="size-3.5" />
              </Button>
            </Dropdown>
            <Button
              onClick={() => bulk('fetch', visiblePaths)}
              disabled={anyRunning || visiblePaths.length === 0}
              title="Fetch every repository in the list"
            >
              <RefreshCw className="size-4" /> Fetch all
            </Button>
            <Button
              onClick={() =>
                bulk(
                  'pull',
                  visiblePaths.filter((p) => (summaries[summaryKey(p)]?.behind ?? 1) > 0),
                )
              }
              disabled={anyRunning || visiblePaths.length === 0}
              title="Fast-forward every repository that is behind (never creates merge commits)"
            >
              <ArrowDownToLine className="size-4" /> Pull all
            </Button>
            <Button
              onClick={() => openAll(visiblePaths)}
              disabled={visiblePaths.length === 0}
              title="Open every repository in the list as a tab"
            >
              <LayoutGrid className="size-4" /> Open all
            </Button>
            <Dropdown items={moreMenu}>
              <Button aria-label="Workspace options">
                <MoreHorizontal className="size-4" />
              </Button>
            </Dropdown>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          Colour <ColorSwatches value={ws.color} onChange={(c) => update(ws.id, { color: c })} />
        </div>

        {/* Filters */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <div className="relative w-72">
            <Search className="absolute top-2 left-2.5 size-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name, path or branch"
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
              {f.label} <span className="ml-1 tabular-nums opacity-70">{counts[f.key]}</span>
            </button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => refreshSummaries()}
            disabled={loading}
          >
            {loading ? <Spinner /> : <RefreshCw className="size-3.5" />} Refresh
          </Button>
        </div>

        {/* Repositories */}
        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
          <div className="grid grid-cols-[minmax(200px,1.3fr)_minmax(140px,1fr)_96px_96px_minmax(200px,1.6fr)_60px_120px] items-center gap-3 border-b border-border px-4 py-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            <span>Repository</span>
            <span>Branch</span>
            <span>Sync</span>
            <span>Changes</span>
            <span>Last activity</span>
            <span>PRs</span>
            <span />
          </div>
          {ws.repos.length === 0 && (
            <div className="flex flex-col items-center gap-3 p-10 text-center text-muted-foreground">
              This workspace has no repositories yet.
              <div className="flex gap-2">
                <Button onClick={() => setScanOpen(true)}>
                  <FolderSearch className="size-4" /> Scan a folder
                </Button>
                <Button onClick={addFolder}>
                  <FolderOpen className="size-4" /> Open a folder
                </Button>
                <Button onClick={onClone}>
                  <Download className="size-4" /> Clone
                </Button>
              </div>
            </div>
          )}
          {ws.repos.length > 0 && shown.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">No repository matches.</div>
          )}
          {shown.map((r) => (
            <RepoRow
              key={r.path}
              s={r}
              running={running[summaryKey(r.path)]}
              isOpen={tabs.some((t) => samePath(t.path, r.path))}
              prCount={prs?.filter((p) => p.repoName === r.name).length}
              onOpen={() => open(r.path)}
              onFetch={() => bulk('fetch', [r.path])}
              onPull={() => bulk('pull', [r.path])}
              onRemove={async () => {
                if (
                  await confirm(
                    'Remove from workspace',
                    `Remove ${r.name} from “${ws.name}”? The folder on disk is not touched.`,
                    'Remove',
                  )
                )
                  await removeRepo(ws.id, r.path);
              }}
            />
          ))}
        </div>

        {/* Pull requests across the workspace */}
        {rows.some((r) => r.github) && (
          <div className="mt-6">
            <div className="mb-2 flex items-center gap-2">
              <GitPullRequest className="size-4 text-muted-foreground" />
              <h2 className="font-semibold">Pull requests</h2>
              {prs && <span className="text-muted-foreground">{prs.length} open</span>}
              {user && (
                <IconButton label="Refresh pull requests" className="ml-auto" onClick={loadPrs}>
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
                  Connect GitHub to see open pull requests across this workspace.
                </div>
              )}
              {user && prs?.length === 0 && (
                <div className="p-6 text-center text-muted-foreground">No open pull requests.</div>
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
                      <span className="ml-2 rounded bg-surface-muted px-1.5 text-xs">Draft</span>
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
      <ScanDialog open={scanOpen} onClose={() => setScanOpen(false)} />
    </div>
  );
}

function RepoRow({
  s,
  running,
  isOpen,
  prCount,
  onOpen,
  onFetch,
  onPull,
  onRemove,
}: {
  s: RepoSummary;
  running: 'fetch' | 'pull' | undefined;
  isOpen: boolean;
  prCount: number | undefined;
  onOpen: () => void;
  onFetch: () => void;
  onPull: () => void;
  onRemove: () => void;
}) {
  const terminal = () =>
    api
      .openTerminal(s.path)
      .catch((e) => toast('error', 'Could not open terminal', (e as Error).message));
  const menu = (): MenuItem[] => [
    { label: 'Open', onSelect: onOpen },
    { label: 'Fetch', onSelect: onFetch },
    { label: 'Pull (fast-forward)', onSelect: onPull },
    'sep',
    { label: 'Open terminal here', onSelect: terminal },
    { label: 'Show in file explorer', onSelect: () => revealPath(s.path) },
    'sep',
    { label: 'Remove from workspace', danger: true, onSelect: onRemove },
  ];
  const busyState = s.state && s.state !== 'clean';
  return (
    <ContextMenuWrap items={menu}>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => e.key === 'Enter' && onOpen()}
        className="group grid cursor-default grid-cols-[minmax(200px,1.3fr)_minmax(140px,1fr)_96px_96px_minmax(200px,1.6fr)_60px_120px] items-center gap-3 border-b border-border px-4 py-2 last:border-b-0 hover:bg-surface-hover"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium">
            {isOpen && (
              <CircleDot className="size-3 shrink-0 text-accent" aria-label="Open in a tab" />
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
              <span className="truncate">{s.branch ?? 'detached'}</span>
            </div>
            <div className="text-xs tabular-nums">
              {!s.upstream ? (
                <span className="text-muted-foreground">no upstream</span>
              ) : s.ahead + s.behind === 0 ? (
                <span className="text-success">up to date</span>
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
                <span className="text-danger">{s.conflicts} conflicts</span>
              ) : s.changes > 0 ? (
                <span className="text-warning">✎ {s.changes}</span>
              ) : (
                <span className="text-muted-foreground">clean</span>
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
              <Spinner className="size-3.5" /> {running === 'fetch' ? 'Fetching' : 'Pulling'}
            </span>
          ) : (
            <div className="flex opacity-0 group-hover:opacity-100">
              <IconButton
                label="Fetch"
                onClick={(e) => {
                  e.stopPropagation();
                  onFetch();
                }}
              >
                <RefreshCw className="size-3.5" />
              </IconButton>
              <IconButton
                label="Pull (fast-forward)"
                onClick={(e) => {
                  e.stopPropagation();
                  onPull();
                }}
              >
                <ArrowDownToLine className="size-3.5" />
              </IconButton>
              <IconButton
                label="Open terminal"
                onClick={(e) => {
                  e.stopPropagation();
                  void terminal();
                }}
              >
                <SquareTerminal className="size-3.5" />
              </IconButton>
              <IconButton
                label="Remove from workspace"
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

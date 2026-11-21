import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BellOff,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleDot,
  Clock,
  Copy,
  ExternalLink,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitMerge,
  GitPullRequest,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  SmilePlus,
  SquareTerminal,
  ThumbsUp,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Avatar, Button, Dropdown, Github, Spinner, type MenuItem } from '@/components/ui';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { copyText, openUrl, revealPath } from '@/lib/native';
import type { LaunchItem, LaunchReason, RepoSummary } from '@/lib/types';
import { useGitHub } from '@/stores/github';
import { ensureGitLabChecked, useGitLab } from '@/stores/gitlab';
import { allItems, useLaunchpad } from '@/stores/launchpad';
import { useRepo } from '@/stores/repo';
import { useTokens } from '@/stores/tokens';
import { ask, toast, useUi } from '@/stores/ui';
import { summaryKey, useWorkspaces } from '@/stores/workspace';
import {
  ALL_REASONS,
  ageLabel,
  branchIssue,
  branchNameFor,
  branchRows,
  groupItems,
  itemsFor,
  localRepoFor,
  matchesFilter,
  wipRows,
  type Group,
  type HostId,
  type Tab,
  type ViewFilter,
} from './model';
import { openPullMerge } from './pullMerge';

const HOUR = 3600_000;

const reasonLabel = (r: LaunchReason) =>
  ({
    authored: t('Authored'),
    assigned: t('Assigned'),
    reviewRequested: t('Review requested'),
    mentioned: t('Mentioned'),
  })[r];

const groupLabel = (g: Group) =>
  ({
    pinned: t('Pinned'),
    review: t('Waiting for your review'),
    attention: t('Needs attention'),
    ready: t('Ready to merge'),
    waiting: t('Waiting on others'),
    draft: t('Drafts'),
    issues: t('Issues'),
  })[g];

const hostName = (h: HostId) => (h === 'github' ? 'GitHub' : 'GitLab');
const refOf = (i: LaunchItem) => `${i.kind === 'pr' && i.host === 'gitlab' ? '!' : '#'}${i.number}`;

/** Repositories WIPs and Branches look at. */
function useScopePaths(): string[] {
  const scope = useLaunchpad((s) => s.scope);
  const data = useWorkspaces((s) => s.data);
  const tabs = useRepo((s) => s.tabs);
  return useMemo(() => {
    const active = data.items.find((w) => w.id === data.active);
    const lists =
      scope === 'all'
        ? [...data.items.flatMap((w) => w.repos), ...tabs.map((x) => x.path)]
        : active
          ? active.repos
          : tabs.map((x) => x.path);
    const seen = new Set<string>();
    return lists.filter((p) => {
      const k = summaryKey(p);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [scope, data, tabs]);
}

/** The time, updated every minute (ages and snooze expiry). */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

async function openRepo(path: string) {
  useLaunchpad.getState().setOpen(false);
  await useRepo.getState().open(path);
}

export function LaunchpadView({ onSignIn }: { onSignIn: () => void }) {
  const tab = useLaunchpad((s) => s.tab);
  const setTab = useLaunchpad((s) => s.setTab);
  const items = useLaunchpad((s) => s.items);
  const errors = useLaunchpad((s) => s.errors);
  const loading = useLaunchpad((s) => s.loading);
  const prefs = useLaunchpad((s) => s.prefs);
  const scope = useLaunchpad((s) => s.scope);
  const { load, setScope, saveView, deleteView } = useLaunchpad.getState();
  const ghUser = useGitHub((s) => s.user);
  const glUser = useGitLab((s) => s.user);
  const summaries = useWorkspaces((s) => s.summaries);
  const summariesLoading = useWorkspaces((s) => s.summariesLoading);
  const wsName = useWorkspaces((s) => s.active()?.name ?? null);
  const paths = useScopePaths();

  const [query, setQuery] = useState('');
  const [hosts, setHosts] = useState<HostId[]>([]);
  const [reasons, setReasons] = useState<LaunchReason[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const now = useNow();

  useEffect(() => {
    ensureGitLabChecked();
    rootRef.current?.focus();
  }, []);

  // Summaries of the repositories in scope (shown from cache at once, refreshed in place).
  const pathKey = paths.map(summaryKey).join('|');
  useEffect(() => {
    if (paths.length) void useWorkspaces.getState().refreshSummaries(paths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathKey]);

  const repoSummaries = useMemo(
    () => paths.map((p) => summaries[summaryKey(p)]).filter((s): s is RepoSummary => !!s),
    [paths, summaries],
  );

  const all = useMemo(() => allItems(items), [items]);
  const filter: ViewFilter = { kinds: [], hosts, reasons, query };
  const filtered = useMemo(
    () => all.filter((i) => matchesFilter(i, filter)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, hosts, reasons, query],
  );

  const wips = useMemo(
    () =>
      wipRows(repoSummaries).filter(
        (s) => !query.trim() || s.name.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [repoSummaries, query],
  );
  const branches = useMemo(
    () =>
      branchRows(repoSummaries).filter(
        (s) => !query.trim() || s.name.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [repoSummaries, query],
  );

  const count = (x: Tab) =>
    x === 'wips'
      ? wips.length
      : x === 'branches'
        ? branches.length
        : itemsFor(x, filtered, prefs, now).length;

  const isRepoTab = tab === 'wips' || tab === 'branches';
  const list = isRepoTab ? [] : itemsFor(tab, filtered, prefs, now);
  const groups = groupItems(list, prefs);
  const visible = groups.flatMap((g) => (collapsed.has(g.group) ? [] : g.items));
  const repoList = tab === 'wips' ? wips : tab === 'branches' ? branches : [];
  const rowCount = isRepoTab ? repoList.length : visible.length;
  const cur = Math.min(cursor, Math.max(0, rowCount - 1));

  const signedIn = !!ghUser || !!glUser;

  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      if (e.key === 'Escape') target.blur();
      return;
    }
    // Not while a dialog or menu has the keyboard.
    if (useUi.getState().prompt || document.querySelector('[role="menu"], [role="dialog"]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const item = isRepoTab ? null : visible[cur];
    const repo = isRepoTab ? repoList[cur] : null;
    const key = e.key;
    if (key === 'j' || key === 'ArrowDown') setCursor(Math.min(rowCount - 1, cur + 1));
    else if (key === 'k' || key === 'ArrowUp') setCursor(Math.max(0, cur - 1));
    else if (key === '/') searchRef.current?.focus();
    else if (key === 'r') void refreshAll();
    else if (key === 'Enter' && item) void openUrl(item.url);
    else if (key === 'Enter' && repo) void openRepo(repo.path);
    else if (key === 'p' && item) useLaunchpad.getState().togglePin(item.id);
    else if (key === 's' && item) {
      if (prefs.snoozed[item.id]) useLaunchpad.getState().unsnooze(item.id);
      else useLaunchpad.getState().snooze(item, now + 24 * HOUR);
    } else if (key === 'm' && item?.kind === 'pr') void merge(item, repoSummaries);
    else if (key === 'b' && item?.kind === 'issue') void createBranch(item, repoSummaries);
    else return;
    e.preventDefault();
  };

  const refreshAll = async () => {
    await Promise.all([
      load(),
      paths.length ? useWorkspaces.getState().refreshSummaries(paths) : Promise.resolve(),
    ]);
  };

  const saveCurrentView = async () => {
    const v = await ask({
      title: t('Save a view'),
      description: t('Saves the current search and filters as a tab of its own.'),
      fields: [{ name: 'name', label: t('Name'), required: true }],
      confirmLabel: t('Save'),
    });
    if (v) saveView(v.name as string, { ...filter, kinds: [] });
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'prs', label: t('My pull requests') },
    { id: 'review', label: t('Review requests') },
    { id: 'issues', label: t('My issues') },
    { id: 'wips', label: t('WIPs') },
    { id: 'branches', label: t('Branches') },
    { id: 'all', label: t('All') },
    { id: 'snoozed', label: t('Snoozed') },
  ];

  const toggle = <T,>(arr: T[], v: T) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const reasonMenu: MenuItem[] = [
    {
      label: t('Everything that involves me'),
      icon: reasons.length === 0 ? <Check className="size-3.5" /> : undefined,
      onSelect: () => setReasons([]),
    },
    'sep',
    ...ALL_REASONS.map((r) => ({
      label: reasonLabel(r),
      icon: reasons.includes(r) ? <Check className="size-3.5" /> : undefined,
      onSelect: () => setReasons(toggle(reasons, r)),
    })),
  ];

  const hostMenu: MenuItem[] = [
    {
      label: t('All hosts'),
      icon: hosts.length === 0 ? <Check className="size-3.5" /> : undefined,
      onSelect: () => setHosts([]),
    },
    'sep',
    ...(['github', 'gitlab'] as HostId[]).map((h) => ({
      label: hostName(h),
      icon: hosts.includes(h) ? <Check className="size-3.5" /> : undefined,
      disabled: h === 'github' ? !ghUser : !glUser,
      onSelect: () => setHosts(toggle(hosts, h)),
    })),
  ];

  const scopeMenu: MenuItem[] = [
    {
      label: wsName ? t('Workspace “{name}”', { name: wsName }) : t('Open tabs'),
      icon: scope === 'workspace' ? <Check className="size-3.5" /> : undefined,
      onSelect: () => setScope('workspace'),
    },
    {
      label: t('Every workspace'),
      icon: scope === 'all' ? <Check className="size-3.5" /> : undefined,
      onSelect: () => setScope('all'),
    },
  ];

  // On the window: menus and dialogs move focus away from the view and do not give it back.
  const keyRef = useRef(onKey);
  useEffect(() => {
    keyRef.current = onKey;
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      // The scrollbar's room is always kept, so the page does not shift sideways between a long
      // list (scrollbar) and a short one (none).
      className="flex h-full min-h-0 flex-col overflow-auto outline-none [scrollbar-gutter:stable]"
    >
      <div className="w-full px-[2.7rem] py-5">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3">
          <Rocket className="size-5 text-accent" />
          <h1 className="text-xl font-semibold">{t('Launchpad')}</h1>
          <span className="text-xs text-muted-foreground">
            {t('Your pull requests, issues and uncommitted work in one place')}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Dropdown items={scopeMenu} align="end">
              <Button title={t('Repositories that WIPs and Branches look at')}>
                <FolderGit2 className="size-4" />
                {scope === 'all'
                  ? t('Every workspace')
                  : wsName
                    ? t('Workspace “{name}”', { name: wsName })
                    : t('Open tabs')}
                <ChevronDown className="size-3.5" />
              </Button>
            </Dropdown>
            <Button onClick={refreshAll} disabled={loading} title={t('Refresh (R)')}>
              {loading || summariesLoading ? (
                <Spinner className="size-4" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {t('Refresh')}
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div role="tablist" className="mt-4 flex flex-wrap items-end gap-1 border-b border-border">
          {tabs.map((x) => (
            <TabButton
              key={x.id}
              active={tab === x.id}
              onClick={() => {
                setTab(x.id);
                setCursor(0);
              }}
              count={count(x.id)}
            >
              {x.label}
            </TabButton>
          ))}
          {prefs.views.map((v) => (
            <TabButton
              key={v.id}
              active={tab === `view:${v.id}`}
              onClick={() => {
                setTab(`view:${v.id}`);
                setCursor(0);
              }}
              count={count(`view:${v.id}`)}
              onRemove={() => deleteView(v.id)}
            >
              {v.name}
            </TabButton>
          ))}
          <button
            type="button"
            onClick={saveCurrentView}
            className="mb-1 ml-1 flex h-7 items-center gap-1 rounded px-2 text-xs text-muted-foreground uppercase hover:bg-surface-hover hover:text-foreground"
          >
            <Plus className="size-3.5" /> {t('Save a view')}
          </button>
        </div>

        {/* Toolbar */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!isRepoTab && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCollapsed(new Set(groups.map((g) => g.group)))}
              >
                <ChevronsDownUp className="size-3.5" /> {t('Collapse all')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set())}>
                <ChevronsUpDown className="size-3.5" /> {t('Expand all')}
              </Button>
            </>
          )}
          <div className="relative min-w-60 flex-1">
            <Search className="absolute top-2 left-2.5 size-3.5 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              placeholder={t('Search (/)')}
              className="h-8 w-full rounded-md border border-border bg-background pr-2 pl-8 outline-none focus:border-accent"
            />
          </div>
          {!isRepoTab && (
            <>
              <Dropdown items={hostMenu}>
                <Button size="sm">
                  {hosts.length === 1 ? hostName(hosts[0]!) : t('All hosts')}
                  <ChevronDown className="size-3.5" />
                </Button>
              </Dropdown>
              <Dropdown items={reasonMenu}>
                <Button size="sm">
                  {reasons.length === 0
                    ? t('Involves me')
                    : reasons.length === 1
                      ? reasonLabel(reasons[0]!)
                      : t('{n} filters', { n: reasons.length })}
                  <ChevronDown className="size-3.5" />
                </Button>
              </Dropdown>
            </>
          )}
        </div>

        {/* Host errors */}
        {!isRepoTab &&
          (Object.entries(errors) as [HostId, string | undefined][])
            .filter(([, e]) => e)
            .map(([h, e]) => (
              <div
                key={h}
                className="mt-3 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs"
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />
                <span>
                  <b>{t('Could not load from {host}', { host: hostName(h) })}</b> {e}
                </span>
              </div>
            ))}

        {/* Body */}
        <div className="mt-3">
          {tab === 'wips' ? (
            <WipTable rows={wips} cursor={cur} onCursor={setCursor} loading={summariesLoading} />
          ) : tab === 'branches' ? (
            <BranchTable
              rows={branches}
              cursor={cur}
              onCursor={setCursor}
              loading={summariesLoading}
            />
          ) : !signedIn ? (
            <ConnectHosts onSignIn={onSignIn} />
          ) : list.length === 0 ? (
            <div className="rounded-lg border border-border px-6 py-10 text-center text-muted-foreground">
              {loading && !all.length ? (
                <Spinner className="mx-auto size-5" />
              ) : tab === 'snoozed' ? (
                t('Nothing is snoozed.')
              ) : (
                t('Nothing here. You are all caught up.')
              )}
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <ItemHeader />
              {groups.map((g) => {
                const closed = collapsed.has(g.group);
                return (
                  <div key={g.group}>
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsed((c) => {
                          const n = new Set(c);
                          if (n.has(g.group)) n.delete(g.group);
                          else n.add(g.group);
                          return n;
                        })
                      }
                      className="flex w-full items-center gap-1.5 border-b border-border bg-surface-muted px-3 py-1.5 text-left text-xs font-semibold text-muted-foreground uppercase hover:text-foreground"
                    >
                      {closed ? (
                        <ChevronRight className="size-3.5" />
                      ) : (
                        <ChevronDown className="size-3.5" />
                      )}
                      {groupLabel(g.group)}
                      <span className="tabular-nums opacity-70">{g.items.length}</span>
                    </button>
                    {!closed &&
                      g.items.map((item) => (
                        <ItemRow
                          key={item.id}
                          item={item}
                          now={now}
                          selected={visible[cur]?.id === item.id}
                          onSelect={() => setCursor(visible.findIndex((x) => x.id === item.id))}
                          repos={repoSummaries}
                        />
                      ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          {t(
            'Keys: J/K move · Enter open · P pin · S snooze a day · M merge · B branch from issue · / search · R refresh',
          )}
        </p>
      </div>
    </div>
  );
}

function TabButton({
  active,
  count,
  onClick,
  onRemove,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  onRemove?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'group relative flex h-9 cursor-default items-center gap-1.5 px-3 text-xs font-medium uppercase',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
      <span
        className={cn(
          // One width for every count, so a tab does not grow when its count gets digits.
          'min-w-8 rounded-full px-1.5 text-center text-[11px] tabular-nums',
          active ? 'bg-accent-soft text-foreground' : 'bg-surface-muted',
        )}
      >
        {count}
      </span>
      {onRemove && (
        <button
          type="button"
          aria-label={t('Delete view')}
          title={t('Delete view')}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="flex size-4 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-surface-hover"
        >
          <X className="size-3" />
        </button>
      )}
      {active && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded bg-accent" />}
    </div>
  );
}

const GRID = 'grid grid-cols-[28px_44px_64px_minmax(0,1fr)_64px_96px_200px_168px] items-center';

function ItemHeader() {
  return (
    <div
      className={cn(
        GRID,
        'border-b border-border px-1 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase',
      )}
    >
      <Pin className="mx-auto size-3.5" aria-label={t('Pinned')} />
      <Clock className="mx-auto size-3.5" aria-label={t('Age')} />
      <span>{t('Status')}</span>
      <span>{t('Item')}</span>
      <span>{t('Author')}</span>
      <span>{t('Collaborators')}</span>
      <span>{t('Repo / branch')}</span>
      <span>{t('Action')}</span>
    </div>
  );
}

function StatusIcons({ item }: { item: LaunchItem }) {
  if (item.kind === 'issue')
    return <CircleDot className="size-4 text-success" aria-label={t('Open issue')} />;
  const ci =
    item.ci === 'success' ? (
      <Check className="size-3.5 text-success" aria-label={t('Checks passed')} />
    ) : item.ci === 'failure' ? (
      <XCircle className="size-3.5 text-danger" aria-label={t('Checks failed')} />
    ) : item.ci === 'pending' ? (
      <span
        className="size-2.5 animate-pulse rounded-full bg-warning"
        aria-label={t('Checks running')}
        title={t('Checks running')}
      />
    ) : null;
  const tip = [
    item.ci === 'success'
      ? t('Checks passed')
      : item.ci === 'failure'
        ? t('Checks failed')
        : item.ci === 'pending'
          ? t('Checks running')
          : null,
    item.mergeable === 'conflicts'
      ? t('Has conflicts')
      : item.mergeable === 'clean'
        ? t('No conflicts')
        : item.mergeable === 'blocked'
          ? t('Merge blocked')
          : null,
    item.review === 'approved'
      ? t('Approved')
      : item.review === 'changesRequested'
        ? t('Changes requested')
        : item.review === 'reviewRequired'
          ? t('Review required')
          : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span className="flex items-center gap-1" title={tip}>
      <GitPullRequest
        className={cn('size-4', item.draft ? 'text-muted-foreground' : 'text-success')}
      />
      {ci}
      {item.mergeable === 'conflicts' && (
        <AlertTriangle className="size-3.5 text-danger" aria-label={t('Has conflicts')} />
      )}
      {item.review === 'approved' && (
        <ThumbsUp className="size-3.5 text-success" aria-label={t('Approved')} />
      )}
      {item.review === 'changesRequested' && (
        <Pencil className="size-3.5 text-warning" aria-label={t('Changes requested')} />
      )}
    </span>
  );
}

function itemMenu(item: LaunchItem, repos: RepoSummary[]): MenuItem[] {
  const st = useLaunchpad.getState();
  const local = localRepoFor(item, repos);
  const pinned = st.prefs.pinned.includes(item.id);
  const snoozed = !!st.prefs.snoozed[item.id];
  const now = Date.now();
  return [
    ...(item.kind === 'pr'
      ? [
          {
            label: t('Merge…'),
            icon: <GitMerge className="size-3.5" />,
            disabled: item.draft,
            onSelect: () => void merge(item, repos),
          },
        ]
      : [
          {
            label: t('Create a branch'),
            icon: <GitBranch className="size-3.5" />,
            onSelect: () => void createBranch(item, repos),
          },
        ]),
    {
      label: local ? t('Open {name}', { name: local.name }) : t('Not cloned in this scope'),
      icon: <FolderGit2 className="size-3.5" />,
      disabled: !local,
      onSelect: () => local && void openRepo(local.path),
    },
    {
      label: t('Copy link'),
      icon: <Copy className="size-3.5" />,
      onSelect: () => void copyText(item.url),
    },
    'sep',
    {
      label: pinned ? t('Unpin') : t('Pin'),
      icon: pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />,
      onSelect: () => st.togglePin(item.id),
    },
    snoozed
      ? {
          label: t('Unsnooze'),
          icon: <BellOff className="size-3.5" />,
          onSelect: () => st.unsnooze(item.id),
        }
      : {
          label: t('Snooze'),
          icon: <BellOff className="size-3.5" />,
          items: [
            { label: t('For an hour'), onSelect: () => st.snooze(item, now + HOUR) },
            { label: t('Until tomorrow'), onSelect: () => st.snooze(item, now + 24 * HOUR) },
            { label: t('For a week'), onSelect: () => st.snooze(item, now + 7 * 24 * HOUR) },
            { label: t('Until it changes'), onSelect: () => st.snooze(item, null) },
          ],
        },
  ];
}

function ItemRow({
  item,
  now,
  selected,
  onSelect,
  repos,
}: {
  item: LaunchItem;
  now: number;
  selected: boolean;
  onSelect: () => void;
  repos: RepoSummary[];
}) {
  const pinned = useLaunchpad((s) => s.prefs.pinned.includes(item.id));
  const togglePin = useLaunchpad((s) => s.togglePin);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const age = ageLabel(item.createdAt || item.updatedAt, now);
  const old = Date.parse(item.updatedAt) < now - 30 * 24 * HOUR;
  return (
    <div
      ref={ref}
      onClick={onSelect}
      aria-selected={selected}
      className={cn(
        GRID,
        'group border-b border-border px-1 py-1.5 last:border-b-0',
        selected ? 'bg-accent-soft' : 'hover:bg-surface-hover',
      )}
    >
      <button
        type="button"
        aria-label={pinned ? t('Unpin') : t('Pin')}
        title={pinned ? t('Unpin') : t('Pin')}
        onClick={(e) => {
          e.stopPropagation();
          togglePin(item.id);
        }}
        className={cn(
          'mx-auto flex size-6 items-center justify-center rounded hover:bg-surface-hover',
          pinned ? 'text-accent' : 'text-muted-foreground opacity-0 group-hover:opacity-100',
        )}
      >
        <Pin className={cn('size-3.5', pinned && 'fill-current')} />
      </button>
      <span
        className={cn(
          'text-center text-xs tabular-nums',
          old ? 'text-danger' : 'text-muted-foreground',
        )}
        title={t('Opened {date}, updated {updated}', {
          date: new Date(item.createdAt).toLocaleString(),
          updated: new Date(item.updatedAt).toLocaleString(),
        })}
      >
        {age}
      </span>
      <StatusIcons item={item} />
      <div className="min-w-0 pr-3">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <button
            type="button"
            onClick={() => void openUrl(item.url)}
            className="truncate text-left hover:underline"
            title={item.title}
          >
            {item.draft && (
              <span className="mr-1 rounded bg-surface-muted px-1 text-[11px] text-muted-foreground">
                {t('Draft')}
              </span>
            )}
            {item.title}
          </button>
          <span className="shrink-0 text-xs text-accent">{refOf(item)}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-0.5" title={t('Comments')}>
            <MessageSquare className="size-3" /> {item.comments}
          </span>
          <span className="flex items-center gap-0.5" title={t('Reactions')}>
            <SmilePlus className="size-3" /> {item.reactions}
          </span>
          {item.reasons.map((r) => (
            <span
              key={r}
              className={cn(
                'rounded-full border px-1.5',
                r === 'reviewRequested' ? 'border-accent text-foreground' : 'border-border',
              )}
            >
              {reasonLabel(r)}
            </span>
          ))}
          {item.labels.map((l) => (
            <span
              key={l.name}
              className="rounded-full px-1.5 text-foreground"
              style={{ background: l.color ? `${l.color}40` : 'var(--color-surface-muted)' }}
            >
              {l.name}
            </span>
          ))}
        </div>
      </div>
      <span title={item.author?.login}>
        {item.author && <Avatar name={item.author.login} url={item.author.avatarUrl} size={24} />}
      </span>
      <span className="flex -space-x-1.5">
        {item.assignees.slice(0, 4).map((p) => (
          <span key={p.login} title={p.login} className="rounded-full ring-2 ring-background">
            <Avatar name={p.login} url={p.avatarUrl || undefined} size={22} />
          </span>
        ))}
      </span>
      <div className="min-w-0 pr-2 text-xs">
        <div className="truncate" title={item.project}>
          {item.project}
        </div>
        {item.kind === 'pr' ? (
          item.headRef && (
            <span
              className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate rounded bg-surface-muted px-1.5 py-px"
              title={`${item.headRef} → ${item.baseRef ?? ''}`}
            >
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate">{item.headRef}</span>
            </span>
          )
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void createBranch(item, repos);
            }}
            className="text-muted-foreground hover:text-foreground hover:underline"
          >
            {t('Create a branch')}
          </button>
        )}
      </div>
      <div className="flex">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void openUrl(item.url);
          }}
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-l-md bg-success/80 px-2 text-xs font-medium text-white hover:bg-success"
        >
          {item.host === 'github' ? (
            <Github className="size-3.5 shrink-0" />
          ) : (
            <ExternalLink className="size-3.5 shrink-0" />
          )}
          <span className="truncate">
            {item.host === 'github' ? t('Open on GitHub') : t('Open on GitLab')}
          </span>
        </button>
        <Dropdown items={itemMenu(item, repos)} align="end">
          <button
            type="button"
            aria-label={t('More actions')}
            onClick={(e) => e.stopPropagation()}
            className="flex h-7 w-7 items-center justify-center rounded-r-md border-l border-black/20 bg-success/80 text-white hover:bg-success"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </Dropdown>
      </div>
    </div>
  );
}

async function merge(item: LaunchItem, repos: RepoSummary[]) {
  if (item.draft) {
    toast('info', t('Drafts cannot be merged'), t('Mark it ready for review first.'));
    return;
  }
  const local = localRepoFor(item, repos);
  let remote: string | null = null;
  if (local) {
    try {
      const refs = await api.refs(local.path);
      const want = item.project.toLowerCase();
      remote =
        refs.remotes.find((r) =>
          item.host === 'github'
            ? !!r.github && `${r.github.owner}/${r.github.repo}`.toLowerCase() === want
            : r.gitlab?.path.toLowerCase() === want,
        )?.name ?? null;
    } catch {
      /* the dialog can still merge on the host */
    }
  }
  await openPullMerge({
    kind: item.host,
    project: item.project,
    number: item.number,
    repo: local?.path ?? null,
    remote,
    url: item.url,
  });
}

async function createBranch(item: LaunchItem, repos: RepoSummary[]) {
  const local = localRepoFor(item, repos);
  if (!local) {
    toast(
      'warning',
      t('{project} is not cloned in this scope', { project: item.project }),
      t('Add its clone to the workspace, or switch the Launchpad to every workspace.'),
    );
    return;
  }
  const v = await ask({
    title: t('Create a branch for {ref}', { ref: refOf(item) }),
    description: t('In {name}, from the checked-out branch ({branch}).', {
      name: local.name,
      branch: local.branch ?? 'HEAD',
    }),
    fields: [
      { name: 'name', label: t('Branch name'), initial: branchNameFor(item), required: true },
      { name: 'checkout', label: t('Check it out'), type: 'checkbox', initial: true },
    ],
    confirmLabel: t('Create branch'),
  });
  if (!v) return;
  const name = (v.name as string).trim();
  try {
    await api.createBranch(local.path, name, undefined, v.checkout as boolean);
    toast('success', t('Created branch {name}', { name }));
    void useWorkspaces.getState().refreshSummaries([local.path]);
    await openRepo(local.path);
  } catch (e) {
    toast('error', t('Could not create the branch'), (e as Error).message);
  }
}

function ConnectHosts({ onSignIn }: { onSignIn: () => void }) {
  const openAccount = useTokens((s) => s.openAccount);
  const soon = [
    'GitHub Enterprise Server',
    'GitLab Self-Managed',
    'Bitbucket',
    'Bitbucket Data Center',
    'Azure DevOps',
  ];
  return (
    <div className="rounded-lg border border-border bg-surface px-8 py-8">
      <h2 className="text-lg font-semibold">{t('No pull requests')}</h2>
      <p className="mt-1 text-muted-foreground">
        {t('Connect a hosting service to see your pull requests and issues here.')}
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={onSignIn}>
          <Github className="size-3.5" /> GitHub
        </Button>
        <Button onClick={() => openAccount('gitlab')}>
          <ExternalLink className="size-3.5" /> GitLab
        </Button>
        {soon.map((s) => (
          <Button key={s} disabled title={t('Coming later')}>
            {s} <span className="text-[10px] text-muted-foreground">{t('Coming later')}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

const REPO_GRID = 'grid grid-cols-[minmax(0,1fr)_220px_168px] items-center';

function RepoAction({ s, primary }: { s: RepoSummary; primary?: ReactNode }) {
  const menu: MenuItem[] = [
    {
      label: t('Open in terminal'),
      icon: <SquareTerminal className="size-3.5" />,
      onSelect: () => void api.openTerminal(s.path),
    },
    {
      label: t('Show in file manager'),
      icon: <FolderOpen className="size-3.5" />,
      onSelect: () => void revealPath(s.path),
    },
    {
      label: t('Copy path'),
      icon: <Copy className="size-3.5" />,
      onSelect: () => void copyText(s.path),
    },
  ];
  return (
    <div className="flex">
      {primary ?? (
        <button
          type="button"
          onClick={() => void openRepo(s.path)}
          className="flex h-7 flex-1 items-center gap-1.5 rounded-l-md bg-success/80 px-2 text-xs font-medium text-white hover:bg-success"
        >
          <FolderGit2 className="size-3.5" /> {t('View repo')}
        </button>
      )}
      <Dropdown items={menu} align="end">
        <button
          type="button"
          aria-label={t('More actions')}
          className="flex h-7 w-7 items-center justify-center rounded-r-md border-l border-black/20 bg-success/80 text-white hover:bg-success"
        >
          <ChevronDown className="size-3.5" />
        </button>
      </Dropdown>
    </div>
  );
}

function BranchChip({ s }: { s: RepoSummary }) {
  return (
    <div className="min-w-0 pr-2 text-xs">
      <div className="truncate" title={s.path}>
        {s.name}
      </div>
      <span className="mt-0.5 inline-flex max-w-full items-center gap-1 rounded bg-surface-muted px-1.5 py-px">
        <GitBranch className="size-3 shrink-0" />
        <span className="truncate">{s.branch ?? t('detached HEAD')}</span>
      </span>
    </div>
  );
}

function RepoRows({
  rows,
  cursor,
  onCursor,
  loading,
  empty,
  render,
}: {
  rows: RepoSummary[];
  cursor: number;
  onCursor: (i: number) => void;
  loading: boolean;
  empty: string;
  render: (s: RepoSummary) => { item: ReactNode; action?: ReactNode };
}) {
  if (rows.length === 0)
    return (
      <div className="rounded-lg border border-border px-6 py-10 text-center text-muted-foreground">
        {loading ? <Spinner className="mx-auto size-5" /> : empty}
      </div>
    );
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div
        className={cn(
          REPO_GRID,
          'border-b border-border px-3 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase',
        )}
      >
        <span>{t('Item')}</span>
        <span>{t('Repo / branch')}</span>
        <span>{t('Action')}</span>
      </div>
      {rows.map((s, i) => {
        const r = render(s);
        return (
          <div
            key={s.path}
            onClick={() => onCursor(i)}
            onDoubleClick={() => void openRepo(s.path)}
            className={cn(
              REPO_GRID,
              'border-b border-border px-3 py-1.5 last:border-b-0',
              i === cursor ? 'bg-accent-soft' : 'hover:bg-surface-hover',
            )}
          >
            <div className="min-w-0 pr-3">{r.item}</div>
            <BranchChip s={s} />
            <RepoAction s={s} primary={r.action} />
          </div>
        );
      })}
    </div>
  );
}

function WipTable(props: {
  rows: RepoSummary[];
  cursor: number;
  onCursor: (i: number) => void;
  loading: boolean;
}) {
  return (
    <RepoRows
      {...props}
      empty={t('No uncommitted work in these repositories.')}
      render={(s) => ({
        item: (
          <>
            <div className="truncate">{t('WIP on {name}', { name: s.name })}</div>
            <div className="mt-0.5 flex items-center gap-2.5 text-[11px] text-muted-foreground">
              {s.wip.modified > 0 && (
                <span className="flex items-center gap-0.5 text-warning" title={t('Modified')}>
                  <Pencil className="size-3" /> {s.wip.modified}
                </span>
              )}
              {s.wip.added > 0 && (
                <span className="text-success" title={t('Added')}>
                  + {s.wip.added}
                </span>
              )}
              {s.wip.deleted > 0 && (
                <span className="text-danger" title={t('Deleted')}>
                  − {s.wip.deleted}
                </span>
              )}
              {s.wip.renamed > 0 && (
                <span className="text-accent" title={t('Renamed')}>
                  → {s.wip.renamed}
                </span>
              )}
              {s.conflicts > 0 && (
                <span className="flex items-center gap-0.5 text-danger">
                  <AlertTriangle className="size-3" /> {t('{n} conflicted', { n: s.conflicts })}
                </span>
              )}
            </div>
          </>
        ),
      })}
    />
  );
}

function BranchTable(props: {
  rows: RepoSummary[];
  cursor: number;
  onCursor: (i: number) => void;
  loading: boolean;
}) {
  const running = useWorkspaces((s) => s.running);
  return (
    <RepoRows
      {...props}
      empty={t('Every checked-out branch is in step with its upstream.')}
      render={(s) => {
        const issue = branchIssue(s);
        const busy = !!running[summaryKey(s.path)];
        return {
          item: (
            <>
              <div className="truncate">{s.name}</div>
              <div className="mt-0.5 flex items-center gap-2.5 text-[11px] text-muted-foreground">
                {s.behind > 0 && (
                  <span className="flex items-center gap-0.5 text-warning">
                    <ArrowDown className="size-3" /> {t('{n} behind', { n: s.behind })}
                  </span>
                )}
                {s.ahead > 0 && (
                  <span className="flex items-center gap-0.5 text-accent">
                    <ArrowUp className="size-3" /> {t('{n} unpushed', { n: s.ahead })}
                  </span>
                )}
                {issue === 'noUpstream' && <span>{t('Never pushed (no upstream)')}</span>}
                {s.upstream && <span className="truncate">→ {s.upstream}</span>}
              </div>
            </>
          ),
          action:
            issue === 'behind' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void useWorkspaces.getState().bulk('pull', [s.path])}
                title={t('Fast-forward only: never creates a merge commit')}
                className="flex h-7 flex-1 items-center gap-1.5 rounded-l-md bg-success/80 px-2 text-xs font-medium text-white hover:bg-success disabled:opacity-60"
              >
                {busy ? <Spinner className="size-3.5" /> : <ArrowDown className="size-3.5" />}
                {t('Pull')}
              </button>
            ) : undefined,
        };
      }}
    />
  );
}

// Launchpad's pure logic: which items each tab shows, pins and snoozes, saved views, the badge
// count, branch names for issues and the WIP / branch rows built from workspace summaries.

import type { LaunchItem, LaunchReason, RepoSummary } from '@/lib/types';

export type HostId = LaunchItem['host'];
export type BuiltinTab = 'prs' | 'review' | 'issues' | 'wips' | 'branches' | 'all' | 'snoozed';
/** A built-in tab or `view:<id>` for a saved view. */
export type Tab = BuiltinTab | `view:${string}`;

export interface Snooze {
  /** Hidden until this time (ms); `null`: until the item changes. */
  until: number | null;
  /** The item's `updatedAt` when snoozed: any newer activity wakes it up. */
  updatedAt: string;
}

export interface ViewFilter {
  kinds: LaunchItem['kind'][];
  hosts: HostId[];
  /** Empty: any reason. */
  reasons: LaunchReason[];
  query: string;
}

export interface SavedView {
  id: string;
  name: string;
  filter: ViewFilter;
}

export interface LaunchPrefs {
  pinned: string[];
  snoozed: Record<string, Snooze>;
  views: SavedView[];
}

export const EMPTY_PREFS: LaunchPrefs = { pinned: [], snoozed: {}, views: [] };

export const ALL_REASONS: LaunchReason[] = ['authored', 'assigned', 'reviewRequested', 'mentioned'];

/** Read stored prefs, dropping anything malformed. */
export function parsePrefs(raw: string | null): LaunchPrefs {
  if (!raw) return EMPTY_PREFS;
  try {
    const v = JSON.parse(raw) as Partial<LaunchPrefs>;
    return {
      pinned: Array.isArray(v.pinned) ? v.pinned.filter((x) => typeof x === 'string') : [],
      snoozed: v.snoozed && typeof v.snoozed === 'object' ? v.snoozed : {},
      views: Array.isArray(v.views) ? v.views.filter((x) => x && x.id && x.filter) : [],
    };
  } catch {
    return EMPTY_PREFS;
  }
}

export function isSnoozed(prefs: LaunchPrefs, item: LaunchItem, now: number): boolean {
  const s = prefs.snoozed[item.id];
  if (!s) return false;
  if (item.updatedAt > s.updatedAt) return false;
  return s.until === null || s.until > now;
}

/** Snoozes that no longer hide anything (expired, or the item is gone or changed). */
export function pruneSnoozes(prefs: LaunchPrefs, items: LaunchItem[], now: number): LaunchPrefs {
  const byId = new Map(items.map((i) => [i.id, i]));
  const snoozed: Record<string, Snooze> = {};
  for (const [id, s] of Object.entries(prefs.snoozed)) {
    const item = byId.get(id);
    if (item && isSnoozed(prefs, item, now)) snoozed[id] = s;
  }
  return Object.keys(snoozed).length === Object.keys(prefs.snoozed).length
    ? prefs
    : { ...prefs, snoozed };
}

export function matchesQuery(item: LaunchItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    item.title,
    item.project,
    `${item.kind === 'pr' && item.host === 'gitlab' ? '!' : '#'}${item.number}`,
    item.author?.login ?? '',
    item.headRef ?? '',
    ...item.labels.map((l) => l.name),
  ]
    .join('\n')
    .toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export function matchesFilter(item: LaunchItem, f: ViewFilter): boolean {
  return (
    (f.kinds.length === 0 || f.kinds.includes(item.kind)) &&
    (f.hosts.length === 0 || f.hosts.includes(item.host)) &&
    (f.reasons.length === 0 || item.reasons.some((r) => f.reasons.includes(r))) &&
    matchesQuery(item, f.query)
  );
}

/** Items of an item tab (not WIPs / branches), pinned first, then newest activity. */
export function itemsFor(
  tab: Tab,
  items: LaunchItem[],
  prefs: LaunchPrefs,
  now: number,
): LaunchItem[] {
  let list: LaunchItem[];
  if (tab === 'snoozed') list = items.filter((i) => isSnoozed(prefs, i, now));
  else {
    const awake = items.filter((i) => !isSnoozed(prefs, i, now));
    if (tab === 'prs') list = awake.filter((i) => i.kind === 'pr');
    else if (tab === 'review') list = awake.filter((i) => i.reasons.includes('reviewRequested'));
    else if (tab === 'issues') list = awake.filter((i) => i.kind === 'issue');
    else if (tab === 'all') list = awake;
    else if (tab.startsWith('view:')) {
      const view = prefs.views.find((v) => `view:${v.id}` === tab);
      list = view ? awake.filter((i) => matchesFilter(i, view.filter)) : [];
    } else list = [];
  }
  const pinned = new Set(prefs.pinned);
  return [...list].sort(
    (a, b) =>
      Number(pinned.has(b.id)) - Number(pinned.has(a.id)) || b.updatedAt.localeCompare(a.updatedAt),
  );
}

/** What needs the user: requests waiting for their review, and items assigned to them. */
export function badgeCount(items: LaunchItem[], prefs: LaunchPrefs, now: number): number {
  return items.filter(
    (i) =>
      !isSnoozed(prefs, i, now) &&
      (i.reasons.includes('reviewRequested') || i.reasons.includes('assigned')),
  ).length;
}

/** Short age like GitKraken's: `5m`, `3h`, `2d`, `4mo`, `1y`. */
export function ageLabel(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

/** A branch name for working on an issue: `123-short-title` (ASCII, diacritics dropped). */
export function branchNameFor(item: Pick<LaunchItem, 'number' | 'title'>): string {
  const slug = item.title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return slug ? `${item.number}-${slug}` : `issue-${item.number}`;
}

/** The workspace repository whose remote is `item`'s project, if one is cloned. */
export function localRepoFor(
  item: Pick<LaunchItem, 'host' | 'project'>,
  summaries: RepoSummary[],
): RepoSummary | null {
  const want = item.project.toLowerCase();
  return (
    summaries.find((s) =>
      item.host === 'github'
        ? !!s.github && `${s.github.owner}/${s.github.repo}`.toLowerCase() === want
        : !!s.gitlab && s.gitlab.path.toLowerCase() === want,
    ) ?? null
  );
}

/** Repositories with uncommitted work. */
export function wipRows(summaries: RepoSummary[]): RepoSummary[] {
  return summaries.filter((s) => !s.error && s.changes > 0);
}

export type BranchIssue = 'behind' | 'ahead' | 'noUpstream' | 'diverged';

/** Why the checked-out branch needs attention, or null when it is in step with its upstream. */
export function branchIssue(s: RepoSummary): BranchIssue | null {
  if (s.error || !s.branch) return null;
  if (!s.upstream) return 'noUpstream';
  if (s.ahead > 0 && s.behind > 0) return 'diverged';
  if (s.behind > 0) return 'behind';
  if (s.ahead > 0) return 'ahead';
  return null;
}

/** Repositories whose checked-out branch is behind, unpushed, diverged or never pushed. */
export function branchRows(summaries: RepoSummary[]): RepoSummary[] {
  return summaries.filter((s) => branchIssue(s) !== null);
}

export type Group = 'pinned' | 'review' | 'attention' | 'ready' | 'waiting' | 'draft' | 'issues';

export const GROUP_ORDER: Group[] = [
  'pinned',
  'review',
  'attention',
  'ready',
  'waiting',
  'draft',
  'issues',
];

/** The section an item is listed under. */
export function groupOf(item: LaunchItem, pinned: boolean): Group {
  if (pinned) return 'pinned';
  if (item.kind === 'issue') return 'issues';
  if (item.reasons.includes('reviewRequested')) return 'review';
  if (item.draft) return 'draft';
  if (item.ci === 'failure' || item.mergeable === 'conflicts' || item.review === 'changesRequested')
    return 'attention';
  if (item.review !== 'reviewRequired' && item.mergeable === 'clean' && item.ci !== 'pending')
    return 'ready';
  return 'waiting';
}

/** `list` split into its non-empty sections, in display order. */
export function groupItems(
  list: LaunchItem[],
  prefs: LaunchPrefs,
): { group: Group; items: LaunchItem[] }[] {
  const pinned = new Set(prefs.pinned);
  const by = new Map<Group, LaunchItem[]>();
  for (const item of list) {
    const g = groupOf(item, pinned.has(item.id));
    by.set(g, [...(by.get(g) ?? []), item]);
  }
  return GROUP_ORDER.filter((g) => by.has(g)).map((group) => ({ group, items: by.get(group)! }));
}

import { describe, expect, it } from 'vitest';

import type { LaunchItem, RepoSummary } from '@/lib/types';
import {
  EMPTY_PREFS,
  ageLabel,
  badgeCount,
  branchIssue,
  branchNameFor,
  branchRows,
  groupItems,
  groupOf,
  isSnoozed,
  itemsFor,
  localRepoFor,
  matchesFilter,
  parsePrefs,
  pruneSnoozes,
  wipRows,
  type LaunchPrefs,
} from './model';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const H = 3600_000;

function item(over: Partial<LaunchItem> = {}): LaunchItem {
  const number = over.number ?? 1;
  return {
    id: `github:acme/web#${number}`,
    host: 'github',
    kind: 'pr',
    project: 'acme/web',
    number,
    title: 'Add login',
    url: `https://github.com/acme/web/pull/${number}`,
    author: { login: 'bob', avatarUrl: '' },
    assignees: [],
    labels: [],
    reasons: ['authored'],
    comments: 0,
    reactions: 0,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-20T00:00:00Z',
    draft: false,
    headRef: 'login',
    baseRef: 'main',
    ci: null,
    mergeable: null,
    review: null,
    ...over,
  };
}

function summary(over: Partial<RepoSummary> = {}): RepoSummary {
  return {
    path: 'C:/src/web',
    name: 'web',
    error: null,
    branch: 'main',
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    changes: 0,
    conflicts: 0,
    state: 'clean',
    lastCommit: null,
    github: { owner: 'acme', repo: 'web' },
    gitlab: null,
    wip: { modified: 0, added: 0, deleted: 0, renamed: 0 },
    ...over,
  };
}

describe('prefs', () => {
  it('parses stored prefs and drops garbage', () => {
    expect(parsePrefs(null)).toEqual(EMPTY_PREFS);
    expect(parsePrefs('not json')).toEqual(EMPTY_PREFS);
    expect(parsePrefs('{"pinned":["a",3],"views":[{"id":"v"},{"id":"w","filter":{}}]}')).toEqual({
      pinned: ['a'],
      snoozed: {},
      views: [{ id: 'w', filter: {} }],
    });
  });

  it('snoozes until a time, or until the item changes', () => {
    const it1 = item();
    const prefs: LaunchPrefs = {
      ...EMPTY_PREFS,
      snoozed: { [it1.id]: { until: NOW + H, updatedAt: it1.updatedAt } },
    };
    expect(isSnoozed(prefs, it1, NOW)).toBe(true);
    expect(isSnoozed(prefs, it1, NOW + 2 * H)).toBe(false);
    // New activity wakes it up early.
    expect(isSnoozed(prefs, { ...it1, updatedAt: '2026-11-21T00:00:00Z' }, NOW)).toBe(false);
    const forever: LaunchPrefs = {
      ...EMPTY_PREFS,
      snoozed: { [it1.id]: { until: null, updatedAt: it1.updatedAt } },
    };
    expect(isSnoozed(forever, it1, NOW + 1000 * H)).toBe(true);
  });

  it('prunes snoozes that hide nothing any more', () => {
    const a = item({ number: 1 });
    const prefs: LaunchPrefs = {
      ...EMPTY_PREFS,
      snoozed: {
        [a.id]: { until: NOW + H, updatedAt: a.updatedAt },
        'github:acme/web#2': { until: null, updatedAt: a.updatedAt },
        'github:acme/web#3': { until: NOW - H, updatedAt: a.updatedAt },
      },
    };
    expect(Object.keys(pruneSnoozes(prefs, [a], NOW).snoozed)).toEqual([a.id]);
    const clean = pruneSnoozes({ ...EMPTY_PREFS }, [a], NOW);
    expect(clean).toEqual(EMPTY_PREFS);
  });
});

describe('tabs', () => {
  const pr = item({ number: 1 });
  const review = item({
    number: 2,
    reasons: ['reviewRequested'],
    updatedAt: '2026-11-21T00:00:00Z',
  });
  const issue = item({ number: 3, kind: 'issue', reasons: ['assigned'] });

  it('splits items by tab and keeps snoozed ones apart', () => {
    const prefs: LaunchPrefs = {
      ...EMPTY_PREFS,
      snoozed: { [pr.id]: { until: null, updatedAt: pr.updatedAt } },
    };
    const all = [pr, review, issue];
    expect(itemsFor('prs', all, prefs, NOW).map((i) => i.number)).toEqual([2]);
    expect(itemsFor('review', all, prefs, NOW).map((i) => i.number)).toEqual([2]);
    expect(itemsFor('issues', all, prefs, NOW).map((i) => i.number)).toEqual([3]);
    expect(itemsFor('all', all, prefs, NOW)).toHaveLength(2);
    expect(itemsFor('snoozed', all, prefs, NOW).map((i) => i.number)).toEqual([1]);
    expect(itemsFor('wips', all, prefs, NOW)).toEqual([]);
  });

  it('lists pinned items first', () => {
    const prefs = { ...EMPTY_PREFS, pinned: [pr.id] };
    expect(itemsFor('prs', [pr, review], prefs, NOW).map((i) => i.number)).toEqual([1, 2]);
  });

  it('applies saved views', () => {
    const prefs: LaunchPrefs = {
      ...EMPTY_PREFS,
      views: [
        { id: 'v1', name: 'Bugs', filter: { kinds: ['issue'], hosts: [], reasons: [], query: '' } },
      ],
    };
    expect(itemsFor('view:v1', [pr, issue], prefs, NOW).map((i) => i.number)).toEqual([3]);
    expect(itemsFor('view:gone', [pr, issue], prefs, NOW)).toEqual([]);
  });

  it('matches search words against title, project, number, author, branch and labels', () => {
    const f = { kinds: [], hosts: [], reasons: [], query: '' };
    const x = item({ labels: [{ name: 'security', color: null }] });
    expect(matchesFilter(x, { ...f, query: 'acme login' })).toBe(true);
    expect(matchesFilter(x, { ...f, query: '#1' })).toBe(true);
    expect(matchesFilter(x, { ...f, query: 'security' })).toBe(true);
    expect(matchesFilter(x, { ...f, query: 'payments' })).toBe(false);
    expect(matchesFilter(x, { ...f, hosts: ['gitlab'] })).toBe(false);
    expect(matchesFilter(x, { ...f, reasons: ['mentioned', 'authored'] })).toBe(true);
    const mr = item({ host: 'gitlab', id: 'gitlab:g/app!4', number: 4 });
    expect(matchesFilter(mr, { ...f, query: '!4' })).toBe(true);
  });

  it('counts what waits for the user in the badge', () => {
    expect(badgeCount([pr, review, issue], EMPTY_PREFS, NOW)).toBe(2);
  });
});

describe('groups', () => {
  it('puts each request in the section that says what to do with it', () => {
    expect(groupOf(item({ reasons: ['reviewRequested'], ci: 'failure' }), false)).toBe('review');
    expect(groupOf(item({ ci: 'failure' }), false)).toBe('attention');
    expect(groupOf(item({ mergeable: 'conflicts' }), false)).toBe('attention');
    expect(groupOf(item({ review: 'changesRequested' }), false)).toBe('attention');
    expect(groupOf(item({ draft: true, ci: 'failure' }), false)).toBe('draft');
    expect(groupOf(item({ mergeable: 'clean', ci: 'success', review: 'approved' }), false)).toBe(
      'ready',
    );
    expect(groupOf(item({ mergeable: 'clean', review: 'reviewRequired' }), false)).toBe('waiting');
    expect(groupOf(item({ mergeable: 'clean', ci: 'pending' }), false)).toBe('waiting');
    expect(groupOf(item({ kind: 'issue' }), false)).toBe('issues');
    expect(groupOf(item({ ci: 'failure' }), true)).toBe('pinned');
  });

  it('orders sections and skips empty ones', () => {
    const a = item({ number: 1, kind: 'issue' });
    const b = item({ number: 2, ci: 'failure' });
    const c = item({ number: 3 });
    const groups = groupItems([a, b, c], { ...EMPTY_PREFS, pinned: [c.id] });
    expect(groups.map((g) => g.group)).toEqual(['pinned', 'attention', 'issues']);
  });
});

describe('helpers', () => {
  it('shows short ages', () => {
    expect(ageLabel('2026-11-21T11:59:30Z', NOW)).toBe('1m');
    expect(ageLabel('2026-11-21T09:00:00Z', NOW)).toBe('3h');
    expect(ageLabel('2026-11-18T12:00:00Z', NOW)).toBe('3d');
    expect(ageLabel('2026-07-01T00:00:00Z', NOW)).toBe('4mo');
    expect(ageLabel('2025-10-01T00:00:00Z', NOW)).toBe('1y');
    expect(ageLabel('', NOW)).toBe('');
  });

  it('makes branch names from issues', () => {
    expect(branchNameFor({ number: 23, title: 'Monitoring with Prometheus & Grafana' })).toBe(
      '23-monitoring-with-prometheus-grafana',
    );
    expect(branchNameFor({ number: 5, title: 'Sửa lỗi đăng nhập' })).toBe('5-sua-loi-dang-nhap');
    expect(branchNameFor({ number: 9, title: '!!!' })).toBe('issue-9');
    expect(branchNameFor({ number: 1, title: 'x'.repeat(80) }).length).toBeLessThanOrEqual(50);
  });

  it('finds the local clone of an item', () => {
    const gh = summary();
    const gl = summary({ path: 'C:/src/app', github: null, gitlab: { path: 'G/Sub/App' } });
    expect(localRepoFor({ host: 'github', project: 'ACME/web' }, [gl, gh])).toBe(gh);
    expect(localRepoFor({ host: 'gitlab', project: 'g/sub/app' }, [gh, gl])).toBe(gl);
    expect(localRepoFor({ host: 'github', project: 'other/x' }, [gh, gl])).toBeNull();
  });

  it('builds WIP and branch rows', () => {
    const dirty = summary({ path: 'a', changes: 3 });
    const broken = summary({ path: 'b', changes: 2, error: 'missing' });
    const behind = summary({ path: 'c', behind: 2 });
    const ahead = summary({ path: 'd', ahead: 1 });
    const both = summary({ path: 'e', ahead: 1, behind: 1 });
    const local = summary({ path: 'f', upstream: null });
    const detached = summary({ path: 'g', branch: null, upstream: null });
    const all = [dirty, broken, behind, ahead, both, local, detached];
    expect(wipRows(all)).toEqual([dirty]);
    expect(branchRows(all).map((s) => s.path)).toEqual(['c', 'd', 'e', 'f']);
    expect(branchIssue(both)).toBe('diverged');
    expect(branchIssue(local)).toBe('noUpstream');
  });
});

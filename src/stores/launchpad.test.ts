import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LaunchItem } from '@/lib/types';

const api = vi.hoisted(() => ({
  launchpadGitHub: vi.fn(),
  launchpadGitLab: vi.fn(),
}));
vi.mock('@/lib/ipc', () => ({ api, isTauri: false }));

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

const { useLaunchpad } = await import('./launchpad');
const { useGitHub } = await import('./github');
const { useGitLab } = await import('./gitlab');

const item = (n: number, host: LaunchItem['host'] = 'github') =>
  ({
    id: `${host}:acme/web#${n}`,
    host,
    kind: 'pr',
    number: n,
    updatedAt: '2026-11-20T00:00:00Z',
    reasons: ['authored'],
  }) as LaunchItem;

beforeEach(() => {
  mem.clear();
  api.launchpadGitHub.mockReset();
  api.launchpadGitLab.mockReset();
  useGitHub.setState({ user: { login: 'octo' } as never });
  useGitLab.setState({ user: null });
  useLaunchpad.setState({
    items: { github: null, gitlab: null },
    errors: {},
    loading: false,
    loadedAt: null,
    prefs: { pinned: [], snoozed: {}, views: [] },
    tab: 'prs',
  });
});

describe('launchpad store', () => {
  it('loads only from hosts the user is signed in to', async () => {
    api.launchpadGitHub.mockResolvedValue([item(1)]);
    await useLaunchpad.getState().load();
    expect(api.launchpadGitLab).not.toHaveBeenCalled();
    expect(useLaunchpad.getState().items).toEqual({ github: [item(1)], gitlab: null });
    expect(useLaunchpad.getState().loading).toBe(false);
  });

  it('keeps the last items of a host that fails, with its error, and keeps snoozes', async () => {
    useGitLab.setState({ user: { login: 'gl' } as never });
    api.launchpadGitHub.mockResolvedValue([item(1)]);
    api.launchpadGitLab.mockResolvedValue([item(2, 'gitlab')]);
    await useLaunchpad.getState().load();
    useLaunchpad.getState().snooze(item(2, 'gitlab'), null);

    api.launchpadGitLab.mockRejectedValue(new Error('GitLab 503: down'));
    await useLaunchpad.getState().load();
    const s = useLaunchpad.getState();
    expect(s.items.gitlab).toEqual([item(2, 'gitlab')]);
    expect(s.errors).toEqual({ gitlab: 'GitLab 503: down' });
    expect(Object.keys(s.prefs.snoozed)).toEqual(['gitlab:acme/web#2']);
  });

  it('persists pins, snoozes and views, and forgets snoozes of items that are gone', async () => {
    const st = useLaunchpad.getState();
    st.togglePin('github:acme/web#1');
    st.snooze(item(3), null);
    const view = st.saveView(' Mine ', { kinds: [], hosts: [], reasons: [], query: 'x' });
    expect(useLaunchpad.getState().tab).toBe(`view:${view.id}`);
    const saved = JSON.parse(mem.get('gitstudio.launchpad')!);
    expect(saved.pinned).toEqual(['github:acme/web#1']);
    expect(saved.views[0].name).toBe('Mine');

    api.launchpadGitHub.mockResolvedValue([item(1)]);
    await useLaunchpad.getState().load();
    expect(useLaunchpad.getState().prefs.snoozed).toEqual({});

    useLaunchpad.getState().deleteView(view.id);
    expect(useLaunchpad.getState().tab).toBe('prs');
    useLaunchpad.getState().togglePin('github:acme/web#1');
    expect(JSON.parse(mem.get('gitstudio.launchpad')!).pinned).toEqual([]);
  });
});

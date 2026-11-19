import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Commit, GitRef } from '@/lib/types';
import {
  DEFAULT_SETTINGS,
  focusTips,
  parseSettings,
  relatedRows,
  resetLayout,
  toggleColumn,
  useColumnSettings,
  type ColumnSettings,
} from './columnSettings';

const ref = (name: string, target: string, extra: Partial<GitRef> = {}): GitRef => ({
  fullName: `refs/heads/${name}`,
  name,
  kind: 'local',
  target,
  isHead: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  upstreamGone: false,
  remote: null,
  ...extra,
});
const remote = (name: string, target: string) =>
  ref(name, target, { kind: 'remote', fullName: `refs/remotes/${name}`, remote: 'origin' });

const commit = (hash: string, parents: string[] = [], extra: Partial<Commit> = {}): Commit => ({
  hash,
  parents,
  authorName: 'A',
  authorEmail: 'a@x',
  authorTime: 0,
  committerName: 'A',
  commitTime: 0,
  subject: hash,
  ...extra,
});

describe('column settings', () => {
  it('defaults to Branch / Tag, Graph and Commit message', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.visible).toEqual(['refs', 'graph', 'message']);
  });

  it('reads stored settings, keeping column order and dropping junk', () => {
    const s = parseSettings(
      JSON.stringify({ visible: ['sha', 'nope', 'refs', 'sha'], compactGraph: true }),
    );
    expect(s).toEqual({ visible: ['refs', 'sha'], compactGraph: true, smartBranches: false });
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ visible: [] })).visible).toEqual(
      DEFAULT_SETTINGS.visible,
    );
  });

  it('carries over the old optional-columns list', () => {
    expect(parseSettings(null, JSON.stringify(['date', 'author'])).visible).toEqual([
      'refs',
      'graph',
      'message',
      'author',
      'date',
    ]);
  });

  it('toggles columns but never hides the last one', () => {
    let s: ColumnSettings = DEFAULT_SETTINGS;
    s = toggleColumn(s, 'sha');
    expect(s.visible).toEqual(['refs', 'graph', 'message', 'sha']);
    s = toggleColumn(toggleColumn(toggleColumn(s, 'refs'), 'graph'), 'message');
    expect(s.visible).toEqual(['sha']);
    expect(toggleColumn(s, 'sha')).toBe(s);
  });

  it('resets to the default or compact layout, keeping Smart Branch Visibility', () => {
    const s: ColumnSettings = { visible: ['sha'], compactGraph: false, smartBranches: true };
    expect(resetLayout(s, false)).toEqual({ ...DEFAULT_SETTINGS, smartBranches: true });
    expect(resetLayout(s, true)).toEqual({
      visible: DEFAULT_SETTINGS.visible,
      compactGraph: true,
      smartBranches: true,
    });
  });

  describe('store', () => {
    beforeEach(() => {
      // Tests run in node: a minimal Storage is enough for the store.
      const data = new Map<string, string>();
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
        removeItem: (k: string) => void data.delete(k),
      });
      useColumnSettings.setState(DEFAULT_SETTINGS);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('persists changes under a gitstudio.* key (mirrored to ui-state.json)', () => {
      localStorage.setItem('gitstudio.columns', '["author"]');
      useColumnSettings.getState().toggle('date');
      useColumnSettings.getState().setSmartBranches(true);
      expect(JSON.parse(localStorage.getItem('gitstudio.graphColumns')!)).toEqual({
        visible: ['refs', 'graph', 'message', 'date'],
        compactGraph: false,
        smartBranches: true,
      });
      expect(localStorage.getItem('gitstudio.columns')).toBeNull();
      useColumnSettings.getState().reset(true);
      expect(useColumnSettings.getState().compactGraph).toBe(true);
      expect(useColumnSettings.getState().visible).toEqual(DEFAULT_SETTINGS.visible);
    });
  });
});

describe('Smart Branch Visibility', () => {
  it('focuses HEAD, its upstream and the base branches', () => {
    const refs = [
      ref('feature/x', 'f2', { isHead: true, upstream: 'origin/feature/x' }),
      remote('origin/feature/x', 'f1'),
      ref('develop', 'd1'),
      remote('origin/main', 'm1'),
      remote('origin/HEAD', 'm1'),
      ref('other', 'o1'),
      remote('origin/other', 'o2'),
      ref('v1', 't1', { kind: 'tag', fullName: 'refs/tags/v1' }),
    ];
    expect(new Set(focusTips(refs, 'f2'))).toEqual(new Set(['f2', 'f1', 'd1', 'm1']));
  });

  it('works with a detached HEAD', () => {
    expect(focusTips([ref('feat', 'x')], 'h')).toEqual(['h']);
  });

  it('keeps rows reachable from the focus tips, and stashes made on them', () => {
    //  o2 ─ o1 ┐            (unrelated branch)
    //  f2 ─ f1 ┼─ b0        (HEAD)
    const commits = [
      commit('o2', ['o1']),
      commit('s', ['f2'], {
        stash: { index: 0, name: '', hash: 's', message: '', time: 0, base: 'f2' },
      }),
      commit('f2', ['f1']),
      commit('o1', ['b0']),
      commit('f1', ['b0']),
      commit('b0'),
    ];
    const rows = relatedRows(commits, ['f2', 'missing']);
    expect([...rows].sort()).toEqual([1, 2, 4, 5]);
  });
});

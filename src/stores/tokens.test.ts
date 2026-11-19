import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TokenKind } from '@/lib/types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-19T10:00:00Z');

const api = vi.hoisted(() => ({
  storedTokens: vi.fn(),
  ghAccount: vi.fn(),
  glAccount: vi.fn(),
}));
vi.mock('@/lib/ipc', () => ({ api, isTauri: false }));

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

const { useTokens } = await import('./tokens');
const { useUi } = await import('./ui');

const user = (expiresAt: string | null, kind: TokenKind = 'fineGrained') => ({
  login: 'octo',
  token: { kind, expiresAt },
});
const at = (ms: number) => new Date(NOW + ms).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mem.clear();
  useTokens.setState({ records: {}, openRequest: null });
  useUi.setState({ toasts: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useTokens', () => {
  it('stores the record and persists it', async () => {
    await useTokens.getState().account('github', user(at(12 * DAY)));
    expect(useTokens.getState().records.github).toMatchObject({
      login: 'octo',
      expiresAt: at(12 * DAY),
    });
    expect(JSON.parse(mem.get('gitstudio.tokens')!)).toHaveProperty('github.login', 'octo');
    expect(useUi.getState().toasts).toHaveLength(0);
  });

  it('warns once per day when the token expires soon', async () => {
    await useTokens.getState().account('github', user(at(3 * DAY)));
    await useTokens.getState().account('github', user(at(3 * DAY)));
    const toasts = useUi.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ kind: 'warning', title: 'Your GitHub token expires soon' });
    expect(toasts[0]!.actions?.map((a) => a.label)).toEqual(['Renew token', 'Account settings']);

    vi.setSystemTime(NOW + DAY);
    await useTokens.getState().account('github', user(at(3 * DAY)));
    expect(useUi.getState().toasts).toHaveLength(2);
  });

  it('does not warn about browser sign-ins without a date', async () => {
    await useTokens
      .getState()
      .account('github', { login: 'octo', token: { kind: 'oauth', expiresAt: null } });
    expect(useUi.getState().toasts).toHaveLength(0);
  });

  it('keeps an expired token that the host now rejects, and says so', async () => {
    useTokens.setState({
      records: {
        github: {
          provider: 'github',
          host: 'github.com',
          login: 'octo',
          kind: 'pat',
          expiresAt: at(-DAY),
          checkedAt: NOW - 2 * DAY,
        },
      },
    });
    api.storedTokens.mockResolvedValue({ github: true, gitlab: false });
    await useTokens.getState().account('github', null);
    expect(useTokens.getState().records.github?.expiresAt).toBe(at(-DAY));
    expect(useUi.getState().toasts[0]).toMatchObject({
      kind: 'error',
      title: 'Your GitHub token has expired',
    });
  });

  it('forgets the record once no token is stored, or on sign-out', async () => {
    await useTokens.getState().account('gitlab', user(at(-DAY), 'pat'));
    api.storedTokens.mockResolvedValue({ github: false, gitlab: false });
    await useTokens.getState().account('gitlab', null);
    expect(useTokens.getState().records.gitlab).toBeUndefined();

    await useTokens.getState().account('github', user(at(20 * DAY)));
    useTokens.getState().clear('github');
    expect(useTokens.getState().records).toEqual({});
  });

  it('refreshes only records older than the given age, and survives being offline', async () => {
    await useTokens.getState().account('github', user(at(20 * DAY)));
    api.ghAccount.mockResolvedValue(user(at(19 * DAY)));
    await useTokens.getState().refresh(60_000);
    expect(api.ghAccount).not.toHaveBeenCalled();

    vi.setSystemTime(NOW + 2 * 60_000);
    await useTokens.getState().refresh(60_000);
    expect(useTokens.getState().records.github?.expiresAt).toBe(at(19 * DAY));

    api.ghAccount.mockRejectedValue(new Error('offline'));
    await useTokens.getState().refresh();
    expect(useTokens.getState().records.github?.expiresAt).toBe(at(19 * DAY));
  });

  it('asks for the account page with a fresh request each time', () => {
    useTokens.getState().openAccount('gitlab');
    const first = useTokens.getState().openRequest;
    useTokens.getState().openAccount('gitlab');
    expect(first).toEqual({ provider: 'gitlab', n: 1 });
    expect(useTokens.getState().openRequest).toEqual({ provider: 'gitlab', n: 2 });
  });
});

import { create } from 'zustand';

import {
  dayKey,
  isShown,
  keepAfterRejected,
  recordFrom,
  shouldWarn,
  tokenSettingsUrl,
  tokenState,
  warnKey,
  type TokenProvider,
  type TokenRecord,
} from '@/features/tokens/expiry';
import { t, useLangStore } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { openUrl } from '@/lib/native';
import type { TokenInfo } from '@/lib/types';
import { notify } from './ui';

// Token kind + expiry per signed-in account (never the token). Kept in localStorage (mirrored to
// ui-state.json) so the status bar still knows the date offline, or after the host starts
// rejecting an expired token.
const KEY = 'gitstudio.tokens';
const WARNED_KEY = 'gitstudio.tokenWarned';

type Records = Partial<Record<TokenProvider, TokenRecord>>;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

interface Account {
  login: string;
  token?: TokenInfo;
}

interface TokenStore {
  records: Records;
  /** Asks App to open Preferences → Integrations at this provider (`n` makes each ask new). */
  openRequest: { provider: TokenProvider; n: number } | null;
  /** The host's answer for the stored token: an account, or `null` (no token / rejected). */
  account: (provider: TokenProvider, user: Account | null) => Promise<void>;
  /** Signed out: forget the record. */
  clear: (provider: TokenProvider) => void;
  /** Ask the hosts again for records older than `minAgeMs` (failures keep what we have). */
  refresh: (minAgeMs?: number) => Promise<void>;
  openAccount: (provider: TokenProvider) => void;
}

const ACCOUNT_CALL = { github: () => api.ghAccount(), gitlab: () => api.glAccount() };

export const useTokens = create<TokenStore>((set, get) => {
  const put = (provider: TokenProvider, rec: TokenRecord | undefined) => {
    const records = { ...get().records };
    if (rec) records[provider] = rec;
    else delete records[provider];
    write(KEY, records);
    set({ records });
  };

  return {
    records: read<Records>(KEY, {}),
    openRequest: null,

    account: async (provider, user) => {
      const now = Date.now();
      if (user) {
        put(provider, recordFrom(provider, user, now));
      } else {
        const stored = await api.storedTokens().then(
          (r) => r[provider],
          () => null,
        );
        if (stored === null) return; // backend unavailable: keep what we know
        put(provider, keepAfterRejected(get().records[provider], stored, now));
      }
      const rec = get().records[provider];
      if (rec) warnOnce(rec, now);
    },

    clear: (provider) => put(provider, undefined),

    refresh: async (minAgeMs = 0) => {
      const now = Date.now();
      await Promise.all(
        (Object.values(get().records) as TokenRecord[])
          .filter((r) => now - r.checkedAt >= minAgeMs)
          .map(async (r) => {
            try {
              await get().account(r.provider, await ACCOUNT_CALL[r.provider]());
            } catch {
              /* offline: keep the record */
            }
          }),
      );
    },

    openAccount: (provider) =>
      set((s) => ({ openRequest: { provider, n: (s.openRequest?.n ?? 0) + 1 } })),
  };
});

/** Toast once per day per account when its token expires within WARN_DAYS or has expired. */
function warnOnce(rec: TokenRecord, now: number) {
  if (!isShown(rec)) return;
  const warned = read<Record<string, string>>(WARNED_KEY, {});
  if (!shouldWarn(rec, now, warned)) return;
  write(WARNED_KEY, { ...warned, [warnKey(rec)]: dayKey(now) });
  const host = rec.provider === 'github' ? 'GitHub' : 'GitLab';
  const expired = tokenState(rec.expiresAt, now) === 'expired';
  const date = rec.expiresAt ? formatExpiry(rec.expiresAt) : '';
  notify({
    kind: expired ? 'error' : 'warning',
    title: expired
      ? t('Your {host} token has expired', { host })
      : t('Your {host} token expires soon', { host }),
    detail: expired
      ? t('The token for @{login} expired on {date}. Create a new token and sign in again.', {
          login: rec.login,
          date,
        })
      : t('The token for @{login} expires on {date}. Renew it to keep pulling and pushing.', {
          login: rec.login,
          date,
        }),
    actions: [
      { label: t('Renew token'), run: () => void openUrl(tokenSettingsUrl(rec)) },
      { label: t('Account settings'), run: () => useTokens.getState().openAccount(rec.provider) },
    ],
  });
}

/** Exact local date and time of an expiry, in the UI language. */
export function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(useLangStore.getState().lang === 'vi' ? 'vi-VN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

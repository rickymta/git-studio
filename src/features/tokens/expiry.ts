// Pure logic behind the token-expiry indicator and warning (no React, no stores).

import { t } from '@/lib/i18n';
import type { TokenKind } from '@/lib/types';

export type TokenProvider = 'github' | 'gitlab';

/** What GitStudio remembers about a signed-in account's token (see stores/tokens). */
export interface TokenRecord {
  provider: TokenProvider;
  host: string;
  login: string;
  kind: TokenKind;
  /** RFC 3339; null = no expiry date. */
  expiresAt: string | null;
  /** When the host was last asked (ms). */
  checkedAt: number;
}

export type TokenState = 'ok' | 'warning' | 'expired' | 'never';

/** Warn when this many days or fewer are left. */
export const WARN_DAYS = 7;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Milliseconds until `expiresAt` (negative once expired); null without a (valid) date. */
export function msLeft(expiresAt: string | null, now: number): number | null {
  if (!expiresAt) return null;
  const at = Date.parse(expiresAt);
  return Number.isNaN(at) ? null : at - now;
}

export function tokenState(expiresAt: string | null, now: number): TokenState {
  const ms = msLeft(expiresAt, now);
  if (ms === null) return 'never';
  if (ms <= 0) return 'expired';
  return ms <= WARN_DAYS * DAY ? 'warning' : 'ok';
}

/** Whole units left, largest unit that is at least 1 (days, then hours, then minutes). */
export function timeLeft(ms: number): { unit: 'day' | 'hour' | 'minute'; n: number } {
  if (ms >= DAY) return { unit: 'day', n: Math.floor(ms / DAY) };
  if (ms >= HOUR) return { unit: 'hour', n: Math.floor(ms / HOUR) };
  return { unit: 'minute', n: Math.max(1, Math.ceil(ms / MINUTE)) };
}

/** "12 days left", "5 hours left", "Expired", "No expiry". */
export function leftLabel(expiresAt: string | null, now: number): string {
  const ms = msLeft(expiresAt, now);
  if (ms === null) return t('No expiry');
  if (ms <= 0) return t('Expired');
  const { unit, n } = timeLeft(ms);
  if (unit === 'day') return n === 1 ? t('1 day left') : t('{n} days left', { n });
  if (unit === 'hour') return n === 1 ? t('1 hour left') : t('{n} hours left', { n });
  return n === 1 ? t('1 minute left') : t('{n} minutes left', { n });
}

/**
 * Only tokens the user made themselves are worth showing: anything with a date, plus access
 * tokens without one ("no expiry"). Browser sign-ins have no expiry to speak of, so stay hidden.
 */
export function isShown(rec: TokenRecord): boolean {
  return !!rec.expiresAt || rec.kind === 'pat' || rec.kind === 'fineGrained';
}

/** Local calendar day, for "at most one warning per day". */
export function dayKey(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const warnKey = (rec: Pick<TokenRecord, 'provider' | 'login'>) =>
  `${rec.provider}:${rec.login}`;

/** Expiring soon or expired, and not warned about today. */
export function shouldWarn(
  rec: TokenRecord,
  now: number,
  warned: Record<string, string | undefined>,
): boolean {
  const s = tokenState(rec.expiresAt, now);
  return (s === 'warning' || s === 'expired') && warned[warnKey(rec)] !== dayKey(now);
}

/** Where the user renews the token. */
export function tokenSettingsUrl(rec: Pick<TokenRecord, 'provider' | 'host' | 'kind'>): string {
  if (rec.provider === 'gitlab')
    return `https://${rec.host}/-/user_settings/personal_access_tokens`;
  return rec.kind === 'fineGrained'
    ? `https://${rec.host}/settings/personal-access-tokens`
    : `https://${rec.host}/settings/tokens`;
}

/** The record to keep after asking the host about the account. */
export function recordFrom(
  provider: TokenProvider,
  user: {
    login: string;
    token?: { kind: TokenKind; expiresAt: string | null; expiryUnknown?: boolean };
  },
  now: number,
  /** The record we had; its date is kept when the host could not say this time. */
  prev?: TokenRecord,
): TokenRecord {
  const kind = user.token?.kind ?? 'unknown';
  const keepPrev = !!user.token?.expiryUnknown && prev?.login === user.login && prev.kind === kind;
  return {
    provider,
    host: provider === 'github' ? 'github.com' : 'gitlab.com',
    login: user.login,
    kind,
    expiresAt: keepPrev ? prev.expiresAt : (user.token?.expiresAt ?? null),
    checkedAt: now,
  };
}

/**
 * The host answered "not signed in" (`null` account). Keep an expired record so the status bar
 * can say the token expired, as long as the token is still stored; drop it otherwise (signed out,
 * or a token revoked before its date).
 */
export function keepAfterRejected(
  rec: TokenRecord | undefined,
  tokenStored: boolean,
  now: number,
): TokenRecord | undefined {
  if (!rec || !tokenStored) return undefined;
  return tokenState(rec.expiresAt, now) === 'expired' ? rec : undefined;
}

/** Most urgent first: expired, then fewest days left; "no expiry" last. */
export function byUrgency(a: TokenRecord, b: TokenRecord, now: number): number {
  const ma = msLeft(a.expiresAt, now) ?? Infinity;
  const mb = msLeft(b.expiresAt, now) ?? Infinity;
  return ma === mb ? 0 : ma < mb ? -1 : 1;
}

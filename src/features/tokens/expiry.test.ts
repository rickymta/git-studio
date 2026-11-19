import { describe, expect, it } from 'vitest';

import {
  WARN_DAYS,
  byUrgency,
  dayKey,
  isShown,
  keepAfterRejected,
  leftLabel,
  msLeft,
  recordFrom,
  shouldWarn,
  timeLeft,
  tokenSettingsUrl,
  tokenState,
  type TokenRecord,
} from './expiry';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-19T10:00:00Z');
const at = (ms: number) => new Date(NOW + ms).toISOString();

const rec = (over: Partial<TokenRecord> = {}): TokenRecord => ({
  provider: 'github',
  host: 'github.com',
  login: 'octo',
  kind: 'fineGrained',
  expiresAt: at(12 * DAY),
  checkedAt: NOW,
  ...over,
});

describe('msLeft / tokenState', () => {
  it('has no time left without a valid date', () => {
    expect(msLeft(null, NOW)).toBeNull();
    expect(msLeft('not a date', NOW)).toBeNull();
    expect(tokenState(null, NOW)).toBe('never');
  });

  it('reads offsets as well as UTC', () => {
    expect(msLeft('2026-11-19T17:00:00+07:00', NOW)).toBe(0);
  });

  it('is ok beyond the warning window, warning inside it, expired at the date', () => {
    expect(tokenState(at(12 * DAY), NOW)).toBe('ok');
    expect(tokenState(at(WARN_DAYS * DAY + MIN), NOW)).toBe('ok');
    expect(tokenState(at(WARN_DAYS * DAY), NOW)).toBe('warning');
    expect(tokenState(at(HOUR), NOW)).toBe('warning');
    expect(tokenState(at(0), NOW)).toBe('expired');
    expect(tokenState(at(-DAY), NOW)).toBe('expired');
  });
});

describe('timeLeft / leftLabel', () => {
  it('uses the largest whole unit', () => {
    expect(timeLeft(12 * DAY + 5 * HOUR)).toEqual({ unit: 'day', n: 12 });
    expect(timeLeft(DAY)).toEqual({ unit: 'day', n: 1 });
    expect(timeLeft(DAY - 1)).toEqual({ unit: 'hour', n: 23 });
    expect(timeLeft(59 * MIN + 1)).toEqual({ unit: 'minute', n: 60 });
    expect(timeLeft(1)).toEqual({ unit: 'minute', n: 1 });
  });

  it('labels each state', () => {
    expect(leftLabel(at(12 * DAY + HOUR), NOW)).toBe('12 days left');
    expect(leftLabel(at(DAY + HOUR), NOW)).toBe('1 day left');
    expect(leftLabel(at(5 * HOUR), NOW)).toBe('5 hours left');
    expect(leftLabel(at(HOUR), NOW)).toBe('1 hour left');
    expect(leftLabel(at(30 * MIN), NOW)).toBe('30 minutes left');
    expect(leftLabel(at(20_000), NOW)).toBe('1 minute left');
    expect(leftLabel(at(-MIN), NOW)).toBe('Expired');
    expect(leftLabel(null, NOW)).toBe('No expiry');
  });
});

describe('isShown', () => {
  it('shows dated tokens and access tokens without a date, hides browser sign-ins', () => {
    expect(isShown(rec())).toBe(true);
    expect(isShown(rec({ kind: 'oauth', expiresAt: at(8 * HOUR) }))).toBe(true);
    expect(isShown(rec({ kind: 'pat', expiresAt: null }))).toBe(true);
    expect(isShown(rec({ kind: 'fineGrained', expiresAt: null }))).toBe(true);
    expect(isShown(rec({ kind: 'oauth', expiresAt: null }))).toBe(false);
    expect(isShown(rec({ kind: 'unknown', expiresAt: null }))).toBe(false);
  });
});

describe('shouldWarn', () => {
  it('warns only when close to or past expiry', () => {
    expect(shouldWarn(rec({ expiresAt: at(12 * DAY) }), NOW, {})).toBe(false);
    expect(shouldWarn(rec({ expiresAt: null, kind: 'pat' }), NOW, {})).toBe(false);
    expect(shouldWarn(rec({ expiresAt: at(3 * DAY) }), NOW, {})).toBe(true);
    expect(shouldWarn(rec({ expiresAt: at(-DAY) }), NOW, {})).toBe(true);
  });

  it('at most once per day per account', () => {
    const r = rec({ expiresAt: at(3 * DAY) });
    const today = { 'github:octo': dayKey(NOW) };
    expect(shouldWarn(r, NOW, today)).toBe(false);
    expect(shouldWarn(r, NOW + DAY, today)).toBe(true);
    expect(shouldWarn({ ...r, login: 'other' }, NOW, today)).toBe(true);
    expect(shouldWarn({ ...r, provider: 'gitlab' }, NOW, today)).toBe(true);
  });

  it('keys days by the local calendar', () => {
    const d = new Date(2026, 0, 5, 23, 59);
    expect(dayKey(d.getTime())).toBe('2026-01-05');
  });
});

describe('tokenSettingsUrl', () => {
  it('points at the right page for each host and kind', () => {
    expect(tokenSettingsUrl(rec({ kind: 'pat' }))).toBe('https://github.com/settings/tokens');
    expect(tokenSettingsUrl(rec({ kind: 'fineGrained' }))).toBe(
      'https://github.com/settings/personal-access-tokens',
    );
    expect(tokenSettingsUrl(rec({ provider: 'gitlab', host: 'gitlab.com', kind: 'pat' }))).toBe(
      'https://gitlab.com/-/user_settings/personal_access_tokens',
    );
  });
});

describe('recordFrom / keepAfterRejected', () => {
  it('builds a record from the account the host returned', () => {
    expect(
      recordFrom(
        'gitlab',
        { login: 'me', token: { kind: 'pat', expiresAt: '2026-12-01T00:00:00Z' } },
        NOW,
      ),
    ).toEqual({
      provider: 'gitlab',
      host: 'gitlab.com',
      login: 'me',
      kind: 'pat',
      expiresAt: '2026-12-01T00:00:00Z',
      checkedAt: NOW,
    });
    expect(recordFrom('github', { login: 'me' }, NOW)).toMatchObject({
      kind: 'unknown',
      expiresAt: null,
    });
  });

  it('keeps the known date when the host could not say this time', () => {
    const prev = recordFrom(
      'gitlab',
      { login: 'me', token: { kind: 'pat', expiresAt: '2026-12-01T00:00:00Z' } },
      NOW - HOUR,
    );
    const failed = {
      login: 'me',
      token: { kind: 'pat' as const, expiresAt: null, expiryUnknown: true },
    };
    expect(recordFrom('gitlab', failed, NOW, prev)).toMatchObject({
      expiresAt: '2026-12-01T00:00:00Z',
      checkedAt: NOW,
    });
    // A different account (or a real "no expiry" answer) does not inherit the old date.
    expect(recordFrom('gitlab', { ...failed, login: 'other' }, NOW, prev).expiresAt).toBeNull();
    const noExpiry = { login: 'me', token: { kind: 'pat' as const, expiresAt: null } };
    expect(recordFrom('gitlab', noExpiry, NOW, prev).expiresAt).toBeNull();
  });

  it('keeps an expired record while the token is still stored, drops the rest', () => {
    const expired = rec({ expiresAt: at(-HOUR) });
    expect(keepAfterRejected(expired, true, NOW)).toBe(expired);
    expect(keepAfterRejected(expired, false, NOW)).toBeUndefined();
    // Rejected before its date: revoked, not expired.
    expect(keepAfterRejected(rec(), true, NOW)).toBeUndefined();
    expect(keepAfterRejected(undefined, true, NOW)).toBeUndefined();
  });
});

describe('byUrgency', () => {
  it('puts expired first and no-expiry last', () => {
    const list = [
      rec({ provider: 'gitlab', expiresAt: null, kind: 'pat' }),
      rec({ expiresAt: at(30 * DAY) }),
      rec({ expiresAt: at(-DAY) }),
      rec({ expiresAt: at(2 * DAY) }),
    ];
    const sorted = [...list].sort((a, b) => byUrgency(a, b, NOW)).map((r) => r.expiresAt);
    expect(sorted).toEqual([at(-DAY), at(2 * DAY), at(30 * DAY), null]);
    expect(byUrgency(list[0]!, list[0]!, NOW)).toBe(0);
  });
});

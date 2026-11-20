import { KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { formatExpiry, useTokens } from '@/stores/tokens';
import { byUrgency, isShown, leftLabel, tokenState, type TokenRecord } from './expiry';

/** Ask the hosts again this often while the app stays open. */
const REFRESH_MS = 6 * 60 * 60 * 1000;

// Amber / red stay on hover (underline instead), so the warning never disappears under the pointer.
const STATE_CLASS = {
  ok: 'hover:text-foreground',
  never: 'opacity-70 hover:text-foreground hover:opacity-100',
  warning: 'text-warning hover:underline',
  expired: 'font-medium text-danger hover:underline',
} as const;

/**
 * Status-bar indicator of how long the signed-in GitHub / GitLab token has left. Amber within
 * WARN_DAYS, red once expired; click opens the account in Preferences → Integrations.
 */
export function TokenExpiry() {
  const records = useTokens((s) => s.records);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    const refresh = setInterval(() => void useTokens.getState().refresh(REFRESH_MS), REFRESH_MS);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, []);

  const shown = (Object.values(records) as TokenRecord[])
    .filter(isShown)
    .sort((a, b) => byUrgency(a, b, now));
  if (!shown.length) return null;

  return (
    <>
      {shown.map((rec) => (
        <TokenItem key={rec.provider} rec={rec} now={now} />
      ))}
    </>
  );
}

function TokenItem({ rec, now }: { rec: TokenRecord; now: number }) {
  const state = tokenState(rec.expiresAt, now);
  const host = rec.provider === 'github' ? 'GitHub' : 'GitLab';
  const tip = [
    `${host} · @${rec.login} · ${rec.host}`,
    rec.expiresAt
      ? state === 'expired'
        ? t('Token expired on {date}', { date: formatExpiry(rec.expiresAt) })
        : t('Token expires on {date}', { date: formatExpiry(rec.expiresAt) })
      : t('This token has no expiry date'),
    t('Click to open account settings'),
  ].join('\n');

  return (
    <button
      type="button"
      title={tip}
      aria-label={tip}
      onClick={() => useTokens.getState().openAccount(rec.provider)}
      className={cn('flex h-full shrink-0 items-center gap-[6.3px] px-[4.5px]', STATE_CLASS[state])}
    >
      <KeyRound className="size-[15.3px]" />
      {state === 'never'
        ? null
        : state === 'expired'
          ? t('Token expired')
          : t('Token: {left}', { left: leftLabel(rec.expiresAt, now) })}
    </button>
  );
}

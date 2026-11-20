import { useEffect, useState } from 'react';

import { gravatarHash, gravatarUrl, hasFailed, knownHash, markFailed } from '@/lib/gravatar';
import { useRepo } from '@/stores/repo';

/**
 * Gravatar picture URL for `email` at `size` px, or `null` (setting off, no email, no picture
 * known to exist). `fail` drops the picture after a load error so the initials show again.
 */
export function useGravatar(email: string | null | undefined, size: number) {
  const enabled = useRepo((s) => s.settings?.gravatar ?? true);
  // The hash is kept with the email it belongs to, so a reused component never shows the
  // previous author's picture while the new hash is worked out.
  const [found, setFound] = useState<{ email: string; hash: string | null } | null>(null);
  const [, setFailures] = useState(0);
  const want = enabled && email ? email : null;

  useEffect(() => {
    if (!want || knownHash(want)) return;
    let live = true;
    void gravatarHash(want).then((hash) => live && setFound({ email: want, hash }));
    return () => {
      live = false;
    };
  }, [want]);

  const hash = want ? (knownHash(want) ?? (found?.email === want ? found.hash : null)) : null;
  const url = hash ? gravatarUrl(hash, size) : null;
  return {
    url: url && !hasFailed(url) ? url : null,
    fail: () => {
      if (!url) return;
      markFailed(url);
      setFailures((n) => n + 1);
    },
  };
}

import { Crosshair } from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/ui';
import { short } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { useBisect } from '@/stores/bisect';
import { useRepo } from '@/stores/repo';
import * as R from '../repoTools';

/** While bisecting: what is left, and Good / Bad / Skip for the checked-out commit. */
export function BisectBanner() {
  const path = useRepo((s) => s.path);
  const info = useRepo((s) => s.info);
  const commits = useRepo((s) => s.commits);
  const store = useBisect();

  useEffect(() => {
    if (!path) return;
    let live = true;
    api
      .bisectState(path)
      .then((st) => live && useBisect.getState().set(path, st))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [path, info]);

  const st = store.path === path ? store.state : null;
  if (!st?.active) return null;
  const subject = (hash: string | null) =>
    hash ? (commits.find((c) => c.hash === hash)?.subject ?? '') : '';

  let text: string;
  if (st.firstBad)
    text = t('Found it: {hash} "{subject}" is the first bad commit.', {
      hash: short(st.firstBad),
      subject: subject(st.firstBad),
    });
  else if (!st.bad || st.good.length === 0)
    text = st.bad
      ? t('Bisecting: mark a commit that works (good) to start the search.')
      : t('Bisecting: mark a commit that has the problem (bad) to start the search.');
  else
    text = t('Bisecting: testing {hash}. About {n} revision(s) left (~{steps} step(s)).', {
      hash: st.current ? short(st.current) : '?',
      n: st.remaining ?? 0,
      steps: st.steps ?? 0,
    });

  const searching = !st.firstBad && !!st.bad && st.good.length > 0;
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-accent/40 bg-accent-soft px-4 py-2">
      <Crosshair className="size-4 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate" title={text}>
        {text}
      </span>
      {st.firstBad ? (
        <Button size="sm" onClick={() => void useRepo.getState().reveal(st.firstBad!)}>
          {t('Show commit')}
        </Button>
      ) : (
        <>
          <Button size="sm" onClick={() => void R.bisectMark('good')}>
            {t('Good')}
          </Button>
          <Button size="sm" onClick={() => void R.bisectMark('bad')}>
            {t('Bad')}
          </Button>
          {searching && (
            <Button size="sm" variant="ghost" onClick={() => void R.bisectMark('skip')}>
              {t('Skip')}
            </Button>
          )}
        </>
      )}
      <Button
        size="sm"
        variant={st.firstBad ? 'primary' : 'default'}
        onClick={() => void R.bisectReset()}
      >
        {t('End bisect')}
      </Button>
    </div>
  );
}

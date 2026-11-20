import { Avatar, Spinner } from '@/components/ui';
import { relativeTime, short } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useRepo } from '@/stores/repo';
import { SEARCH_LIMIT, type GitSearchResult } from './gitSearch';

/** The commits git found, under the search box; picking one shows it in the graph. */
export function SearchResults({ result, onPick }: { result: GitSearchResult; onPick: () => void }) {
  const reveal = useRepo((s) => s.reveal);
  const loaded = useRepo((s) => s.commits);
  const inGraph = new Set(loaded.map((c) => c.hash));
  const list = result.commits;
  return (
    <div className="absolute top-full right-2 z-40 mt-1 max-h-[50vh] w-[480px] max-w-[calc(100%-16px)] overflow-auto rounded-md border border-border bg-surface py-1 shadow-xl">
      {!list ? (
        <div className="flex justify-center p-3">
          <Spinner className="text-muted-foreground" />
        </div>
      ) : result.error ? (
        <div className="px-3 py-2 text-xs text-danger">{result.error}</div>
      ) : list.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">{t('No commits found')}</div>
      ) : (
        <>
          <div className="px-3 pb-1 text-[11px] text-muted-foreground">
            {list.length >= SEARCH_LIMIT
              ? t('First {n} commits found', { n: list.length })
              : t('{n} commit(s) found', { n: list.length })}
          </div>
          {list.map((c) => (
            <button
              key={c.hash}
              type="button"
              onClick={() => {
                onPick();
                void reveal(c.hash);
              }}
              title={inGraph.has(c.hash) ? undefined : t('Not loaded in the graph yet')}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-surface-hover"
            >
              <Avatar name={c.authorName} email={c.authorEmail} size={16} />
              <span
                className={
                  inGraph.has(c.hash) ? 'min-w-0 flex-1 truncate' : 'min-w-0 flex-1 truncate italic'
                }
              >
                {c.subject}
              </span>
              <span className="shrink-0 text-muted-foreground">{relativeTime(c.authorTime)}</span>
              <span className="shrink-0 font-mono text-muted-foreground">{short(c.hash)}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

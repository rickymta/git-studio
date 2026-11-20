import { useEffect, useState } from 'react';

import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { Commit, CommitSearch } from '@/lib/types';
import { useRepo } from '@/stores/repo';

/** `loaded`: the quick filter over the commits in the graph; the others ask git. */
export type SearchMode = 'loaded' | keyof CommitSearch;

export const SEARCH_MODES: { value: SearchMode; label: () => string }[] = [
  { value: 'loaded', label: () => t('Loaded commits') },
  { value: 'message', label: () => t('Message (all history)') },
  { value: 'author', label: () => t('Author (all history)') },
  { value: 'content', label: () => t('Changed text (all history)') },
  { value: 'path', label: () => t('File or folder (all history)') },
];

export const SEARCH_LIMIT = 200;

export interface GitSearchResult {
  key: string;
  commits: Commit[] | null;
  error: string | null;
}

/** Ask git for `text` in `mode` (debounced); null while there is nothing to ask. */
export function useGitSearch(mode: SearchMode, text: string): GitSearchResult | null {
  const path = useRepo((s) => s.path);
  // Search again when the history changes (new commits, fetched branches).
  const refs = useRepo((s) => s.refs);
  const q = text.trim();
  const key = `${path}\u0000${mode}\u0000${q}`;
  const [result, setResult] = useState<GitSearchResult | null>(null);

  useEffect(() => {
    if (!path || mode === 'loaded' || !q) return;
    let live = true;
    const timer = setTimeout(() => {
      api
        .searchCommits(path, { [mode]: q }, SEARCH_LIMIT)
        .then((commits) => live && setResult({ key, commits, error: null }))
        .catch((e: Error) => live && setResult({ key, commits: [], error: e.message }));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [path, mode, q, key, refs]);

  if (!path || mode === 'loaded' || !q) return null;
  return result?.key === key ? result : { key, commits: null, error: null };
}

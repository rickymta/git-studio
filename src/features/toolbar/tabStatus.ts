import { useEffect } from 'react';

import { t } from '@/lib/i18n';
import type { RepoState, Status } from '@/lib/types';
import { useRepo, type RepoTab } from '@/stores/repo';
import { summaryKey, useWorkspaces } from '@/stores/workspace';

/** What a tab badge shows about its repository. */
export interface TabStatus {
  changes: number;
  conflicts: number;
  ahead: number;
  behind: number;
  state: RepoState | null;
  error: string | null;
}

const changedFiles = (s: Status) =>
  new Set([...s.staged, ...s.unstaged, ...s.conflicted].map((f) => f.path)).size;

/**
 * Status of the repository behind a tab: live for the shown tab, otherwise the last workspace
 * status read (no per-tab polling; see `useTabStatusRefresh`). `null` while unknown.
 */
export function useTabStatus(path: string, active: boolean): TabStatus | null {
  const live = useRepo((s) => (active && s.info ? s.info : null));
  const summary = useWorkspaces((s) => s.summaries[summaryKey(path)]);
  if (live) {
    return {
      changes: changedFiles(live.status),
      conflicts: live.status.conflicted.length,
      ahead: live.status.ahead,
      behind: live.status.behind,
      state: live.state,
      error: null,
    };
  }
  if (!summary) return null;
  return {
    changes: summary.changes,
    conflicts: summary.conflicts,
    ahead: summary.ahead,
    behind: summary.behind,
    state: summary.state,
    error: summary.error,
  };
}

/** A clean tab: known status, nothing to commit, no conflict, no operation in progress. */
export function isClean(path: string): boolean {
  const r = useRepo.getState();
  if (r.path && summaryKey(r.path) === summaryKey(path) && r.info) {
    return changedFiles(r.info.status) === 0 && r.info.state === 'clean';
  }
  const s = useWorkspaces.getState().summaries[summaryKey(path)];
  return (
    !!s && !s.error && s.changes === 0 && s.conflicts === 0 && (!s.state || s.state === 'clean')
  );
}

/** One line per fact, for the tab tooltip. */
export function describeStatus(s: TabStatus | null): string[] {
  if (!s) return [];
  if (s.error) return [s.error];
  const out: string[] = [];
  if (s.conflicts) out.push(t('{n} conflicted file(s)', { n: s.conflicts }));
  if (s.state && s.state !== 'clean')
    out.push(t('Operation in progress: {state}', { state: s.state }));
  if (s.changes) out.push(t('{n} uncommitted change(s)', { n: s.changes }));
  if (s.behind) out.push(t('{n} commit(s) behind', { n: s.behind }));
  if (s.ahead) out.push(t('{n} commit(s) ahead', { n: s.ahead }));
  if (!out.length) out.push(t('Clean'));
  return out;
}

const FOCUS_REFRESH_MS = 30_000;

/**
 * Keeps the tab badges current with as few git calls as possible: one batched status read for
 * tabs never read yet (when tabs open or the workspace changes) and one for every tab when the
 * window regains focus (at most every 30 s). The shown tab's own status feeds its entry too, so
 * it is current when you switch away.
 */
export function useTabStatusRefresh(tabs: RepoTab[]) {
  const scope = useRepo((s) => s.scope);
  const key = tabs.map((t) => summaryKey(t.path)).join('\n');

  useEffect(() => {
    const known = useWorkspaces.getState().summaries;
    const missing = tabs.filter((t) => !known[summaryKey(t.path)]).map((t) => t.path);
    if (missing.length) void useWorkspaces.getState().refreshTabStatus(missing);
    // `key` stands for the tab paths.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, scope]);

  useEffect(() => {
    let last = Date.now();
    const onFocus = () => {
      if (Date.now() - last < FOCUS_REFRESH_MS) return;
      last = Date.now();
      const cur = useRepo.getState().path;
      const paths = useRepo
        .getState()
        .tabs.map((t) => t.path)
        .filter((p) => !cur || summaryKey(p) !== summaryKey(cur));
      void useWorkspaces.getState().refreshTabStatus(paths);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Mirror the shown repository's live status into its summary.
  const info = useRepo((s) => s.info);
  useEffect(() => {
    if (!info) return;
    const k = summaryKey(info.path);
    const ws = useWorkspaces.getState();
    const old = ws.summaries[k];
    if (!old) return;
    const next = {
      ...old,
      branch: info.status.branch,
      upstream: info.status.upstream,
      ahead: info.status.ahead,
      behind: info.status.behind,
      changes: changedFiles(info.status),
      conflicts: info.status.conflicted.length,
      state: info.state,
    };
    if (
      next.ahead === old.ahead &&
      next.behind === old.behind &&
      next.changes === old.changes &&
      next.conflicts === old.conflicts &&
      next.state === old.state &&
      next.branch === old.branch
    )
      return;
    useWorkspaces.setState({ summaries: { ...ws.summaries, [k]: next } });
  }, [info]);
}

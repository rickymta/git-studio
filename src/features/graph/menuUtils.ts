// Helpers shared by the commit and branch context menus.

import type { MenuItem } from '@/components/ui';
import type { Commit } from '@/lib/types';
import { useRepo } from '@/stores/repo';

/** Drop leading, trailing and doubled separators left by entries that do not apply. */
export function tidy(items: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of items) {
    if (it === 'sep' && (out.length === 0 || out[out.length - 1] === 'sep')) continue;
    out.push(it);
  }
  while (out[out.length - 1] === 'sep') out.pop();
  return out;
}

/** Whether `hash` is reachable from `from` within the loaded commits (a commit reaches itself). */
export function reaches(from: string | null | undefined, hash: string | null): boolean {
  if (!hash) return false;
  if (!from) return false;
  const byHash = new Map(useRepo.getState().commits.map((c) => [c.hash, c]));
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const h = stack.pop()!;
    if (h === hash) return true;
    if (seen.has(h)) continue;
    seen.add(h);
    for (const p of byHash.get(h)?.parents ?? []) stack.push(p);
  }
  return false;
}

/** Whether `hash` is reachable from HEAD within the loaded commits (i.e. on the current branch). */
export const onCurrentBranch = (hash: string) =>
  reaches(useRepo.getState().info?.status.head, hash);

/**
 * Multi-selection after a Ctrl / Shift + click on row `i`: with `anchor` (a row index, Shift)
 * the rows between the two, else `current` with row `i` toggled. Stash rows are never picked.
 * Returns hashes in graph order (newest first).
 */
export function pickCommits(
  commits: Commit[],
  current: string[],
  i: number,
  anchor = -1,
): string[] {
  let set: Set<string>;
  if (anchor >= 0) {
    const [lo, hi] = anchor < i ? [anchor, i] : [i, anchor];
    set = new Set(commits.slice(lo, hi + 1).map((c) => c.hash));
  } else {
    set = new Set(current);
    const h = commits[i]!.hash;
    if (set.has(h)) set.delete(h);
    else set.add(h);
  }
  return commits.filter((c) => !c.stash && set.has(c.hash)).map((c) => c.hash);
}

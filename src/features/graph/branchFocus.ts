import type { GraphRow } from '@/lib/graph';
import type { Commit } from '@/lib/types';

/** Row index of every commit, so a hover walks the chain without scanning the list. */
export function rowIndex(commits: Commit[]): Map<string, number> {
  return new Map(commits.map((c, i) => [c.hash, i]));
}

/**
 * The rows that stay lit while a branch badge is hovered (GitKraken's branch focus): the tip and
 * its first-parent chain for as long as the chain stays on the tip's lane. Where the line turns
 * into another lane (the branch joined it), the walk stops.
 *
 * `layoutGraph` keeps a commit's lane reserved for its first parent, so the parent's row having the
 * same lane means the line runs straight down to it.
 */
export function branchRows(
  commits: Commit[],
  rows: GraphRow[],
  index: Map<string, number>,
  tip: string,
): Set<number> {
  const out = new Set<number>();
  let i = index.get(tip);
  if (i === undefined || !rows[i]) return out;
  const lane = rows[i]!.lane;
  while (i !== undefined) {
    out.add(i);
    const parent = commits[i]!.parents[0];
    const next = parent === undefined ? undefined : index.get(parent);
    if (next === undefined || next <= i || rows[next]?.lane !== lane) break;
    i = next;
  }
  return out;
}

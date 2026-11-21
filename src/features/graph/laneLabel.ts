import type { LaneStart } from '@/lib/graph';
import type { GitRef } from '@/lib/types';

/**
 * The branch a merge commit brought in, from git's / GitHub's / GitLab's default messages:
 * "Merge branch 'x' [into y]", "Merge pull request #12 from owner/x",
 * "Merge remote-tracking branch 'origin/x'".
 */
export function mergedBranch(subject: string): string | null {
  const m =
    /^Merge branch '([^']+)'/.exec(subject) ??
    /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject) ??
    /^Merge remote-tracking branch '([^']+)'/.exec(subject) ??
    /^Merge (?:remote )?branch "([^"]+)"/.exec(subject);
  return m?.[1] ?? null;
}

/**
 * Name of the branch a commit's line belongs to, shown faintly when its row is hovered
 * (GitKraken): the branch at the line's tip (a local branch before a remote one), or for a line
 * opened by a merge, the branch that merge brought in.
 */
export function laneBranch(
  from: LaneStart | null,
  refsAt: (hash: string) => GitRef[] | undefined,
  subjectOf: (hash: string) => string | undefined,
): string | null {
  if (!from) return null;
  if (from.merge) {
    const subject = subjectOf(from.hash);
    return subject ? mergedBranch(subject) : null;
  }
  const refs = refsAt(from.hash) ?? [];
  const local = refs.find((r) => r.kind === 'local');
  const remote = refs.find((r) => r.kind === 'remote' && !r.name.endsWith('/HEAD'));
  return (local ?? remote)?.name ?? null;
}

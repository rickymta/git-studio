import type { GitRef, Worktree } from '@/lib/types';

/**
 * A local branch and its matching remote branch at the same commit render as one badge.
 * `kind: 'head'` is the detached HEAD, which has no ref of its own.
 */
export interface BadgeGroup {
  key: string;
  label: string;
  refs: GitRef[];
  head: boolean;
  kind: 'branch' | 'tag' | 'head';
}

/** `detachedHead`: this commit is a detached HEAD, shown as a HEAD badge before the others. */
export function groupRefs(refs: GitRef[], detachedHead = false): BadgeGroup[] {
  const groups: BadgeGroup[] = [];
  if (detachedHead) groups.push({ key: 'HEAD', label: 'HEAD', refs: [], head: true, kind: 'head' });
  const locals = refs.filter((r) => r.kind === 'local');
  const remotes = refs.filter((r) => r.kind === 'remote');
  const used = new Set<string>();
  for (const l of locals) {
    const match = remotes.filter((r) => r.name.slice((r.remote?.length ?? 0) + 1) === l.name);
    match.forEach((m) => used.add(m.fullName));
    groups.push({
      key: l.fullName,
      label: l.name,
      refs: [l, ...match],
      head: l.isHead,
      kind: 'branch',
    });
  }
  for (const r of remotes) {
    if (!used.has(r.fullName))
      groups.push({ key: r.fullName, label: r.name, refs: [r], head: false, kind: 'branch' });
  }
  for (const tag of refs.filter((r) => r.kind === 'tag')) {
    groups.push({ key: tag.fullName, label: tag.name, refs: [tag], head: false, kind: 'tag' });
  }
  // Current branch first.
  return groups.sort((a, b) => Number(b.head) - Number(a.head));
}

/** The other worktree (not the one open here) that has this local branch checked out. */
export function worktreeOf(ref: GitRef, worktrees: Worktree[]): Worktree | undefined {
  if (ref.kind !== 'local') return undefined;
  return worktrees.find((w) => !w.isCurrent && w.branch === ref.name);
}

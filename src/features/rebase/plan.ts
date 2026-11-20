import { t } from '@/lib/i18n';
import type { Commit, RebaseAction, RebaseStep } from '@/lib/types';

/** One line of the interactive rebase todo, oldest commit first. */
export interface RebaseRow {
  commit: Commit;
  action: RebaseAction;
  /** New message for `reword`; empty until the user picks reword. */
  message: string;
}

export interface RebasePreset {
  /** Squash these into the oldest of them: they move right after it, in their own order. */
  squash?: string[];
  /** Drop these commits. */
  drop?: string[];
}

/** Rows for the commits a rebase rewrites (`plan`, oldest first), with `preset` applied. */
export function planRows(plan: Commit[], preset: RebasePreset = {}): RebaseRow[] {
  let rows: RebaseRow[] = plan.map((commit) => ({
    commit,
    action: preset.drop?.includes(commit.hash) ? 'drop' : 'pick',
    message: '',
  }));
  const squash = new Set(preset.squash ?? []);
  const first = rows.findIndex((r) => squash.has(r.commit.hash));
  if (squash.size > 1 && first >= 0) {
    const later = rows.filter((r, i) => i > first && squash.has(r.commit.hash));
    rows = rows.filter((r) => !later.includes(r));
    rows.splice(first + 1, 0, ...later.map((r) => ({ ...r, action: 'squash' as const })));
  }
  return rows;
}

/** Move row `i` one place up (`-1`) or down (`1`). */
export function moveRow(rows: RebaseRow[], i: number, dir: -1 | 1): RebaseRow[] {
  const j = i + dir;
  if (j < 0 || j >= rows.length) return rows;
  const next = [...rows];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** Why the rows cannot run as they are, or null when they can. */
export function rebaseProblem(rows: RebaseRow[]): string | null {
  const kept = rows.filter((r) => r.action !== 'drop');
  if (kept.length === 0) return t('Keep at least one commit, or reset the branch instead.');
  const first = kept[0]!;
  if (first.action === 'squash' || first.action === 'fixup')
    return t('The first kept commit has no earlier commit to squash into.');
  if (rows.some((r) => r.action === 'reword' && !r.message.trim()))
    return t('A reworded commit needs a message.');
  return null;
}

export function toSteps(rows: RebaseRow[]): RebaseStep[] {
  return rows.map((r) =>
    r.action === 'reword'
      ? { action: r.action, hash: r.commit.hash, message: r.message }
      : { action: r.action, hash: r.commit.hash },
  );
}

/** Nothing would change: every commit picked, in the original order. */
export function isNoop(rows: RebaseRow[], plan: Commit[]): boolean {
  return rows.every((r, i) => r.action === 'pick' && r.commit.hash === plan[i]?.hash);
}

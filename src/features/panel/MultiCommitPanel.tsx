import { Layers, X } from 'lucide-react';

import { Avatar, Button, IconButton } from '@/components/ui';
import { short } from '@/lib/format';
import { t } from '@/lib/i18n';
import { copyText } from '@/lib/native';
import { useRepo } from '@/stores/repo';
import * as A from '../actions';
import { onCurrentBranch } from '../graph/menuUtils';

/** Several commits picked with Ctrl / Shift + click: what can be done with all of them at once. */
export function MultiCommitPanel({ hashes }: { hashes: string[] }) {
  const select = useRepo((s) => s.select);
  // Re-read when the history changes so a rewritten or vanished commit drops out.
  useRepo((s) => s.commits);
  const commits = A.commitsOf(hashes);
  const mine = commits.length > 0 && commits.every((c) => onCurrentBranch(c.hash));
  const merges = commits.some((c) => c.parents.length > 1);
  const noneMine = commits.every((c) => !onCurrentBranch(c.hash));
  const oldest = commits[commits.length - 1];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Layers className="size-4 shrink-0 text-accent" />
          <span className="flex-1 text-[13px] font-semibold">
            {t('{n} commits selected', { n: commits.length })}
          </span>
          <IconButton
            label={t('Clear selection')}
            onClick={() =>
              void select(commits[0] ? { type: 'commit', hash: commits[0].hash } : null)
            }
          >
            <X className="size-3.5" />
          </IconButton>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {t('Ctrl + click adds or removes a commit, Shift + click selects a range.')}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2 border-b border-border px-3 py-2.5">
        {commits.length === 2 && (
          <Button
            size="sm"
            onClick={() =>
              void A.compareCommits(A.commitSide(commits[1]!.hash), A.commitSide(commits[0]!.hash))
            }
          >
            {t('Compare')}
          </Button>
        )}
        {noneMine && (
          <Button size="sm" onClick={() => void A.cherryPickMany(commits)}>
            {t('Cherry-pick {n} commits', { n: commits.length })}
          </Button>
        )}
        {mine && !merges && (
          <>
            <Button size="sm" onClick={() => void A.squashCommits(commits)}>
              {t('Squash {n} commits', { n: commits.length })}
            </Button>
            <Button size="sm" onClick={() => void A.dropCommits(commits)}>
              {t('Drop {n} commits', { n: commits.length })}
            </Button>
            {oldest && (
              <Button size="sm" onClick={() => void A.interactiveRebase(oldest.hash)}>
                {t('Interactive rebase…')}
              </Button>
            )}
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => copyText(commits.map((c) => c.hash).join('\n'))}
        >
          {t('Copy commit shas')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {commits.map((c) => (
          <button
            key={c.hash}
            type="button"
            onClick={() => void select({ type: 'commit', hash: c.hash })}
            className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-surface-hover"
          >
            <Avatar name={c.authorName} email={c.authorEmail} size={18} />
            <span className="min-w-0 flex-1 truncate">{c.subject}</span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {short(c.hash)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

import { ArrowDown, ArrowUp, CornerLeftUp } from 'lucide-react';
import { Button, IconButton, Modal, Textarea } from '@/components/ui';
import { cn } from '@/lib/cn';
import { short } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { RebaseAction } from '@/lib/types';
import { useRebaseDialog } from '@/stores/rebase';
import { useRepo } from '@/stores/repo';
import { runRebase } from '../actions';
import { isNoop, moveRow, rebaseProblem, toSteps, type RebaseRow } from './plan';

import { Select } from '@/components/controls';

const ACTIONS: { value: RebaseAction; label: () => string }[] = [
  { value: 'pick', label: () => t('Pick') },
  { value: 'reword', label: () => t('Reword') },
  { value: 'squash', label: () => t('Squash') },
  { value: 'fixup', label: () => t('Fixup') },
  { value: 'drop', label: () => t('Drop') },
];

/**
 * Interactive rebase: the commits from the chosen one up to HEAD, oldest at the top. Each can be
 * moved, picked, reworded, squashed or fixed up into the commit above it, or dropped.
 */
export function RebaseDialog() {
  const from = useRebaseDialog((s) => s.from);
  const plan = useRebaseDialog((s) => s.plan);
  const rows = useRebaseDialog((s) => s.rows);
  const setRows = useRebaseDialog((s) => s.setRows);
  const close = useRebaseDialog((s) => s.close);

  const problem = rebaseProblem(rows);
  const noop = isNoop(rows, plan);

  const update = (i: number, patch: Partial<RebaseRow>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const setAction = async (i: number, action: RebaseAction) => {
    const row = rows[i]!;
    update(i, { action });
    if (action !== 'reword' || row.message) return;
    // Start from the commit's full message (the graph only has its first lines).
    const path = useRepo.getState().path;
    const full = path ? await api.commit(path, row.commit.hash).catch(() => null) : null;
    const body = full?.body.trim() ?? '';
    const message = body ? `${row.commit.subject}\n\n${body}` : row.commit.subject;
    const cur = useRebaseDialog.getState().rows;
    useRebaseDialog
      .getState()
      .setRows(
        cur.map((r) => (r.commit.hash === row.commit.hash && !r.message ? { ...r, message } : r)),
      );
  };

  const start = async () => {
    if (!from || problem) return;
    const steps = toSteps(rows);
    close();
    await runRebase(from, steps);
  };

  return (
    <Modal
      open={!!from}
      onClose={close}
      width={720}
      title={t('Interactive rebase')}
      description={t(
        'Oldest commit at the top. Squash and fixup fold a commit into the one above it; squash keeps both messages, fixup only the one above.',
      )}
    >
      <div className="max-h-[55vh] overflow-auto rounded-md border border-border">
        {rows.map((r, i) => {
          const folded = r.action === 'squash' || r.action === 'fixup';
          return (
            <div
              key={r.commit.hash}
              className={cn('border-b border-border px-2 py-1.5 last:border-b-0', folded && 'pl-6')}
            >
              <div className="flex items-center gap-2">
                <div className="flex shrink-0">
                  <IconButton
                    label={t('Move up')}
                    disabled={i === 0}
                    onClick={() => setRows(moveRow(rows, i, -1))}
                  >
                    <ArrowUp className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={t('Move down')}
                    disabled={i === rows.length - 1}
                    onClick={() => setRows(moveRow(rows, i, 1))}
                  >
                    <ArrowDown className="size-3.5" />
                  </IconButton>
                </div>
                <Select
                  aria-label={t('Action for {hash}', { hash: short(r.commit.hash) })}
                  value={r.action}
                  onChange={(v) => void setAction(i, v as RebaseAction)}
                  className="h-7 w-24 shrink-0 px-1.5 text-xs"
                  options={ACTIONS.map((a) => ({ value: a.value, label: a.label() }))}
                />
                {folded && <CornerLeftUp className="size-3.5 shrink-0 text-muted-foreground" />}
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {short(r.commit.hash)}
                </span>
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    r.action === 'drop' && 'text-muted-foreground line-through',
                  )}
                  title={r.commit.subject}
                >
                  {r.commit.subject}
                </span>
                <span className="shrink-0 truncate text-xs text-muted-foreground">
                  {r.commit.authorName}
                </span>
              </div>
              {r.action === 'reword' && (
                <Textarea
                  rows={3}
                  className="mt-1.5 font-mono text-xs"
                  value={r.message}
                  placeholder={t('Commit message')}
                  onChange={(e) => update(i, { message: e.target.value })}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 min-h-5 text-xs text-danger">{problem}</div>
      <div className="mt-2 flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted-foreground">
          {t('{n} commit(s); uncommitted changes are stashed and restored.', { n: rows.length })}
        </span>
        <Button onClick={close}>{t('Cancel')}</Button>
        <Button variant="primary" disabled={!!problem || noop} onClick={() => void start()}>
          {t('Start rebase')}
        </Button>
      </div>
    </Modal>
  );
}

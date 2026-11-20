import { useCallback, useEffect, useState } from 'react';

import { Button, Modal, Spinner, cn } from '@/components/ui';
import { formatBytes } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { MaintenanceTask, RepoStats } from '@/lib/types';
import { useRepo } from '@/stores/repo';

const TASKS: { task: MaintenanceTask; label: string; help: string }[] = [
  {
    task: 'gc',
    label: 'Garbage collect',
    help: 'Pack loose objects and remove old unreachable ones (git gc).',
  },
  {
    task: 'gc-aggressive',
    label: 'Aggressive GC',
    help: 'Recompress everything and drop all unreachable objects now. Slow on big repositories.',
  },
  {
    task: 'repack',
    label: 'Repack',
    help: 'Put all objects into a single pack (git repack -a -d).',
  },
  {
    task: 'prune',
    label: 'Prune',
    help: 'Delete unreachable loose objects older than two weeks (git prune).',
  },
  {
    task: 'commit-graph',
    label: 'Write commit-graph',
    help: 'Speeds up history, graph and blame on large repositories.',
  },
  {
    task: 'pack-refs',
    label: 'Pack refs',
    help: 'Store branch and tag refs in one file (git pack-refs --all).',
  },
  {
    task: 'fsck',
    label: 'Check integrity',
    help: 'Verify every object and report corruption or missing objects (git fsck --full).',
  },
];

interface Log {
  task: string;
  ok: boolean;
  output: string;
}

/** Object database size and the git housekeeping tasks (gc, repack, prune, fsck…). */
export function MaintenanceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const path = useRepo((s) => s.path);
  const [stats, setStats] = useState<RepoStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<MaintenanceTask | null>(null);
  const [log, setLog] = useState<Log | null>(null);

  const reload = useCallback(() => {
    if (!path) return;
    api
      .repoStats(path)
      .then((s) => {
        setStats(s);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [path]);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  const close = () => {
    if (busy) return;
    setLog(null);
    setStats(null);
    onClose();
  };

  const runTask = async (task: MaintenanceTask, label: string) => {
    if (!path) return;
    setBusy(task);
    try {
      const r = await api.maintenance(path, task);
      setLog({ task: label, ok: r.ok, output: r.output });
    } catch (e) {
      setLog({ task: label, ok: false, output: (e as Error).message });
    } finally {
      setBusy(null);
      reload();
    }
  };

  const stat = (label: string, value: string, sub?: string) => (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-[15px] font-medium tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={close}
      width={640}
      title={t('Repository maintenance')}
      description={t('Keep the object database small and fast, and check it for corruption.')}
    >
      <div className="mb-4 grid grid-cols-3 gap-2">
        {error ? (
          <div className="col-span-3 text-xs text-danger">{error}</div>
        ) : !stats ? (
          <div className="col-span-3 flex justify-center p-3">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : (
          <>
            {stat(
              t('Packed'),
              formatBytes(stats.packSize),
              t('{n} object(s) in {packs} pack(s)', {
                n: stats.packedObjects,
                packs: stats.packs,
              }),
            )}
            {stat(
              t('Loose'),
              formatBytes(stats.looseSize),
              t('{n} object(s)', { n: stats.looseObjects }),
            )}
            {stat(
              t('Garbage'),
              formatBytes(stats.garbageSize),
              t('{n} file(s), {p} prunable', { n: stats.garbage, p: stats.prunePackable }),
            )}
          </>
        )}
      </div>

      <div className="flex flex-col divide-y divide-border rounded-md border border-border">
        {TASKS.map(({ task, label, help }) => (
          <div key={task} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{t(label)}</div>
              <div className="text-xs text-muted-foreground">{t(help)}</div>
            </div>
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => void runTask(task, t(label))}
              className="w-20 justify-center"
            >
              {busy === task ? <Spinner /> : t('Run')}
            </Button>
          </div>
        ))}
      </div>

      {log && (
        <div className="mt-3">
          <div className={cn('mb-1 text-xs font-medium', log.ok ? 'text-success' : 'text-danger')}>
            {log.ok
              ? t('{task}: done', { task: log.task })
              : t('{task}: failed', { task: log.task })}
          </div>
          <pre className="max-h-48 overflow-auto rounded-md border border-border bg-surface p-2 font-mono text-[11px] whitespace-pre-wrap">
            {log.output || t('(no output)')}
          </pre>
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <Button onClick={close} disabled={busy !== null}>
          {t('Close')}
        </Button>
      </div>
    </Modal>
  );
}

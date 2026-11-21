import { Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button, Spinner } from '@/components/ui';
import { parseConflicts } from '@/lib/diff';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { ConflictVersions, DecodedText } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { confirm, toast } from '@/stores/ui';
import { MergeTool } from './MergeTool';

/**
 * Merge-conflict tool for one file. The versions come from git's index (base, current branch,
 * incoming), merged again with the base shown; the working file (with its markers) is the
 * fallback. Saving writes the result in the file's encoding and stages it.
 */
export function ConflictView({ path, wrap }: { path: string; wrap: boolean }) {
  const repo = useRepo((s) => s.path)!;
  const run = useRepo((s) => s.run);
  const closeDiff = useRepo((s) => s.closeDiff);
  const [file, setFile] = useState<DecodedText | null>(null);
  const [versions, setVersions] = useState<ConflictVersions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.readFile(repo, path).catch(() => null),
      api.conflictVersions(repo, path).catch(() => null),
    ]).then(([f, v]) => {
      if (!alive) return;
      if (!f && !v) setError(t('Could not read {path}', { path }));
      setFile(f);
      setVersions(v);
    });
    return () => {
      alive = false;
    };
  }, [repo, path]);

  const parts = useMemo(
    () => parseConflicts(versions?.merged ?? file?.text ?? ''),
    [versions, file],
  );
  const conflicts = parts.filter((p) => p.type === 'conflict');
  const first = conflicts[0];
  const format = versions?.format ?? file?.format ?? null;

  const save = async (text: string, unresolved: number) => {
    if (!format) return;
    if (
      unresolved > 0 &&
      !(await confirm(
        t('Some conflicts have no choice'),
        t('{n} conflict(s) have nothing picked; their base version will be saved.', {
          n: unresolved,
        }),
        t('Save anyway'),
      ))
    )
      return;
    setSaving(true);
    const ok = await run('Resolve', async (p) => {
      await api.writeFile(p, path, text, format);
      await api.stage(p, [path]);
    });
    setSaving(false);
    if (ok) {
      toast('success', t('Conflict resolved: {path}', { path }));
      closeDiff();
    }
  };

  const takeWhole = (side: 'ours' | 'theirs') =>
    run('Resolve', (p) => api.resolve(p, [path], side)).then((ok) => ok && closeDiff());

  if (error) return <div className="p-6 text-danger">{error}</div>;
  if (!file && !versions) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-muted-foreground" />
      </div>
    );
  }

  if (!first || first.type !== 'conflict' || !format) {
    // Deleted on one side, binary, or markers already removed: whole-file choices only.
    return (
      <div className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="text-muted-foreground">
          {t(
            'No conflict markers in this file. Choose a whole side, or mark it resolved as it is.',
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={() => takeWhole('ours')}>{t('Take current branch (A)')}</Button>
          <Button onClick={() => takeWhole('theirs')}>{t('Take incoming (B)')}</Button>
          <Button
            variant="primary"
            onClick={() =>
              run('Stage', (p) => api.stage(p, [path])).then((ok) => ok && closeDiff())
            }
          >
            <Check className="size-4" /> {t('Mark Resolved')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <MergeTool
      path={path}
      parts={parts}
      ours={{
        label: versions?.oursLabel ?? (first.oursLabel || 'HEAD'),
        commit: versions?.oursCommit ?? null,
      }}
      theirs={{
        label: versions?.theirsLabel ?? (first.theirsLabel || t('incoming')),
        commit: versions?.theirsCommit ?? null,
      }}
      wrap={wrap}
      saving={saving}
      saveLabel={t('Save and Mark Resolved')}
      onSave={(text, unresolved) => void save(text, unresolved)}
      onClose={closeDiff}
    />
  );
}

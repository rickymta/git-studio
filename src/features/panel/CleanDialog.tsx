import { File, Folder } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button, Modal, Spinner } from '@/components/ui';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { useRepo } from '@/stores/repo';

import { Checkbox } from '@/components/controls';

interface Preview {
  key: string;
  paths: string[] | null;
  error: string | null;
}

/**
 * `git clean`: lists the untracked files and folders (optionally ignored ones too) and deletes
 * the ones left ticked. Deleted files do not go to the recycle bin.
 */
export function CleanDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const path = useRepo((s) => s.path);
  const run = useRepo((s) => s.run);
  const [ignored, setIgnored] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  // Unticked paths (everything listed starts ticked).
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const key = `${path}\u0000${ignored}`;

  useEffect(() => {
    if (!open || !path) return;
    let live = true;
    api
      .cleanPreview(path, ignored)
      .then((paths) => live && setPreview({ key, paths, error: null }))
      .catch((e: Error) => live && setPreview({ key, paths: [], error: e.message }));
    return () => {
      live = false;
    };
  }, [open, path, ignored, key]);

  const shown = preview?.key === key ? preview : null;
  const paths = shown?.paths ?? [];
  const chosen = paths.filter((p) => !skip.has(p));

  const close = () => {
    setSkip(new Set());
    setIgnored(false);
    setPreview(null);
    onClose();
  };
  const toggle = (p: string) => {
    const next = new Set(skip);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setSkip(next);
  };
  const clean = async () => {
    const list = chosen;
    close();
    await run(
      'Clean',
      (p) => api.clean(p, list, ignored),
      t('Deleted {n} untracked item(s)', { n: list.length }),
    );
  };

  return (
    <Modal
      open={open}
      onClose={close}
      width={560}
      title={t('Clean working tree')}
      description={t(
        'Delete untracked files and folders. They are not in git, so this cannot be undone.',
      )}
    >
      <label className="mb-2 flex items-center gap-2">
        <Checkbox checked={ignored} onChange={(v) => setIgnored(v)} />
        {t('Also delete ignored files (build output, dependencies…)')}
      </label>
      <div className="max-h-[45vh] min-h-24 overflow-auto rounded-md border border-border py-1">
        {!shown ? (
          <div className="flex justify-center p-4">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : shown.error ? (
          <div className="px-3 py-2 text-xs text-danger">{shown.error}</div>
        ) : paths.length === 0 ? (
          <div className="px-3 py-2 text-muted-foreground">{t('Nothing to clean.')}</div>
        ) : (
          paths.map((p) => (
            <label key={p} className="flex items-center gap-2 px-3 py-0.5 hover:bg-surface-hover">
              <Checkbox checked={!skip.has(p)} onChange={() => toggle(p)} />
              {p.endsWith('/') ? (
                <Folder className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <File className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 truncate font-mono text-xs" title={p}>
                {p}
              </span>
            </label>
          ))
        )}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        {paths.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto"
            onClick={() => setSkip(chosen.length ? new Set(paths) : new Set())}
          >
            {chosen.length ? t('Untick all') : t('Tick all')}
          </Button>
        )}
        <Button onClick={close}>{t('Cancel')}</Button>
        <Button variant="danger" disabled={chosen.length === 0} onClick={() => void clean()}>
          {t('Delete {n} item(s)', { n: chosen.length })}
        </Button>
      </div>
    </Modal>
  );
}

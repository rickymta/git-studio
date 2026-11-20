// Actions for the less common repository features: submodules, LFS, bisect, merge tools,
// maintenance. Kept apart from actions.ts, which holds the everyday ones.

import { joinPath } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { Submodule } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { ask, confirm } from '@/stores/ui';

const repo = () => useRepo.getState();
const run = (...a: Parameters<ReturnType<typeof repo>['run']>) => repo().run(...a);

// ---- submodules ---------------------------------------------------------------------------------

export async function openSubmodule(s: Submodule) {
  const path = repo().path;
  if (path) await repo().open(joinPath(path, s.path));
}

/** Clone (when needed) and check out the recorded commit of `subs` (all when empty). */
export async function updateSubmodules(subs: Submodule[] = [], recursive = true) {
  await run(
    'Update submodules',
    (p) =>
      api.submoduleUpdate(
        p,
        subs.map((s) => s.path),
        recursive,
      ),
    subs.length === 1 ? t('Updated {name}', { name: subs[0]!.path }) : t('Submodules updated'),
  );
}

export async function syncSubmodules() {
  await run('Sync submodules', (p) => api.submoduleSync(p), t('Submodule URLs synced'));
}

export async function addSubmodule() {
  const v = await ask({
    title: t('Add submodule'),
    description: t('Clones the repository into a folder of this one; commit to record it.'),
    fields: [
      { name: 'url', label: t('Repository URL'), required: true },
      { name: 'path', label: t('Folder (relative to the repository)'), required: true },
      { name: 'branch', label: t('Branch to follow (optional)') },
    ],
    confirmLabel: t('Add submodule'),
  });
  if (!v) return;
  const url = (v.url as string).trim();
  const path = (v.path as string).trim().replace(/\\/g, '/');
  await run(
    'Add submodule',
    (p) => api.submoduleAdd(p, url, path, (v.branch as string).trim() || undefined),
    t('Added submodule {name}', { name: path }),
  );
}

export async function deinitSubmodule(s: Submodule) {
  const ok = await confirm(
    t('Deinitialise submodule'),
    t(
      'Empty the folder {path} and stop checking it out? Local changes in it are lost; Update brings it back.',
      { path: s.path },
    ),
    t('Deinitialise'),
    true,
  );
  if (ok)
    await run(
      'Deinitialise submodule',
      (p) => api.submoduleDeinit(p, s.path, true),
      t('Deinitialised {name}', { name: s.path }),
    );
}

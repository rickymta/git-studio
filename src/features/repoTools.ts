// Actions for the less common repository features: submodules, LFS, bisect, merge tools,
// maintenance. Kept apart from actions.ts, which holds the everyday ones.

import type { MenuItem } from '@/components/ui';
import { joinPath } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { BisectState, Submodule } from '@/lib/types';
import { useBisect } from '@/stores/bisect';
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

// ---- Git LFS ------------------------------------------------------------------------------------

/** `*.ext` for a file with an extension, else the file itself. */
export function lfsPatternFor(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 && dot < base.length - 1 ? `*${base.slice(dot)}` : path.replace(/\\/g, '/');
}

/** Store files matching a pattern (asked, prefilled with `initial`) with LFS. */
export async function lfsTrack(initial = '') {
  const v = await ask({
    title: t('Track with LFS'),
    description: t(
      'Files matching the pattern are stored with Git LFS from now on. The pattern goes into .gitattributes; commit it.',
    ),
    fields: [
      { name: 'pattern', label: t('Pattern'), initial, placeholder: '*.psd', required: true },
    ],
    confirmLabel: t('Track'),
  });
  const pattern = (v?.pattern as string | undefined)?.trim();
  if (pattern)
    await run(
      'LFS track',
      (p) => api.lfsTrack(p, pattern),
      t('{pattern} is tracked with LFS', { pattern }),
    );
}

export async function lfsUntrack(pattern: string) {
  await run(
    'LFS untrack',
    (p) => api.lfsUntrack(p, pattern),
    t('{pattern} is no longer tracked with LFS', { pattern }),
  );
}

export async function lfsInstall() {
  await run('LFS install', (p) => api.lfsInstall(p), t('Git LFS is set up for this repository'));
}

export async function lfsOp(op: 'pull' | 'fetch' | 'prune') {
  const label = op === 'pull' ? 'LFS pull' : op === 'fetch' ? 'LFS fetch' : 'LFS prune';
  const done =
    op === 'pull'
      ? t('LFS files downloaded')
      : op === 'fetch'
        ? t('LFS objects fetched')
        : t('Old LFS objects pruned');
  await run(label, (p) => api.lfsOp(p, op), done);
}

// ---- bisect -------------------------------------------------------------------------------------

/** Run a bisect command and keep the banner's state in step with its result. */
async function bisectRun(label: string, fn: (p: string) => Promise<BisectState | null>) {
  const path = repo().path;
  if (!path) return;
  await run(label, async (p) => {
    const st = await fn(p);
    useBisect.getState().set(path, st ?? (await api.bisectState(p)));
  });
}

/** Start a bisect with `hash` as the first bad (or good) commit. */
export async function bisectStart(hash: string, mark: 'good' | 'bad') {
  await bisectRun('Start bisect', (p) =>
    mark === 'bad' ? api.bisectStart(p, hash) : api.bisectStart(p, undefined, hash),
  );
}

/** Mark `hash` (the checked-out commit when omitted). */
export async function bisectMark(mark: 'good' | 'bad' | 'skip', hash?: string) {
  const label = mark === 'good' ? 'Bisect good' : mark === 'bad' ? 'Bisect bad' : 'Bisect skip';
  await bisectRun(label, (p) => api.bisectMark(p, mark, hash));
}

export async function bisectReset() {
  await bisectRun('End bisect', async (p) => {
    await api.bisectReset(p);
    return null;
  });
}

/** The commit menu's Bisect submenu. */
export function bisectMenu(hash: string): MenuItem[] {
  const st = useBisect.getState();
  const active = st.path === repo().path && !!st.state?.active;
  if (!active)
    return [
      {
        label: t('Start bisect: this commit is bad'),
        onSelect: () => bisectStart(hash, 'bad'),
      },
      {
        label: t('Start bisect: this commit is good'),
        onSelect: () => bisectStart(hash, 'good'),
      },
    ];
  return [
    { label: t('Mark as good'), onSelect: () => bisectMark('good', hash) },
    { label: t('Mark as bad'), onSelect: () => bisectMark('bad', hash) },
    { label: t('Skip this commit'), onSelect: () => bisectMark('skip', hash) },
    'sep',
    { label: t('End bisect'), onSelect: () => bisectReset() },
  ];
}

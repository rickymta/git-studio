// Adding repositories to the active workspace, shared by its overview, the workspace menu in
// the tab bar and the toolbar.

import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { pickFolder } from '@/lib/native';
import { useWorkspaces } from '@/stores/workspace';
import { toast } from '@/stores/ui';

/** Add repositories by path to the active workspace, with a toast saying what happened. */
export async function addToWorkspace(paths: string[], name?: string) {
  const ws = useWorkspaces.getState().active();
  if (!ws) return 0;
  const n = await useWorkspaces.getState().addRepos(ws.id, paths);
  if (name)
    toast(
      n ? 'success' : 'info',
      n
        ? t('Added {name} to {workspace}', { name, workspace: ws.name })
        : t('{name} is already in this workspace', { name }),
    );
  return n;
}

/** Pick a repository folder and add it to the active workspace. */
export async function addRepoFolder() {
  const p = await pickFolder(t('Add a repository to this workspace'));
  if (!p) return;
  try {
    const info = await api.info(p);
    await addToWorkspace([info.path], info.name);
  } catch (e) {
    toast('error', t('Not a Git repository'), (e as Error).message);
  }
}

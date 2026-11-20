import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { openPath, openUrl as openExternal } from '@tauri-apps/plugin-opener';

import { isTauri } from './ipc';

/** Path typed in GitStudio's own dialog (browser / dev bridge: no native file picker). */
async function askPath(title: string, defaultPath?: string): Promise<string | null> {
  const [{ ask }, { t }] = await Promise.all([import('@/stores/ui'), import('./i18n')]);
  const v = await ask({
    title,
    fields: [
      { name: 'path', label: t('Absolute path'), initial: defaultPath ?? '', required: true },
    ],
    confirmLabel: t('OK'),
  });
  const path = (v?.path as string | undefined)?.trim();
  return path || null;
}

/** Folder picker. In a plain browser (dev bridge) asks for the path in a dialog. */
export async function pickFolder(title: string, defaultPath?: string): Promise<string | null> {
  if (isTauri) {
    const r = await openDialog({ directory: true, multiple: false, title, defaultPath });
    return typeof r === 'string' ? r : null;
  }
  return askPath(title, defaultPath);
}

export async function openUrl(url: string): Promise<void> {
  if (isTauri) {
    await openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

export async function revealPath(path: string): Promise<void> {
  if (isTauri) {
    await openPath(path);
  }
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/** File picker. In a plain browser (dev bridge) asks for the path in a dialog. */
export async function pickFile(title: string, defaultPath?: string): Promise<string | null> {
  if (isTauri) {
    const r = await openDialog({ directory: false, multiple: false, title, defaultPath });
    return typeof r === 'string' ? r : null;
  }
  return askPath(title, defaultPath);
}

/** The app's bundled resources folder (null in a plain browser / dev bridge). */
export async function appResourceDir(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    const { resourceDir } = await import('@tauri-apps/api/path');
    return await resourceDir();
  } catch {
    return null;
  }
}

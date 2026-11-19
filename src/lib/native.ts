import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { openPath, openUrl as openExternal } from '@tauri-apps/plugin-opener';

import { isTauri } from './ipc';

/** Folder picker. In a plain browser (dev bridge) falls back to a text prompt. */
export async function pickFolder(title: string, defaultPath?: string): Promise<string | null> {
  if (isTauri) {
    const r = await openDialog({ directory: true, multiple: false, title, defaultPath });
    return typeof r === 'string' ? r : null;
  }
  return window.prompt(`${title} (absolute path)`, defaultPath ?? '');
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

/** File picker. In a plain browser (dev bridge) falls back to a text prompt. */
export async function pickFile(title: string, defaultPath?: string): Promise<string | null> {
  if (isTauri) {
    const r = await openDialog({ directory: false, multiple: false, title, defaultPath });
    return typeof r === 'string' ? r : null;
  }
  return window.prompt(`${title} (absolute path)`, defaultPath ?? '');
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

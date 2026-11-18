import { isTauri } from './ipc';

/** Folder picker. In a plain browser (dev bridge) falls back to a text prompt. */
export async function pickFolder(title: string, defaultPath?: string): Promise<string | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const r = await open({ directory: true, multiple: false, title, defaultPath });
    return typeof r === 'string' ? r : null;
  }
  return window.prompt(`${title} (absolute path)`, defaultPath ?? '');
}

export async function openUrl(url: string): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

export async function revealPath(path: string): Promise<void> {
  if (isTauri) {
    const { openPath } = await import('@tauri-apps/plugin-opener');
    await openPath(path);
  }
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/** File picker. In a plain browser (dev bridge) falls back to a text prompt. */
export async function pickFile(title: string, defaultPath?: string): Promise<string | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const r = await open({ directory: false, multiple: false, title, defaultPath });
    return typeof r === 'string' ? r : null;
  }
  return window.prompt(`${title} (absolute path)`, defaultPath ?? '');
}

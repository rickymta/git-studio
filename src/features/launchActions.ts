import { api, isTauri } from '@/lib/ipc';
import { useRepo } from '@/stores/repo';

/**
 * Run what the file manager's context menu asked for ("Open with GitStudio"): actions queued by
 * this launch, or forwarded by a second launch while GitStudio was open.
 */
export async function processLaunchActions(onOpen?: () => void): Promise<void> {
  let actions;
  try {
    actions = await api.takeLaunchActions();
  } catch {
    return;
  }
  for (const a of actions) {
    onOpen?.();
    await useRepo.getState().open(a.path);
  }
}

/** Follow later context-menu launches (the shell emits `launch-action`). */
export function listenLaunchActions(onOpen?: () => void): () => void {
  if (!isTauri) return () => {};
  let stop: (() => void) | null = null;
  let cancelled = false;
  void import('@tauri-apps/api/event').then(({ listen }) =>
    listen('launch-action', () => void processLaunchActions(onOpen)).then((un) => {
      if (cancelled) un();
      else stop = un;
    }),
  );
  return () => {
    cancelled = true;
    stop?.();
  };
}

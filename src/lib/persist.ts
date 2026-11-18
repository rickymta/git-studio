/**
 * Durable app data lives in files next to settings.json (see crates/gitstudio-core/src/history.rs):
 * - ui-state.json mirrors every `gitstudio.*` localStorage key, and is loaded back into
 *   localStorage at startup before any store reads it;
 * - activity.jsonl receives the Activity Logs, batched.
 * Imports nothing that touches localStorage, so main.tsx can run it before loading the app.
 */
import { api } from './ipc';
import type { HistoryStats } from './types';

const PREFIX = 'gitstudio.';
let pending: Record<string, string | null> = {};
let timer: ReturnType<typeof setTimeout> | null = null;

function flushState() {
  timer = null;
  const changes = pending;
  pending = {};
  if (Object.keys(changes).length) api.stateSet(changes).catch(() => {});
}

function queue(key: string, value: string | null) {
  pending[key] = value;
  if (!timer) timer = setTimeout(flushState, 400);
}

/** Load ui-state.json into localStorage, then mirror later writes back to the file. */
export async function hydrateUiState(): Promise<void> {
  let ls: Storage;
  try {
    ls = window.localStorage;
  } catch {
    return;
  }
  try {
    const state = await api.stateLoad();
    const keys = Object.keys(state);
    if (keys.length) {
      for (const k of keys) {
        const v = state[k];
        if (k.startsWith(PREFIX) && typeof v === 'string') ls.setItem(k, v);
      }
    } else {
      // First run with the file: carry over what the browser storage already has.
      const existing: Record<string, string> = {};
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k?.startsWith(PREFIX)) existing[k] = ls.getItem(k) ?? '';
      }
      if (Object.keys(existing).length) await api.stateSet(existing);
    }
  } catch {
    /* backend unavailable: keep browser storage only */
  }
  const set = ls.setItem.bind(ls);
  const remove = ls.removeItem.bind(ls);
  ls.setItem = (k: string, v: string) => {
    set(k, v);
    if (k.startsWith(PREFIX)) queue(k, v);
  };
  ls.removeItem = (k: string) => {
    remove(k);
    if (k.startsWith(PREFIX)) queue(k, null);
  };
  window.addEventListener('beforeunload', () => {
    flushState();
    flushActivity();
  });
}

// ---- activity log -------------------------------------------------------------------------------

let activityQueue: unknown[] = [];
let activityTimer: ReturnType<typeof setTimeout> | null = null;
let onStats: ((s: HistoryStats) => void) | null = null;

/** Called with the file's size after each write (for the size warnings). */
export function onHistoryStats(fn: (s: HistoryStats) => void) {
  onStats = fn;
}

function flushActivity() {
  activityTimer = null;
  const batch = activityQueue;
  activityQueue = [];
  if (batch.length)
    api
      .historyAppend(batch)
      .then((s) => onStats?.(s))
      .catch(() => {});
}

/** Append one Activity Logs entry to activity.jsonl (batched every second). */
export function persistActivity(entry: unknown) {
  activityQueue.push(entry);
  if (!activityTimer) activityTimer = setTimeout(flushActivity, 1000);
}

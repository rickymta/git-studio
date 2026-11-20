import { create } from 'zustand';

import { logActivity } from './activity';

import { t } from '@/lib/i18n';
export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  /** Runs on click; the toast closes afterwards. */
  run: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
  /** Buttons under the text. */
  actions?: ToastAction[];
  /** Auto-hide delay in ms; the toast's progress bar runs for this long (paused on hover). */
  duration: number;
}

export interface ToastSpec {
  kind: ToastKind;
  title: string;
  detail?: string;
  actions?: ToastAction[];
}

export type FieldType = 'text' | 'textarea' | 'checkbox' | 'select' | 'password';

export interface Field {
  name: string;
  label: string;
  type?: FieldType;
  placeholder?: string;
  initial?: string | boolean;
  options?: { value: string; label: string }[];
  required?: boolean;
  help?: string;
}

export interface PromptSpec {
  title: string;
  description?: string;
  fields?: Field[];
  confirmLabel?: string;
  danger?: boolean;
}

export type PromptValues = Record<string, string | boolean>;

interface PromptState extends PromptSpec {
  resolve: (v: PromptValues | null) => void;
}

/** App-level dialogs any part of the UI can open: Clone, and Scan a folder into the active
 *  workspace. */
export type AppDialog = 'clone' | 'scanWorkspace';

interface UiStore {
  toasts: Toast[];
  prompt: PromptState | null;
  theme: 'dark' | 'light';
  dialog: AppDialog | null;
  openDialog: (d: AppDialog | null) => void;
  toast: (kind: ToastKind, title: string, detail?: string) => void;
  notify: (spec: ToastSpec) => void;
  dismiss: (id: number) => void;
  ask: (spec: PromptSpec) => Promise<PromptValues | null>;
  closePrompt: (v: PromptValues | null) => void;
  toggleTheme: () => void;
}

let nextId = 1;

const savedTheme = (() => {
  try {
    return localStorage.getItem('gitstudio.theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
})();

export const useUi = create<UiStore>((set, get) => ({
  toasts: [],
  prompt: null,
  theme: savedTheme,
  dialog: null,
  openDialog: (dialog) => set({ dialog }),
  toast: (kind, title, detail) => get().notify({ kind, title, detail }),
  notify: ({ kind, title, detail, actions }) => {
    const id = nextId++;
    // Keep a trace of everything the user was told (Activity Logs → Application).
    logActivity({
      repo: null,
      label: '{text}',
      vars: { text: detail ? `${title} — ${detail}` : title },
      status: kind === 'error' ? 'failed' : 'info',
    });
    // Errors stay longer and longer details get more reading time.
    // Toasts with buttons (and warnings) get time to act on.
    const base =
      kind === 'error' || actions?.length || kind === 'warning'
        ? 9000
        : kind === 'success'
          ? 4000
          : 5000;
    const duration = base + Math.min(6000, (detail?.length ?? 0) * 30);
    set((s) => ({
      toasts: [...s.toasts.slice(-4), { id, kind, title, detail, actions, duration }],
    }));
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  ask: (spec) =>
    new Promise((resolve) => {
      get().prompt?.resolve(null);
      set({ prompt: { ...spec, resolve } });
    }),
  closePrompt: (v) => {
    const p = get().prompt;
    set({ prompt: null });
    p?.resolve(v);
  },
  toggleTheme: () => {
    const theme = get().theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem('gitstudio.theme', theme);
    } catch {
      /* ignore */
    }
    set({ theme });
  },
}));

export const toast = (kind: ToastKind, title: string, detail?: string) =>
  useUi.getState().toast(kind, title, detail);

/** A toast with a warning kind and/or action buttons. */
export const notify = (spec: ToastSpec) => useUi.getState().notify(spec);

export const ask = (spec: PromptSpec) => useUi.getState().ask(spec);

export const openDialog = (d: AppDialog | null) => useUi.getState().openDialog(d);

export async function confirm(
  title: string,
  description: string,
  confirmLabel = t('OK'),
  danger = false,
) {
  return (await ask({ title, description, confirmLabel, danger })) !== null;
}

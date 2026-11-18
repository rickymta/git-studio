import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
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

interface UiStore {
  toasts: Toast[];
  prompt: PromptState | null;
  theme: 'dark' | 'light';
  toast: (kind: ToastKind, title: string, detail?: string) => void;
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
  toast: (kind, title, detail) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, title, detail }] }));
    setTimeout(() => get().dismiss(id), kind === 'error' ? 9000 : 3500);
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

export const ask = (spec: PromptSpec) => useUi.getState().ask(spec);

export async function confirm(
  title: string,
  description: string,
  confirmLabel = 'OK',
  danger = false,
) {
  return (await ask({ title, description, confirmLabel, danger })) !== null;
}

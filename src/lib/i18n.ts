// Tiny i18n: English source strings are the keys, so untranslated text still reads fine.
//
//   t('Stage All Changes')
//   t('Stage {n} Files', { n: 3 })
//
// Components that show text call `useLang()` (directly or through a parent that re-keys on
// language change, see App), so switching language re-renders them.

import { create } from 'zustand';

import { vi } from '@/locales/vi';

export type Lang = 'en' | 'vi';

export const LANGUAGES: { id: Lang; label: string; native: string }[] = [
  { id: 'en', label: 'English', native: 'English' },
  { id: 'vi', label: 'Vietnamese', native: 'Tiếng Việt' },
];

const KEY = 'gitstudio.lang';

function saved(): Lang | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'en' || v === 'vi' ? v : null;
  } catch {
    return null;
  }
}

/** Best guess for the first-run picker. */
export function systemLang(): Lang {
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('vi')
    ? 'vi'
    : 'en';
}

interface LangStore {
  /** `null` until the user has picked a language (first run). */
  chosen: Lang | null;
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const useLangStore = create<LangStore>((set) => ({
  chosen: saved(),
  lang: saved() ?? 'en',
  setLang: (l) => {
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = l;
    set({ lang: l, chosen: l });
  },
}));

export const useLang = () => useLangStore((s) => s.lang);

const DICTS: Record<Lang, Record<string, string> | null> = { en: null, vi };

/** Translate `text` (an English source string) into the current language. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[useLangStore.getState().lang];
  let out = dict?.[text] ?? text;
  if (import.meta.env.DEV && dict && !(text in dict)) missing.add(text);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

/** English-only plural helper: `plural(n, 'file', 'files')`. Vietnamese has no plural forms. */
export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

// Dev aid: `window.__missingTranslations()` lists strings seen without a Vietnamese entry.
const missing = new Set<string>();
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __missingTranslations: () => string[] }).__missingTranslations = () => [
    ...missing,
  ];
}

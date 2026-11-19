// Per-user brightness of the whole UI, one value per theme (Preferences → UI Customization).
// Stored in browser storage under `gitstudio.*`, which persist.ts keeps in ui-state.json.

import { create } from 'zustand';

export type ThemeName = 'dark' | 'light';

export const BRIGHTNESS_MIN = 70;
export const BRIGHTNESS_MAX = 130;
export const BRIGHTNESS_STEP = 5;

const key = (theme: ThemeName) => `gitstudio.brightness.${theme}`;

/** Clamp to the slider's range and step; anything unreadable is 100 (unchanged). */
export function clampBrightness(v: number): number {
  if (!Number.isFinite(v)) return 100;
  const stepped = Math.round(v / BRIGHTNESS_STEP) * BRIGHTNESS_STEP;
  return Math.min(BRIGHTNESS_MAX, Math.max(BRIGHTNESS_MIN, stepped));
}

function load(theme: ThemeName): number {
  try {
    const raw = localStorage.getItem(key(theme));
    return raw === null ? 100 : clampBrightness(Number(raw));
  } catch {
    return 100;
  }
}

interface BrightnessStore {
  dark: number;
  light: number;
  set: (theme: ThemeName, value: number) => void;
}

export const useBrightnessStore = create<BrightnessStore>((set) => ({
  dark: load('dark'),
  light: load('light'),
  set: (theme, value) => {
    const v = clampBrightness(value);
    set({ [theme]: v } as Pick<BrightnessStore, ThemeName>);
    try {
      if (v === 100) localStorage.removeItem(key(theme));
      else localStorage.setItem(key(theme), String(v));
    } catch {
      /* ignore */
    }
  },
}));

export function useBrightness(theme: ThemeName): [number, (v: number) => void] {
  const value = useBrightnessStore((s) => s[theme]);
  const set = useBrightnessStore((s) => s.set);
  return [value, (v) => set(theme, v)];
}

/** Dim or brighten everything on screen (text, graph, diff, terminal) by `percent`. */
export function applyBrightness(percent: number) {
  const style = document.documentElement.style;
  if (percent === 100) style.removeProperty('filter');
  else style.setProperty('filter', `brightness(${percent / 100})`);
}

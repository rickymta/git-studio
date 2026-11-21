// A colour and a short tag per repository, to tell tabs apart at a glance. Kept per repository
// (not per tab or workspace): the mark comes back when the repository is opened again.

import { create } from 'zustand';

/** The fixed palette (ids are stored; the colours may change with the theme later). */
export const TAB_COLORS = [
  { id: 'red', label: 'Red', value: '#f87171' },
  { id: 'orange', label: 'Orange', value: '#fb923c' },
  { id: 'yellow', label: 'Yellow', value: '#facc15' },
  { id: 'green', label: 'Green', value: '#4ade80' },
  { id: 'teal', label: 'Teal', value: '#2dd4bf' },
  { id: 'blue', label: 'Blue', value: '#60a5fa' },
  { id: 'purple', label: 'Purple', value: '#a78bfa' },
  { id: 'pink', label: 'Pink', value: '#f472b6' },
] as const;

export type TabColor = (typeof TAB_COLORS)[number]['id'];

/** Longest tag, in characters. */
export const TAG_MAX = 5;

export interface TabMark {
  color?: TabColor;
  tag?: string;
}

const KEY = 'gitstudio.tabMarks';

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export const colorValue = (id: TabColor | undefined) => TAB_COLORS.find((c) => c.id === id)?.value;

/** A tag as stored: trimmed, inner spaces collapsed, at most TAG_MAX characters; '' for none. */
export function cleanTag(tag: string): string {
  return [...tag.trim().replace(/\s+/g, ' ')].slice(0, TAG_MAX).join('').trim();
}

function read(): Record<string, TabMark> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, TabMark>;
    const out: Record<string, TabMark> = {};
    for (const [k, m] of Object.entries(v ?? {})) {
      const color = TAB_COLORS.some((c) => c.id === m?.color) ? m.color : undefined;
      const tag = typeof m?.tag === 'string' ? cleanTag(m.tag) : '';
      if (color || tag) out[k] = { ...(color && { color }), ...(tag && { tag }) };
    }
    return out;
  } catch {
    return {};
  }
}

interface TabMarkStore {
  marks: Record<string, TabMark>;
  setColor: (path: string, color: TabColor | null) => void;
  /** '' or null removes the tag. */
  setTag: (path: string, tag: string | null) => void;
}

export const useTabMarks = create<TabMarkStore>((set, get) => {
  const edit = (path: string, patch: TabMark) => {
    const k = norm(path);
    const next = { ...get().marks };
    const m = { ...next[k], ...patch };
    if (!m.color) delete m.color;
    if (!m.tag) delete m.tag;
    if (m.color || m.tag) next[k] = m;
    else delete next[k];
    set({ marks: next });
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* the mark just won't survive a restart */
    }
  };
  return {
    marks: read(),
    setColor: (path, color) => edit(path, { color: color ?? undefined }),
    setTag: (path, tag) => edit(path, { tag: tag ? cleanTag(tag) : undefined }),
  };
});

/** The mark of one repository (a stable empty object when there is none). */
const NONE: TabMark = {};
export const useTabMark = (path: string) => useTabMarks((s) => s.marks[norm(path)] ?? NONE);
export const tabMarkOf = (path: string) => useTabMarks.getState().marks[norm(path)] ?? NONE;

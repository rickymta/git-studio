/**
 * Graph column settings (the gear menu at the right of the graph header, as in GitKraken):
 * which columns show, the compact graph, and Smart Branch Visibility.
 *
 * Kept in the `gitstudio.graphColumns` localStorage key, which `hydrateUiState` (lib/persist.ts)
 * mirrors to ui-state.json, so the layout survives restarts.
 */
import { create } from 'zustand';

import type { Commit, GitRef } from '@/lib/types';

export const COLUMNS = ['refs', 'graph', 'message', 'author', 'date', 'sha'] as const;
export type Column = (typeof COLUMNS)[number];

export interface ColumnSettings {
  /** Visible columns, always at least one. */
  visible: Column[];
  /** Narrow lanes and small nodes, so the graph column takes less room. */
  compactGraph: boolean;
  /** Dim commits that are not on the checked-out branch, its upstream or a base branch. */
  smartBranches: boolean;
}

/** Widths (px) a layout preset puts the resizable columns back to; 0 = automatic / fill. */
export interface LayoutWidths {
  refs: number;
  graph: number;
  message: number;
  author: number;
  date: number;
  sha: number;
}

export const DEFAULT_WIDTHS: LayoutWidths = {
  refs: 134,
  graph: 0,
  message: 0,
  author: 160,
  date: 112,
  sha: 80,
};
export const COMPACT_WIDTHS: LayoutWidths = { ...DEFAULT_WIDTHS, refs: 96 };

export const DEFAULT_SETTINGS: ColumnSettings = {
  visible: ['refs', 'graph', 'message'],
  compactGraph: false,
  smartBranches: false,
};

const KEY = 'gitstudio.graphColumns';
/** The earlier "Graph columns" menu kept only the optional columns here. */
const LEGACY_KEY = 'gitstudio.columns';

const isColumn = (x: unknown): x is Column => COLUMNS.includes(x as Column);
/** Columns in display order, without duplicates. */
const ordered = (cols: Iterable<Column>) => {
  const s = new Set(cols);
  return COLUMNS.filter((c) => s.has(c));
};

/** Settings from their stored JSON; anything unreadable falls back to the defaults. */
export function parseSettings(raw: string | null, legacy: string | null = null): ColumnSettings {
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (v && typeof v === 'object') {
      const visible = Array.isArray(v.visible) ? ordered(v.visible.filter(isColumn)) : [];
      return {
        visible: visible.length ? visible : DEFAULT_SETTINGS.visible,
        compactGraph: v.compactGraph === true,
        smartBranches: v.smartBranches === true,
      };
    }
  } catch {
    /* fall through */
  }
  try {
    const old: unknown = legacy ? JSON.parse(legacy) : null;
    if (Array.isArray(old))
      return {
        ...DEFAULT_SETTINGS,
        visible: ordered([...DEFAULT_SETTINGS.visible, ...old.filter(isColumn)]),
      };
  } catch {
    /* fall through */
  }
  return DEFAULT_SETTINGS;
}

/** Shows or hides a column; the last visible column stays. */
export function toggleColumn(s: ColumnSettings, c: Column): ColumnSettings {
  if (!s.visible.includes(c)) return { ...s, visible: ordered([...s.visible, c]) };
  if (s.visible.length <= 1) return s;
  return { ...s, visible: s.visible.filter((x) => x !== c) };
}

/** The default / compact layouts: the three main columns; compact also narrows the graph. */
export function resetLayout(s: ColumnSettings, compact: boolean): ColumnSettings {
  return { ...s, visible: DEFAULT_SETTINGS.visible, compactGraph: compact };
}

function load(): ColumnSettings {
  try {
    return parseSettings(localStorage.getItem(KEY), localStorage.getItem(LEGACY_KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function save(s: ColumnSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
}

interface ColumnStore extends ColumnSettings {
  toggle: (c: Column) => void;
  setCompactGraph: (on: boolean) => void;
  setSmartBranches: (on: boolean) => void;
  reset: (compact: boolean) => void;
}

const pick = (s: ColumnSettings): ColumnSettings => ({
  visible: s.visible,
  compactGraph: s.compactGraph,
  smartBranches: s.smartBranches,
});

export const useColumnSettings = create<ColumnStore>((set, get) => {
  const update = (next: ColumnSettings) => {
    set(next);
    save(next);
  };
  return {
    ...load(),
    toggle: (c) => update(toggleColumn(pick(get()), c)),
    setCompactGraph: (on) => update({ ...pick(get()), compactGraph: on }),
    setSmartBranches: (on) => update({ ...pick(get()), smartBranches: on }),
    reset: (compact) => update(resetLayout(pick(get()), compact)),
  };
});

// ---- Smart Branch Visibility --------------------------------------------------------------------

/** Branch names treated as the usual merge targets when the remote names no default branch. */
const BASE_NAMES = new Set(['main', 'master', 'develop', 'dev', 'trunk']);

/**
 * Tips of the branches Smart Branch Visibility keeps bright: the checked-out commit, the
 * upstream of the checked-out branch, and the base branches it most likely merges into — the
 * remote's default branch (what `origin/HEAD` points at) plus main / master / develop, local
 * and remote.
 */
export function focusTips(refs: GitRef[], head: string | null): string[] {
  const tips = new Set<string>();
  if (head) tips.add(head);
  const current = refs.find((r) => r.kind === 'local' && r.isHead);
  if (current) {
    tips.add(current.target);
    const up = refs.find((r) => r.kind === 'remote' && r.name === current.upstream);
    if (up) tips.add(up.target);
  }
  for (const r of refs) {
    if (r.kind !== 'local' && r.kind !== 'remote') continue;
    if (r.name.endsWith('/HEAD')) {
      // origin/HEAD: the remote's default branch.
      tips.add(r.target);
      continue;
    }
    const short = r.kind === 'remote' ? r.name.slice(r.name.indexOf('/') + 1) : r.name;
    if (BASE_NAMES.has(short)) tips.add(r.target);
  }
  return [...tips];
}

/**
 * Indexes of the loaded commits reachable from `tips` (following parents). A stash row is
 * related when the commit it was made on is. Everything else is an unrelated branch, dimmed.
 */
export function relatedRows(commits: Commit[], tips: string[]): Set<number> {
  const index = new Map(commits.map((c, i) => [c.hash, i]));
  const seen = new Set<number>();
  const stack = tips.map((h) => index.get(h)).filter((i): i is number => i !== undefined);
  while (stack.length) {
    const i = stack.pop()!;
    if (seen.has(i)) continue;
    seen.add(i);
    for (const p of commits[i]!.parents) {
      const j = index.get(p);
      if (j !== undefined && !seen.has(j)) stack.push(j);
    }
  }
  commits.forEach((c, i) => {
    const base = c.stash?.base;
    if (base && seen.has(index.get(base) ?? -1)) seen.add(i);
  });
  return seen;
}

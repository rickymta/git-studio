import { useState } from 'react';

import type { FileChange } from '@/lib/types';

// ---- view mode ----------------------------------------------------------------------------------

export type ViewMode = 'path' | 'tree';

export function useViewMode(): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem('gitstudio.fileView') === 'tree' ? 'tree' : 'path';
    } catch {
      return 'path';
    }
  });
  return [
    mode,
    (m) => {
      setMode(m);
      try {
        localStorage.setItem('gitstudio.fileView', m);
      } catch {
        /* ignore */
      }
    },
  ];
}

// ---- sorting ------------------------------------------------------------------------------------

export type FileSort = 'path' | 'path-desc' | 'name' | 'status';

export const SORT_LABEL: Record<FileSort, string> = {
  path: 'Path (A → Z)',
  'path-desc': 'Path (Z → A)',
  name: 'File name',
  status: 'Change type',
};

const STATUS_ORDER = 'U?AMTRCD';
const fileName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export function sortFiles(files: FileChange[], sort: FileSort): FileChange[] {
  const out = [...files];
  const byPath = (a: FileChange, b: FileChange) => a.path.localeCompare(b.path);
  if (sort === 'path') out.sort(byPath);
  else if (sort === 'path-desc') out.sort((a, b) => byPath(b, a));
  else if (sort === 'name')
    out.sort((a, b) => fileName(a.path).localeCompare(fileName(b.path)) || byPath(a, b));
  else
    out.sort(
      (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || byPath(a, b),
    );
  return out;
}

export function useFileSort(): [FileSort, (s: FileSort) => void] {
  const [sort, setSort] = useState<FileSort>(() => {
    try {
      const v = localStorage.getItem('gitstudio.fileSort') as FileSort | null;
      return v && v in SORT_LABEL ? v : 'path';
    } catch {
      return 'path';
    }
  });
  return [
    sort,
    (v) => {
      setSort(v);
      try {
        localStorage.setItem('gitstudio.fileSort', v);
      } catch {
        /* ignore */
      }
    },
  ];
}

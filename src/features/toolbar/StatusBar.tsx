import { GitPullRequest, Minus, Plus, ZoomIn } from 'lucide-react';
import { create } from 'zustand';

import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';

const ZOOM_KEY = 'gitstudio.zoom';

function initialZoom() {
  try {
    const v = Number(localStorage.getItem(ZOOM_KEY));
    return v >= 0.6 && v <= 2 ? v : 1;
  } catch {
    return 1;
  }
}

/** Zoom shared by the status bar, keyboard shortcuts and Preferences. */
const useZoomStore = create<{ zoom: number; set: (z: number) => void }>((set) => ({
  zoom: initialZoom(),
  set: (z) => {
    const v = Math.round(Math.min(2, Math.max(0.6, z)) * 10) / 10;
    set({ zoom: v });
    try {
      localStorage.setItem(ZOOM_KEY, String(v));
    } catch {
      /* ignore */
    }
  },
}));

export function useZoom(): [number, (z: number) => void] {
  const zoom = useZoomStore((s) => s.zoom);
  const set = useZoomStore((s) => s.set);
  return [zoom, set];
}

export function applyZoom(z: number) {
  (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = String(z);
}

export function StatusBar({ zoom, setZoom }: { zoom: number; setZoom: (z: number) => void }) {
  const path = useRepo((s) => s.path);
  const refs = useRepo((s) => s.refs);
  const pulls = useGitHub((s) => s.pulls);
  const user = useGitHub((s) => s.user);
  const hasGitHub = refs?.remotes.some((r) => r.github);
  const n = pulls?.length ?? 0;

  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-surface px-3 text-xs text-muted-foreground">
      {path && hasGitHub && (
        <span className="flex items-center gap-1.5">
          <GitPullRequest className="size-3.5" />
          {!user
            ? 'GitHub not connected'
            : n === 0
              ? 'No Pull Requests'
              : `${n} Pull Request${n > 1 ? 's' : ''}`}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{path ?? ''}</span>
      <span className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setZoom(zoom - 0.1)}
          className="hover:text-foreground"
        >
          <Minus className="size-3" />
        </button>
        <button
          type="button"
          title="Reset zoom (Ctrl+0)"
          onClick={() => setZoom(1)}
          className="flex items-center gap-1 hover:text-foreground"
        >
          <ZoomIn className="size-3.5" />
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setZoom(zoom + 0.1)}
          className="hover:text-foreground"
        >
          <Plus className="size-3" />
        </button>
      </span>
      <span className="font-mono">GitStudio 0.1.0</span>
    </div>
  );
}

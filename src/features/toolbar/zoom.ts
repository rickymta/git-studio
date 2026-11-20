import { create } from 'zustand';

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

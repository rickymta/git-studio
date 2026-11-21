// Dragging repositories and folders onto folders in the workspace overview. Pointer events, not
// HTML5 drag and drop: the desktop webview takes HTML5 drags for its own file drops.

import type { PointerEvent as ReactPointerEvent } from 'react';
import { create } from 'zustand';

export type DragItem =
  { kind: 'repo'; paths: string[]; label: string } | { kind: 'folder'; id: string; label: string };

interface DragState {
  item: DragItem | null;
  x: number;
  y: number;
  /** Folder id under the pointer that accepts the item ('' is the root); null for none. */
  over: string | null;
}

export const useFolderDrag = create<DragState>(() => ({ item: null, x: 0, y: 0, over: null }));

/** Attribute marking a drop target; its value is the folder id ('' for the root). */
export const DROP_ATTR = 'data-drop-folder';

const THRESHOLD = 5;

/**
 * Starts tracking a possible drag from a pointerdown. Nothing happens until the pointer moves a
 * few pixels, so a plain click still works; after a drag the click that follows is swallowed.
 */
export function beginDrag(
  e: ReactPointerEvent,
  item: DragItem,
  accept: (item: DragItem, folder: string) => boolean,
  drop: (item: DragItem, folder: string) => void,
) {
  if (e.button !== 0) return;
  // Buttons inside the row keep their own click.
  if ((e.target as HTMLElement).closest('button, input, a')) return;
  const sx = e.clientX;
  const sy = e.clientY;
  let dragging = false;

  const targetAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>(`[${DROP_ATTR}]`);
    if (!el) return null;
    const folder = el.getAttribute(DROP_ATTR) ?? '';
    return accept(item, folder) ? folder : null;
  };

  const move = (ev: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return;
      dragging = true;
      document.body.style.cursor = 'grabbing';
    }
    useFolderDrag.setState({
      item,
      x: ev.clientX,
      y: ev.clientY,
      over: targetAt(ev.clientX, ev.clientY),
    });
  };
  const end = (commit: boolean) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('keydown', key, true);
    document.body.style.cursor = '';
    const { over } = useFolderDrag.getState();
    useFolderDrag.setState({ item: null, over: null });
    if (!dragging) return;
    // The click the browser fires after this pointerup must not open the row.
    const swallow = (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    if (commit && over !== null) drop(item, over);
  };
  const up = () => end(true);
  const key = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      end(false);
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('keydown', key, true);
}

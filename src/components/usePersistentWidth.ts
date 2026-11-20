import { useCallback, useState } from 'react';

/** A width in px persisted in localStorage, clamped to [min, max]. */
export function usePersistentWidth(
  key: string,
  initial: number,
  min: number,
  max: number,
): [number, (w: number) => void] {
  const [w, setW] = useState(() => {
    try {
      const v = Number(localStorage.getItem(`gitstudio.width.${key}`));
      return v >= min && v <= max ? v : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: number) => {
      const c = Math.round(Math.min(max, Math.max(min, v)));
      setW(c);
      try {
        localStorage.setItem(`gitstudio.width.${key}`, String(c));
      } catch {
        /* ignore */
      }
    },
    [key, min, max],
  );
  return [w, set];
}

// Terminal font: the one the user's own terminal uses (Windows Terminal settings), so prompts
// drawn with icon glyphs (oh-my-posh, starship, Nerd Fonts) don't turn into boxes here.

import { api } from '@/lib/ipc';
import type { TerminalFont } from '@/lib/types';

/** After the user's font: a Nerd Font symbols-only face for icons, then plain monospace. */
export const FALLBACK_FONTS =
  "'Symbols Nerd Font Mono', 'Symbols Nerd Font', ui-monospace, 'Cascadia Mono', 'Cascadia Code', Consolas, monospace";

/** px; used when the user's terminal sets no size. */
export const DEFAULT_FONT_SIZE = 13;

export interface XtermFont {
  fontFamily: string;
  fontSize: number;
  fontWeight?: number;
}

const quote = (face: string) => `"${face.replace(/["\\]/g, '')}"`;

/** xterm options for `font`. Sizes are stored in points; xterm wants CSS pixels. */
export function xtermFont(font: TerminalFont | null | undefined): XtermFont {
  const face = font?.face?.trim();
  const out: XtermFont = {
    fontFamily: face ? `${quote(face)}, ${FALLBACK_FONTS}` : FALLBACK_FONTS,
    fontSize:
      font?.size && font.size > 0
        ? Math.max(8, Math.min(32, Math.round((font.size * 4) / 3)))
        : DEFAULT_FONT_SIZE,
  };
  if (font?.weight) out.fontWeight = font.weight;
  return out;
}

let cached: Promise<XtermFont> | null = null;

/** The user's terminal font, read once per run; resolves even when it can't be read. */
export function systemFont(): Promise<XtermFont> {
  cached ??= api
    .terminalFont()
    .catch(() => null)
    .then(async (f) => {
      const opts = xtermFont(f);
      // xterm measures the cell size when it opens; make sure the face is ready by then.
      try {
        await document.fonts.load(`${opts.fontSize}px ${opts.fontFamily}`);
      } catch {
        /* measured with whatever is available */
      }
      return opts;
    });
  return cached;
}

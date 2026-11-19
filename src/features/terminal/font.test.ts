import { describe, expect, it } from 'vitest';

import { DEFAULT_FONT_SIZE, FALLBACK_FONTS, xtermFont } from './font';

describe('xtermFont', () => {
  it('puts the user font first and keeps icon and monospace fallbacks', () => {
    const f = xtermFont({ face: 'MesloLGL Nerd Font Mono' });
    expect(f.fontFamily).toBe(`"MesloLGL Nerd Font Mono", ${FALLBACK_FONTS}`);
    expect(f.fontSize).toBe(DEFAULT_FONT_SIZE);
    expect(f.fontWeight).toBeUndefined();
  });

  it('falls back when nothing is configured', () => {
    expect(xtermFont(null)).toEqual({ fontFamily: FALLBACK_FONTS, fontSize: DEFAULT_FONT_SIZE });
    expect(xtermFont({ face: '  ' }).fontFamily).toBe(FALLBACK_FONTS);
  });

  it('converts points to pixels and clamps', () => {
    expect(xtermFont({ size: 12 }).fontSize).toBe(16);
    expect(xtermFont({ size: 10.5 }).fontSize).toBe(14);
    expect(xtermFont({ size: 2 }).fontSize).toBe(8);
    expect(xtermFont({ size: 72 }).fontSize).toBe(32);
  });

  it('passes the weight and strips quotes from the face', () => {
    const f = xtermFont({ face: 'Odd "Name"', weight: 600 });
    expect(f.fontFamily.startsWith('"Odd Name", ')).toBe(true);
    expect(f.fontWeight).toBe(600);
  });
});

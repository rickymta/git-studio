import { describe, expect, it } from 'vitest';

import { lfsPatternFor } from './repoTools';

describe('lfsPatternFor', () => {
  it('tracks by extension, else the file itself', () => {
    expect(lfsPatternFor('assets\\art\\logo.psd')).toBe('*.psd');
    expect(lfsPatternFor('bin/tool')).toBe('bin/tool');
    expect(lfsPatternFor('.env')).toBe('.env');
  });
});

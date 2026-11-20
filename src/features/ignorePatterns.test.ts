import { describe, expect, it } from 'vitest';

import { ignorePatterns } from './actions';

describe('ignorePatterns', () => {
  it('offers the file, its extension and each parent folder', () => {
    expect(ignorePatterns('src/gen/out.map.js')).toEqual([
      '/src/gen/out.map.js',
      '*.js',
      '/src/gen/',
      '/src/',
    ]);
  });

  it('handles dotfiles, files without extension and Windows separators', () => {
    expect(ignorePatterns('.env')).toEqual(['/.env']);
    expect(ignorePatterns('Makefile')).toEqual(['/Makefile']);
    expect(ignorePatterns('build\\tmp\\')).toEqual(['/build/tmp', '/build/']);
  });
});

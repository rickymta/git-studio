import { describe, expect, it } from 'vitest';

import { imageMime, imageSides } from './image';

describe('imageMime', () => {
  it('knows image extensions, case-insensitively', () => {
    expect(imageMime('a/b/Logo.PNG')).toBe('image/png');
    expect(imageMime('icon.svg')).toBe('image/svg+xml');
    expect(imageMime('photo.jpeg')).toBe('image/jpeg');
  });
  it('ignores other files and dots in folder names', () => {
    expect(imageMime('main.rs')).toBeNull();
    expect(imageMime('v1.png/readme')).toBeNull();
    expect(imageMime('Makefile')).toBeNull();
  });
});

describe('imageSides', () => {
  it('compares the index with the working tree for unstaged changes', () => {
    expect(imageSides({ source: 'unstaged', path: 'a.png' })).toEqual({
      before: { path: 'a.png', rev: ':' },
      after: { path: 'a.png', rev: null },
    });
    expect(imageSides({ source: 'unstaged', path: 'a.png', untracked: true }).before).toBeNull();
  });
  it('compares HEAD with the index for staged changes, by the old name', () => {
    expect(imageSides({ source: 'staged', path: 'b.png', origPath: 'a.png' })).toEqual({
      before: { path: 'a.png', rev: 'HEAD' },
      after: { path: 'b.png', rev: ':' },
    });
  });
  it('compares a commit with its parent', () => {
    expect(imageSides({ source: 'commit', path: 'a.png', commit: 'abc' })).toEqual({
      before: { path: 'a.png', rev: 'abc^' },
      after: { path: 'a.png', rev: 'abc' },
    });
    expect(
      imageSides({ source: 'commit', path: 'a.png', commit: 'abc', parent: 'def' }).before,
    ).toEqual({ path: 'a.png', rev: 'def' });
  });
});

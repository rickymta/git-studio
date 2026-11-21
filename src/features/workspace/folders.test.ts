import { describe, expect, it } from 'vitest';

import type { Workspace, WorkspaceFolder } from '@/lib/types';
import * as F from './folders';

const folder = (id: string, parent = ''): WorkspaceFolder => ({
  id,
  name: id.toUpperCase(),
  parent,
  collapsed: false,
});

// a ─ b ─ c   (three levels), d at the root
const ws = (): Workspace => ({
  id: 'w',
  name: 'W',
  color: '#fff',
  repos: ['D:/x/one', 'D:/x/two', 'D:\\x\\three', 'D:/x/four'],
  folders: [folder('a'), folder('b', 'a'), folder('c', 'b'), folder('d')],
  placement: { 'd:/x/two': 'a', 'd:/x/three': 'c', 'd:/x/four': 'd' },
});

describe('workspace folders', () => {
  it('measures depth and height', () => {
    const f = ws().folders!;
    expect(F.depthOf(f, '')).toBe(0);
    expect(F.depthOf(f, 'c')).toBe(3);
    expect(F.heightOf(f, 'a')).toBe(3);
    expect(F.heightOf(f, 'd')).toBe(1);
  });

  it('allows at most three levels', () => {
    const w = ws();
    expect(F.canNest(w.folders!, 'b')).toBe(true);
    expect(F.canNest(w.folders!, 'c')).toBe(false);
    expect(F.addFolder(w, 'c', 'too deep', 'z')).toBe(w);
    expect(F.addFolder(w, 'b', 'ok', 'z').folders!.at(-1)).toMatchObject({ id: 'z', parent: 'b' });
  });

  it('moves folders only where they fit, never into themselves', () => {
    const f = ws().folders!;
    expect(F.canMove(f, 'a', 'c')).toBe(false); // own descendant
    expect(F.canMove(f, 'a', 'd')).toBe(false); // would be 4 levels
    expect(F.canMove(f, 'b', 'd')).toBe(true); // b─c under d: 3 levels
    expect(F.canMove(f, 'd', 'b')).toBe(true);
    expect(F.canMove(f, 'd', 'c')).toBe(false);
  });

  it('places repositories by normalised path, root by default', () => {
    const w = ws();
    expect(F.folderOf(w, 'D:/x/one')).toBe('');
    expect(F.folderOf(w, 'D:/x/three')).toBe('c');
    expect(F.reposIn(w, '')).toEqual(['D:/x/one']);
    expect(F.reposIn(w, 'a', true)).toEqual(['D:/x/two', 'D:\\x\\three']);
    expect(F.reposIn(w, '', true)).toHaveLength(4);
    const moved = F.moveRepos(w, ['D:/x/two'], '');
    expect(F.folderOf(moved, 'D:/x/two')).toBe('');
  });

  it('deleting a folder moves what it holds up to its parent', () => {
    const w = F.deleteFolder(ws(), 'b');
    expect(w.folders!.find((f) => f.id === 'c')!.parent).toBe('a');
    expect(F.folderOf(w, 'D:/x/three')).toBe('c');
    const top = F.deleteFolder(ws(), 'd');
    expect(F.folderOf(top, 'D:/x/four')).toBe('');
  });

  it('repairs broken trees', () => {
    const w = F.sanitize({
      ...ws(),
      folders: [
        folder('a'),
        folder('b', 'a'),
        folder('c', 'b'),
        folder('deep', 'c'), // 4th level
        folder('orphan', 'gone'),
        folder('x', 'y'),
        folder('y', 'x'), // cycle
      ],
      placement: { 'd:/x/two': 'gone', 'd:/x/one': 'a', 'd:/x/elsewhere': 'a' },
    });
    const parent = (id: string) => w.folders!.find((f) => f.id === id)!.parent;
    expect(parent('deep')).toBe('b');
    expect(parent('orphan')).toBe('');
    expect(F.depthOf(w.folders!, 'x')).toBeLessThanOrEqual(2);
    expect(F.depthOf(w.folders!, 'y')).toBeLessThanOrEqual(2);
    expect(w.placement).toEqual({ 'd:/x/one': 'a' });
  });
});

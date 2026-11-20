// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileBlob } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { button, change, cleanup, click, render, text } from '@/test/dom';
import { ImageDiff } from './ImageDiff';

type FileBlobFn = (repo: string, path: string, rev: string | null) => Promise<FileBlob | null>;
const api = vi.hoisted(() => ({ fileBlob: vi.fn<FileBlobFn>() }));
vi.mock('@/lib/ipc', () => ({ api, isTauri: false }));

const blobs: Record<string, FileBlob | null> = {};

beforeEach(() => {
  useRepo.setState({ path: '/repo' });
  api.fileBlob.mockImplementation(async (_r, _p, rev) => blobs[String(rev)] ?? null);
  blobs[':'] = { size: 3, data: 'T0xE' };
  blobs.null = { size: 2048, data: 'TkVX' };
});
afterEach(async () => {
  await cleanup();
  for (const k of Object.keys(blobs)) delete blobs[k];
  vi.clearAllMocks();
});

const images = () => [...document.querySelectorAll('img')].map((i) => i.getAttribute('src'));

describe('ImageDiff', () => {
  it('shows the index and working tree versions of an unstaged image side by side', async () => {
    await render(<ImageDiff request={{ source: 'unstaged', path: 'a.png' }} refreshKey="" />);
    expect(api.fileBlob).toHaveBeenCalledWith('/repo', 'a.png', ':');
    expect(api.fileBlob).toHaveBeenCalledWith('/repo', 'a.png', null);
    expect(images()).toEqual(['data:image/png;base64,T0xE', 'data:image/png;base64,TkVX']);
    expect(text()).toContain('2.0 KB');
  });

  it('swipes and fades the new version over the old one', async () => {
    await render(<ImageDiff request={{ source: 'unstaged', path: 'a.png' }} refreshKey="" />);
    await click(button('Swipe'));
    const slider = document.querySelector('input[type=range]');
    const after = () => document.querySelectorAll('img')[1] as HTMLImageElement;
    // jsdom writes the zero insets as 0px.
    expect(after().style.clipPath).toMatch(/^inset\(.* 50%\)$/);
    await change(slider, '20');
    expect(after().style.clipPath).toMatch(/^inset\(.* 20%\)$/);

    await click(button('Onion skin'));
    expect(after().style.opacity).toBe('0.2');
    await click(button('Side by side'));
    expect(document.querySelector('input[type=range]')).toBeNull();
  });

  it('has no "before" for a new file and offers no overlay modes', async () => {
    await render(
      <ImageDiff request={{ source: 'unstaged', path: 'a.png', untracked: true }} refreshKey="" />,
    );
    expect(api.fileBlob).toHaveBeenCalledTimes(1);
    expect(text()).toContain('No file before this change');
    expect(images()).toHaveLength(1);
    expect(() => button('Swipe')).toThrow();
  });

  it('shows only the size of an image over the preview limit', async () => {
    blobs.null = { size: 50 * 1024 * 1024, data: null };
    await render(<ImageDiff request={{ source: 'unstaged', path: 'a.png' }} refreshKey="" />);
    expect(text()).toContain('Too large to preview (50.0 MB)');
    expect(images()).toHaveLength(1);
  });

  it('compares a commit with its parent, by the old name of a renamed file', async () => {
    blobs['abc^'] = { size: 1, data: 'T0xE' };
    blobs.abc = { size: 1, data: 'TkVX' };
    await render(
      <ImageDiff
        request={{ source: 'commit', path: 'new.png', origPath: 'old.png', commit: 'abc' }}
        refreshKey=""
      />,
    );
    expect(api.fileBlob).toHaveBeenCalledWith('/repo', 'old.png', 'abc^');
    expect(api.fileBlob).toHaveBeenCalledWith('/repo', 'new.png', 'abc');
    expect(images()).toHaveLength(2);
  });
});

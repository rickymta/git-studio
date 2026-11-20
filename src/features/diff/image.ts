import type { DiffRequest } from '@/lib/types';

const MIME: Record<string, string> = {
  png: 'image/png',
  apng: 'image/apng',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  cur: 'image/x-icon',
  svg: 'image/svg+xml',
};

/** The image type of `path` by its extension; `null` for anything the webview can't show. */
export function imageMime(path: string): string | null {
  const dot = path.lastIndexOf('.');
  if (dot < 0 || dot < path.lastIndexOf('/')) return null;
  return MIME[path.slice(dot + 1).toLowerCase()] ?? null;
}

/** Where a file is read from: a commit, `':'` (the index) or `null` (the working tree). */
export interface BlobSide {
  path: string;
  rev: string | null;
}

/** The old and new version a diff compares; `null` when that side has no file. */
export function imageSides(req: DiffRequest): { before: BlobSide | null; after: BlobSide } {
  const old = req.origPath || req.path;
  switch (req.source) {
    case 'unstaged':
      return {
        before: req.untracked ? null : { path: old, rev: ':' },
        after: { path: req.path, rev: null },
      };
    case 'staged':
      return { before: { path: old, rev: 'HEAD' }, after: { path: req.path, rev: ':' } };
    case 'worktree':
      return {
        before: { path: old, rev: req.commit ?? 'HEAD' },
        after: { path: req.path, rev: null },
      };
    case 'commit':
    default:
      return {
        before: { path: old, rev: req.parent ?? `${req.commit}^` },
        after: { path: req.path, rev: req.commit ?? 'HEAD' },
      };
  }
}

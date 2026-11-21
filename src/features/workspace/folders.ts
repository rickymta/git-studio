// Folders inside a workspace: a tree of at most MAX_DEPTH levels grouping related
// repositories. A repository not placed in any folder sits at the workspace's root ('').

import type { Workspace, WorkspaceFolder } from '@/lib/types';

export const MAX_DEPTH = 3;
export const ROOT = '';

/** The key repositories are placed under: their path, normalised. */
export const placeKey = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

const byId = (folders: WorkspaceFolder[]) => new Map(folders.map((f) => [f.id, f]));

/** 1 for a folder at the root, 2 for one inside it…; 0 for the root itself. */
export function depthOf(folders: WorkspaceFolder[], id: string): number {
  const map = byId(folders);
  let depth = 0;
  for (let f = map.get(id); f && depth <= folders.length; f = map.get(f.parent)) depth++;
  return depth;
}

/** Levels in the subtree under `id`, the folder itself included (1 for a leaf). */
export function heightOf(folders: WorkspaceFolder[], id: string): number {
  const kids = folders.filter((f) => f.parent === id);
  return 1 + Math.max(0, ...kids.map((k) => heightOf(folders, k.id)));
}

/** `id` and every folder under it. */
export function subtree(folders: WorkspaceFolder[], id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const f of folders)
      if (out.has(f.parent) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
  }
  return out;
}

/** Whether a new folder can go inside `parent`. */
export const canNest = (folders: WorkspaceFolder[], parent: string) =>
  depthOf(folders, parent) < MAX_DEPTH;

/** Whether folder `id` can move into `parent`: not into itself, and staying within MAX_DEPTH. */
export function canMove(folders: WorkspaceFolder[], id: string, parent: string): boolean {
  if (id === parent || (parent && subtree(folders, id).has(parent))) return false;
  return depthOf(folders, parent) + heightOf(folders, id) <= MAX_DEPTH;
}

/** The folder a repository sits in ('' for the root, also when its folder is gone). */
export function folderOf(ws: Workspace, path: string): string {
  const id = ws.placement?.[placeKey(path)] ?? ROOT;
  return id && (ws.folders ?? []).some((f) => f.id === id) ? id : ROOT;
}

/** The repositories directly in `folder`, or in it and every folder under it. */
export function reposIn(ws: Workspace, folder: string, deep = false): string[] {
  const set = deep && folder ? subtree(ws.folders ?? [], folder) : new Set([folder]);
  return ws.repos.filter((p) => (deep && !folder) || set.has(folderOf(ws, p)));
}

/** Folders under `parent`, sorted by name. */
export const childrenOf = (folders: WorkspaceFolder[], parent: string) =>
  folders
    .filter((f) => f.parent === parent)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

/** The folders from the root down to `id`. */
export function pathTo(folders: WorkspaceFolder[], id: string): WorkspaceFolder[] {
  const map = byId(folders);
  const out: WorkspaceFolder[] = [];
  for (let f = map.get(id); f && out.length <= folders.length; f = map.get(f.parent))
    out.unshift(f);
  return out;
}

/**
 * Repairs what a hand-edited or older file may hold: folders whose parent is gone go to the
 * root, cycles are broken, folders past MAX_DEPTH move up, and placements of repositories no
 * longer in the workspace (or into folders that are gone) are dropped.
 */
export function sanitize(ws: Workspace): Workspace {
  const seen = new Set<string>();
  let folders = (ws.folders ?? []).filter((f) => f.id && !seen.has(f.id) && seen.add(f.id));
  const ids = new Set(folders.map((f) => f.id));
  folders = folders.map((f) =>
    f.parent && ids.has(f.parent) && f.parent !== f.id ? f : { ...f, parent: ROOT },
  );
  // Break cycles: a folder whose ancestry never reaches the root goes to the root.
  folders = folders.map((f) => {
    const map = byId(folders);
    let cur: WorkspaceFolder | undefined = f;
    for (let steps = 0; cur && cur.parent; steps++) {
      if (steps > folders.length) return { ...f, parent: ROOT };
      cur = map.get(cur.parent);
    }
    return f;
  });
  // Too deep: hang it under its ancestor at MAX_DEPTH - 1.
  folders = folders.map((f) => {
    const chain = pathTo(folders, f.id);
    return chain.length > MAX_DEPTH ? { ...f, parent: chain[MAX_DEPTH - 2]!.id } : f;
  });
  const valid = new Set(folders.map((f) => f.id));
  const repos = new Set(ws.repos.map(placeKey));
  const placement: Record<string, string> = {};
  for (const [k, v] of Object.entries(ws.placement ?? {}))
    if (v && valid.has(v) && repos.has(k)) placement[k] = v;
  return { ...ws, folders, placement };
}

// ---- edits (pure: return the new workspace) ------------------------------------------------

export function addFolder(ws: Workspace, parent: string, name: string, id: string): Workspace {
  const folders = ws.folders ?? [];
  if (!canNest(folders, parent)) return ws;
  return { ...ws, folders: [...folders, { id, name: name.trim(), parent, collapsed: false }] };
}

export function patchFolder(ws: Workspace, id: string, patch: Partial<WorkspaceFolder>): Workspace {
  return {
    ...ws,
    folders: (ws.folders ?? []).map((f) => (f.id === id ? { ...f, ...patch, id } : f)),
  };
}

export function moveFolder(ws: Workspace, id: string, parent: string): Workspace {
  if (!canMove(ws.folders ?? [], id, parent)) return ws;
  return patchFolder(ws, id, { parent });
}

/** Deletes a folder; what it held (folders and repositories) moves up to its parent. */
export function deleteFolder(ws: Workspace, id: string): Workspace {
  const folders = ws.folders ?? [];
  const gone = folders.find((f) => f.id === id);
  if (!gone) return ws;
  const placement: Record<string, string> = {};
  for (const [k, v] of Object.entries(ws.placement ?? {}))
    if (v !== id) placement[k] = v;
    else if (gone.parent) placement[k] = gone.parent;
  return {
    ...ws,
    folders: folders
      .filter((f) => f.id !== id)
      .map((f) => (f.parent === id ? { ...f, parent: gone.parent } : f)),
    placement,
  };
}

export function moveRepos(ws: Workspace, paths: string[], folder: string): Workspace {
  const placement = { ...(ws.placement ?? {}) };
  for (const p of paths)
    if (folder) placement[placeKey(p)] = folder;
    else delete placement[placeKey(p)];
  return { ...ws, placement };
}

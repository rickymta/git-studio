import { Folder, FolderPlus, Layers } from 'lucide-react';

import type { MenuItem } from '@/components/ui';
import { t } from '@/lib/i18n';
import type { Workspace, WorkspaceFolder } from '@/lib/types';
import { ask, confirm } from '@/stores/ui';
import { useWorkspaces } from '@/stores/workspace';
import type { DragItem } from './folderDrag';
import * as F from './folders';

// ---- shared actions -------------------------------------------------------------------------

/** Every folder in tree order with its depth (1 = at the root). */
export function flatFolders(ws: Workspace): { f: WorkspaceFolder; depth: number }[] {
  const out: { f: WorkspaceFolder; depth: number }[] = [];
  const walk = (parent: string, depth: number) => {
    for (const f of F.childrenOf(ws.folders ?? [], parent)) {
      out.push({ f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(F.ROOT, 1);
  return out;
}

const indent = (depth: number, name: string) => `${' '.repeat(depth - 1)}${name}`;

/** Asks for a name and creates a folder inside `parent`; returns its id. */
export async function newFolder(ws: Workspace, parent: string): Promise<string | null> {
  if (!F.canNest(ws.folders ?? [], parent)) return null;
  const v = await ask({
    title: parent ? t('New subfolder') : t('New folder'),
    fields: [{ name: 'name', label: t('Name'), required: true }],
    confirmLabel: t('Create'),
  });
  if (!v) return null;
  return useWorkspaces.getState().addFolder(ws.id, parent, v.name as string);
}

/** "Move to" choices for repositories (any folder) or a folder (where it still fits). */
export function moveTargets(
  ws: Workspace,
  current: string,
  onPick: (folder: string) => void,
  folderId?: string,
): MenuItem[] {
  const folders = ws.folders ?? [];
  const ok = (target: string) =>
    target !== current && (!folderId || F.canMove(folders, folderId, target));
  return [
    {
      label: t('{name} (root)', { name: ws.name }),
      icon: <Layers className="size-3.5" />,
      disabled: !ok(F.ROOT),
      onSelect: () => onPick(F.ROOT),
    },
    ...flatFolders(ws).map(({ f, depth }): MenuItem => ({
      label: indent(depth, f.name),
      icon: <Folder className="size-3.5" />,
      disabled: !ok(f.id),
      onSelect: () => onPick(f.id),
    })),
  ];
}

export function folderMenu(
  ws: Workspace,
  f: WorkspaceFolder,
  onSelect?: (id: string) => void,
): MenuItem[] {
  const store = useWorkspaces.getState();
  const folders = ws.folders ?? [];
  return [
    {
      label: t('New subfolder…'),
      icon: <FolderPlus className="size-3.5" />,
      disabled: !F.canNest(folders, f.id),
      onSelect: async () => {
        const id = await newFolder(ws, f.id);
        if (id) await store.toggleFolder(ws.id, f.id, false);
      },
    },
    {
      label: t('Rename folder…'),
      onSelect: async () => {
        const v = await ask({
          title: t('Rename folder'),
          fields: [{ name: 'name', label: t('Name'), initial: f.name, required: true }],
          confirmLabel: t('Rename'),
        });
        if (v) await store.renameFolder(ws.id, f.id, v.name as string);
      },
    },
    {
      label: t('Move to'),
      items: moveTargets(ws, f.parent, (to) => void store.moveFolder(ws.id, f.id, to), f.id),
    },
    'sep',
    {
      label: t('Delete folder'),
      danger: true,
      onSelect: async () => {
        const parent = folders.find((x) => x.id === f.parent);
        if (
          await confirm(
            t('Delete folder'),
            t(
              'Delete the folder “{name}”? What it holds moves to {parent}; no repository is removed.',
              {
                name: f.name,
                parent: parent ? `“${parent.name}”` : t('the workspace root'),
              },
            ),
            t('Delete'),
            true,
          )
        ) {
          await store.deleteFolder(ws.id, f.id);
          onSelect?.(f.parent);
        }
      },
    },
  ];
}

/** Whether a dragged item may land in `folder`. */
export function acceptDrop(ws: Workspace, item: DragItem, folder: string): boolean {
  if (item.kind === 'folder') return F.canMove(ws.folders ?? [], item.id, folder);
  return item.paths.some((p) => F.folderOf(ws, p) !== folder);
}

export function applyDrop(ws: Workspace, item: DragItem, folder: string) {
  const store = useWorkspaces.getState();
  if (item.kind === 'folder') void store.moveFolder(ws.id, item.id, folder);
  else void store.moveRepos(ws.id, item.paths, folder);
}

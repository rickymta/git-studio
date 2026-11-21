import {
  ChevronRight,
  Folder,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  Layers,
  MoreHorizontal,
} from 'lucide-react';

import { ContextMenuWrap, Dropdown, IconButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import type { Workspace, WorkspaceFolder } from '@/lib/types';
import { useWorkspaces } from '@/stores/workspace';
import { acceptDrop, applyDrop, folderMenu, newFolder } from './folderActions';
import { beginDrag, DROP_ATTR, useFolderDrag } from './folderDrag';
import * as F from './folders';

/** The label following the pointer while dragging. */
export function DragGhost() {
  const { item, x, y, over } = useFolderDrag();
  if (!item) return null;
  return (
    <div
      className="pointer-events-none fixed z-[100] flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-xl"
      style={{ left: x + 12, top: y + 8, opacity: over === null ? 0.7 : 1 }}
    >
      {item.kind === 'repo' ? (
        <FolderGit2 className="size-3.5 text-accent" />
      ) : (
        <Folder className="size-3.5 text-accent" />
      )}
      {item.label}
    </div>
  );
}

// ---- the tree -------------------------------------------------------------------------------

/** The folder tree beside the overview: picks which folder the list shows. */
export function FolderTree({
  ws,
  selected,
  counts,
  onSelect,
}: {
  ws: Workspace;
  selected: string;
  /** Repositories in each folder and below it, by folder id ('' = the whole workspace). */
  counts: Record<string, number>;
  onSelect: (id: string) => void;
}) {
  const over = useFolderDrag((s) => s.over);
  const dragging = useFolderDrag((s) => s.item !== null);
  const folders = ws.folders ?? [];

  const node = (f: WorkspaceFolder, depth: number) => {
    const kids = F.childrenOf(folders, f.id);
    const open = !f.collapsed;
    const isSel = selected === f.id;
    return (
      <div key={f.id}>
        <ContextMenuWrap items={() => folderMenu(ws, f, onSelect)}>
          <div
            role="treeitem"
            aria-selected={isSel}
            aria-expanded={kids.length ? open : undefined}
            tabIndex={0}
            {...{ [DROP_ATTR]: f.id }}
            onClick={() => onSelect(f.id)}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(f.id)}
            onPointerDown={(e) =>
              beginDrag(
                e,
                { kind: 'folder', id: f.id, label: f.name },
                (it, to) => acceptDrop(ws, it, to),
                (it, to) => applyDrop(ws, it, to),
              )
            }
            style={{ paddingLeft: 6 + (depth - 1) * 14 }}
            className={cn(
              'group flex h-7 cursor-default items-center gap-1 rounded-md pr-1 text-[13px]',
              isSel
                ? 'bg-accent-soft text-foreground'
                : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
              over === f.id && 'ring-1 ring-accent ring-inset',
            )}
          >
            <button
              type="button"
              aria-label={open ? t('Collapse') : t('Expand')}
              onClick={(e) => {
                e.stopPropagation();
                void useWorkspaces.getState().toggleFolder(ws.id, f.id);
              }}
              className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded',
                !kids.length && 'invisible',
              )}
            >
              <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
            </button>
            {open && kids.length ? (
              <FolderOpen className="size-3.5 shrink-0" style={{ color: ws.color }} />
            ) : (
              <Folder className="size-3.5 shrink-0" style={{ color: ws.color }} />
            )}
            <span className={cn('min-w-0 flex-1 truncate', isSel && 'font-medium')}>{f.name}</span>
            <span className="text-[11px] tabular-nums opacity-70 group-hover:hidden">
              {counts[f.id] ?? 0}
            </span>
            <Dropdown items={folderMenu(ws, f, onSelect)}>
              <IconButton
                label={t('Folder options')}
                className="hidden size-5 group-hover:flex"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="size-3.5" />
              </IconButton>
            </Dropdown>
          </div>
        </ContextMenuWrap>
        {open && kids.map((k) => node(k, depth + 1))}
      </div>
    );
  };

  return (
    <nav role="tree" aria-label={t('Folders')} className="flex flex-col gap-0.5">
      <div className="mb-1 flex items-center gap-1 px-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        <span className="flex-1">{t('Folders')}</span>
        <IconButton
          label={t('New folder')}
          className="size-5"
          onClick={() => void newFolder(ws, F.ROOT)}
        >
          <FolderPlus className="size-3.5" />
        </IconButton>
      </div>
      <div
        role="treeitem"
        aria-selected={selected === F.ROOT}
        tabIndex={0}
        {...{ [DROP_ATTR]: F.ROOT }}
        onClick={() => onSelect(F.ROOT)}
        onKeyDown={(e) => e.key === 'Enter' && onSelect(F.ROOT)}
        className={cn(
          'flex h-7 cursor-default items-center gap-1.5 rounded-md px-1.5 text-[13px]',
          selected === F.ROOT
            ? 'bg-accent-soft text-foreground'
            : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
          over === F.ROOT && 'ring-1 ring-accent ring-inset',
        )}
      >
        <Layers className="size-3.5 shrink-0" style={{ color: ws.color }} />
        <span className={cn('min-w-0 flex-1 truncate', selected === F.ROOT && 'font-medium')}>
          {t('All repositories')}
        </span>
        <span className="text-[11px] tabular-nums opacity-70">{counts[F.ROOT] ?? 0}</span>
      </div>
      {F.childrenOf(folders, F.ROOT).map((f) => node(f, 1))}
      {folders.length === 0 && (
        <button
          type="button"
          onClick={() => void newFolder(ws, F.ROOT)}
          className="mt-1 rounded-md border border-dashed border-border px-2 py-2 text-left text-xs text-muted-foreground hover:bg-surface-hover"
        >
          {t('Group related repositories into folders (up to 3 levels).')}
        </button>
      )}
      {dragging && (
        <div className="mt-2 px-1.5 text-[11px] text-muted-foreground">
          {t('Drop on a folder to move it there. Esc cancels.')}
        </div>
      )}
    </nav>
  );
}

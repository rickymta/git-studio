import {
  ArrowDownUp,
  ChevronDown,
  ChevronRight,
  FileDiff,
  Folder,
  ListTree,
  List,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { ContextMenuWrap, Dropdown, cn, type MenuItem } from '@/components/ui';
import { t } from '@/lib/i18n';
import type { FileChange } from '@/lib/types';

// ---- status marks -------------------------------------------------------------------------------

const STATUS: Record<string, { mark: string; cls: string; title: string }> = {
  M: { mark: '✎', cls: 'text-warning', title: 'Modified' },
  T: { mark: '✎', cls: 'text-warning', title: 'Type changed' },
  A: { mark: '+', cls: 'text-success', title: 'Added' },
  '?': { mark: '+', cls: 'text-success', title: 'Untracked' },
  D: { mark: '−', cls: 'text-danger', title: 'Deleted' },
  R: { mark: '→', cls: 'text-accent', title: 'Renamed' },
  C: { mark: '⧉', cls: 'text-accent', title: 'Copied' },
  U: { mark: '!', cls: 'text-danger', title: 'Conflict' },
};

export function StatusMark({ status }: { status: string }) {
  const s = STATUS[status] ?? { mark: status, cls: '', title: status };
  return (
    <span
      title={t(s.title)}
      className={cn('w-[19px] shrink-0 text-center text-[15.4px] leading-none font-bold', s.cls)}
    >
      {s.mark}
    </span>
  );
}

// ---- view mode ----------------------------------------------------------------------------------

export type ViewMode = 'path' | 'tree';

export function useViewMode(): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem('gitstudio.fileView') === 'tree' ? 'tree' : 'path';
    } catch {
      return 'path';
    }
  });
  return [
    mode,
    (m) => {
      setMode(m);
      try {
        localStorage.setItem('gitstudio.fileView', m);
      } catch {
        /* ignore */
      }
    },
  ];
}

export function ViewToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-border">
      {(['path', 'tree'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cn(
            'flex h-6 items-center gap-1 px-2 text-xs',
            mode === m
              ? 'bg-accent-soft text-foreground'
              : 'text-muted-foreground hover:bg-surface-hover',
          )}
        >
          {m === 'path' ? <List className="size-3.5" /> : <ListTree className="size-3.5" />}
          {m === 'path' ? t('Path') : t('Tree')}
        </button>
      ))}
    </div>
  );
}

// ---- sorting ------------------------------------------------------------------------------------

export type FileSort = 'path' | 'path-desc' | 'name' | 'status';

const SORT_LABEL: Record<FileSort, string> = {
  path: 'Path (A → Z)',
  'path-desc': 'Path (Z → A)',
  name: 'File name',
  status: 'Change type',
};

const STATUS_ORDER = 'U?AMTRCD';
const fileName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export function sortFiles(files: FileChange[], sort: FileSort): FileChange[] {
  const out = [...files];
  const byPath = (a: FileChange, b: FileChange) => a.path.localeCompare(b.path);
  if (sort === 'path') out.sort(byPath);
  else if (sort === 'path-desc') out.sort((a, b) => byPath(b, a));
  else if (sort === 'name')
    out.sort((a, b) => fileName(a.path).localeCompare(fileName(b.path)) || byPath(a, b));
  else
    out.sort(
      (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || byPath(a, b),
    );
  return out;
}

export function useFileSort(): [FileSort, (s: FileSort) => void] {
  const [sort, setSort] = useState<FileSort>(() => {
    try {
      const v = localStorage.getItem('gitstudio.fileSort') as FileSort | null;
      return v && v in SORT_LABEL ? v : 'path';
    } catch {
      return 'path';
    }
  });
  return [
    sort,
    (v) => {
      setSort(v);
      try {
        localStorage.setItem('gitstudio.fileSort', v);
      } catch {
        /* ignore */
      }
    },
  ];
}

export function SortButton({
  sort,
  onChange,
}: {
  sort: FileSort;
  onChange: (s: FileSort) => void;
}) {
  return (
    <Dropdown
      items={(Object.keys(SORT_LABEL) as FileSort[]).map((k) => ({
        label: t(SORT_LABEL[k]),
        icon: sort === k ? '✓' : undefined,
        onSelect: () => onChange(k),
      }))}
    >
      <button
        type="button"
        title={t('Sort files: {order}', { order: t(SORT_LABEL[sort]) })}
        aria-label={t('Sort files')}
        className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground"
      >
        <ArrowDownUp className="size-4" />
      </button>
    </Dropdown>
  );
}

// ---- rows ---------------------------------------------------------------------------------------

/** MIME type of a drag of working-tree files between the Unstaged and Staged lists. */
export const FILES_DRAG = 'application/x-gitstudio-files';

export interface FileListProps {
  files: FileChange[];
  mode: ViewMode;
  isActive: (f: FileChange) => boolean;
  onOpen: (f: FileChange) => void;
  actions?: (f: FileChange) => ReactNode;
  menu?: (f: FileChange) => MenuItem[];
  /** Multi-selection (Ctrl/Shift+click). */
  selected?: Set<string>;
  onSelect?: (f: FileChange, e: React.MouseEvent) => void;
  /** Makes rows draggable; the payload names the source list. */
  dragSource?: 'unstaged' | 'staged';
}

function Row({
  file,
  label,
  depth,
  active,
  onOpen,
  actions,
  menu,
  selected,
  onSelect,
  dragSource,
  dragPaths,
}: {
  file: FileChange;
  label: ReactNode;
  depth: number;
  active: boolean;
  onOpen: () => void;
  actions?: ReactNode;
  menu?: () => MenuItem[];
  selected?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
  dragSource?: 'unstaged' | 'staged';
  dragPaths?: () => string[];
}) {
  const row = (
    <div
      onClick={(e) => {
        if (onSelect && (e.ctrlKey || e.metaKey || e.shiftKey)) {
          e.preventDefault();
          onSelect(e);
        } else {
          onSelect?.(e);
          onOpen();
        }
      }}
      draggable={!!dragSource}
      onDragStart={(e) => {
        if (!dragSource) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(
          FILES_DRAG,
          JSON.stringify({ from: dragSource, paths: dragPaths?.() ?? [file.path] }),
        );
      }}
      title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
      style={{ paddingLeft: 10 + depth * 14 }}
      className={cn(
        'group flex h-[32px] cursor-default items-center gap-2 pr-2 text-[15.7px] leading-[32px] select-none',
        active ? 'bg-selection' : selected ? 'bg-accent-soft' : 'hover:bg-surface-hover',
      )}
    >
      <StatusMark status={file.status} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {actions && (
        <span className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">{actions}</span>
      )}
    </div>
  );
  return menu ? <ContextMenuWrap items={menu}>{row}</ContextMenuWrap> : row;
}

function selectionProps(props: FileListProps, f: FileChange) {
  const sel = props.selected;
  return {
    selected: sel?.has(f.path),
    onSelect: props.onSelect ? (e: React.MouseEvent) => props.onSelect!(f, e) : undefined,
    dragSource: props.dragSource,
    // Dragging a selected row drags the whole selection.
    dragPaths: () => (sel?.has(f.path) && sel.size > 1 ? [...sel] : [f.path]),
  };
}

/** Path mode: `src/dir/` dimmed, then the file name. */
function PathLabel({ path }: { path: string }) {
  const slash = path.lastIndexOf('/');
  return (
    <>
      {slash >= 0 && <span className="text-muted-foreground">{path.slice(0, slash + 1)}</span>}
      <span>{path.slice(slash + 1)}</span>
    </>
  );
}

interface Dir {
  name: string;
  dirs: Map<string, Dir>;
  files: FileChange[];
}

function buildTree(files: FileChange[]): Dir {
  const root: Dir = { name: '', dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let d = root;
    for (const part of parts.slice(0, -1)) {
      let next = d.dirs.get(part);
      if (!next) {
        next = { name: part, dirs: new Map(), files: [] };
        d.dirs.set(part, next);
      }
      d = next;
    }
    d.files.push(f);
  }
  // Collapse single-child chains: src/features/x → one row.
  const compact = (d: Dir): Dir => {
    for (const [k, c] of d.dirs) d.dirs.set(k, compact(c));
    if (d.name && d.files.length === 0 && d.dirs.size === 1) {
      const only = [...d.dirs.values()][0]!;
      return { ...only, name: `${d.name}/${only.name}` };
    }
    return d;
  };
  return compact(root);
}

function DirRows({ dir, depth, props }: { dir: Dir; depth: number; props: FileListProps }) {
  const [open, setOpen] = useState(true);
  const inner = (
    <>
      {[...dir.dirs.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((d) => (
          <DirRows key={d.name} dir={d} depth={dir.name ? depth + 1 : depth} props={props} />
        ))}
      {dir.files.map((f) => (
        <Row
          key={f.path}
          file={f}
          depth={dir.name ? depth + 1 : depth}
          label={f.path.slice(f.path.lastIndexOf('/') + 1)}
          active={props.isActive(f)}
          onOpen={() => props.onOpen(f)}
          actions={props.actions?.(f)}
          menu={props.menu ? () => props.menu!(f) : undefined}
          {...selectionProps(props, f)}
        />
      ))}
    </>
  );
  if (!dir.name) return inner;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{ paddingLeft: 6 + depth * 14 }}
        className="flex h-[32px] w-full items-center gap-1.5 pr-2 text-left text-[15.7px] text-muted-foreground hover:bg-surface-hover"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <Folder className="size-3.5" />
        <span className="truncate">{dir.name}</span>
      </button>
      {open && inner}
    </>
  );
}

export function FileList(props: FileListProps) {
  const tree = useMemo(() => buildTree(props.files), [props.files]);
  if (props.mode === 'tree') return <DirRows dir={tree} depth={0} props={props} />;
  return (
    <>
      {props.files.map((f) => (
        <Row
          key={f.path}
          file={f}
          depth={0}
          label={<PathLabel path={f.path} />}
          active={props.isActive(f)}
          onOpen={() => props.onOpen(f)}
          actions={props.actions?.(f)}
          menu={props.menu ? () => props.menu!(f) : undefined}
          {...selectionProps(props, f)}
        />
      ))}
    </>
  );
}

/** Collapsible "Unstaged Files (13)" header. */
export function FilesSection({
  title,
  count,
  right,
  tone,
  children,
}: {
  title: string;
  count: number;
  right?: ReactNode;
  tone?: 'danger';
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <div className="flex h-9 items-center gap-2 pr-2 pl-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={cn(
            'flex flex-1 items-center gap-1 text-[13px] font-medium',
            tone === 'danger' && 'text-danger',
          )}
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          {title} ({count})
        </button>
        {right}
      </div>
      {open && children}
    </div>
  );
}

export const EmptyFiles = ({ text }: { text: string }) => (
  <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
    <FileDiff className="size-3.5" /> {text}
  </div>
);

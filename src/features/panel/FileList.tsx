import type { ReactNode } from 'react';

import { ContextMenuWrap, cn, type MenuItem } from '@/components/ui';
import type { FileChange } from '@/lib/types';

const STATUS: Record<string, { label: string; cls: string }> = {
  M: { label: 'M', cls: 'text-warning' },
  A: { label: 'A', cls: 'text-success' },
  '?': { label: 'A', cls: 'text-success' },
  D: { label: 'D', cls: 'text-danger' },
  R: { label: 'R', cls: 'text-accent' },
  C: { label: 'C', cls: 'text-accent' },
  T: { label: 'T', cls: 'text-warning' },
  U: { label: '!', cls: 'text-danger' },
};

export function StatusLetter({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: '' };
  return (
    <span className={cn('w-4 shrink-0 text-center font-mono text-xs font-bold', s.cls)}>
      {s.label}
    </span>
  );
}

export function FileRow({
  file,
  active,
  onClick,
  actions,
  menu,
}: {
  file: FileChange;
  active: boolean;
  onClick: () => void;
  actions?: ReactNode;
  menu?: () => MenuItem[];
}) {
  const slash = file.path.lastIndexOf('/');
  const name = file.path.slice(slash + 1);
  const dir = slash >= 0 ? file.path.slice(0, slash) : '';
  const row = (
    <div
      onClick={onClick}
      title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
      className={cn(
        'group flex h-7 cursor-default items-center gap-1.5 px-2',
        active ? 'bg-selection' : 'hover:bg-surface-hover',
      )}
    >
      <StatusLetter status={file.status} />
      <span className="min-w-0 flex-1 truncate">
        {name}
        {dir && <span className="ml-1.5 text-xs text-muted-foreground">{dir}</span>}
      </span>
      {actions && (
        <span className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">{actions}</span>
      )}
    </div>
  );
  return menu ? <ContextMenuWrap items={menu}>{row}</ContextMenuWrap> : row;
}

import { Check, Cloud, Laptop, Tag, TreeDeciduous } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { ContextMenuWrap } from '@/components/ui';
import { cn } from '@/lib/cn';
import { short } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useRepo } from '@/stores/repo';
import * as A from '../actions';
import { headMenu, refMenu } from './refMenu';
import { worktreeOf, type BadgeGroup } from './refGroups';

export function RefBadge({
  group,
  color,
  onMenuOpenChange,
  onHoverChange,
}: {
  group: BadgeGroup;
  color: string;
  onMenuOpenChange?: (open: boolean) => void;
  /** Pointer entered / left the badge (the graph highlights the branch's commits meanwhile). */
  onHoverChange?: (hovered: boolean) => void;
}) {
  // The detached HEAD badge has no ref behind it.
  const primary = group.refs[0];
  const isHeadBadge = group.kind === 'head';
  const headHash = useRepo((s) => s.info?.status.head);
  const hasLocal = group.refs.some((r) => r.kind === 'local');
  const hasRemote = group.refs.some((r) => r.kind === 'remote');
  const worktrees = useRepo((s) => s.worktrees);
  const worktree = group.refs.map((r) => worktreeOf(r, worktrees)).find(Boolean);
  const names = group.refs.map((r) => r.name).join(', ');
  const [hovered, setHovered] = useState(false);
  // While hovered: whom to tell when the hover ends, also by unmount (row scrolled away, refs
  // reloaded), so the highlight never outlives the badge.
  const leave = useRef<((hovered: boolean) => void) | null>(null);
  const hover = (on: boolean) => {
    setHovered(on);
    onHoverChange?.(on);
    leave.current = on ? (onHoverChange ?? null) : null;
  };
  useEffect(() => () => leave.current?.(false), []);

  const body = (full: boolean) => (
    <span
      className={cn(
        'inline-flex h-[22px] min-w-0 items-center gap-1 rounded border px-1.5 text-xs font-medium text-foreground',
        group.head && 'font-semibold',
        // The hovered copy grows to the whole name over the graph, like GitKraken's.
        full ? 'absolute top-0 left-0 z-20 w-max max-w-[640px] shadow-md' : 'max-w-full',
      )}
      style={{
        borderColor: color,
        // Opaque so the connector line to the graph runs behind the badge.
        background: `color-mix(in oklch, ${color} var(${group.head ? '--lane-badge-head' : '--lane-badge'}), var(--background))`,
      }}
    >
      {group.head && <Check className="size-[15.4px] shrink-0" strokeWidth={2.4} />}
      {/* The checked-out branch also says HEAD, like `git log --decorate`'s "HEAD -> main". */}
      {group.head && group.kind === 'branch' && (
        <span className="shrink-0 rounded-sm bg-foreground/15 px-1 text-[9px] leading-[14px] font-bold tracking-wide">
          HEAD
        </span>
      )}
      {group.kind === 'tag' && <Tag className="size-[15.4px] shrink-0" strokeWidth={2.4} />}
      <span className="truncate">{group.label}</span>
      {hasLocal && <Laptop className="size-[15.4px] shrink-0" strokeWidth={2.4} />}
      {hasRemote && <Cloud className="size-[15.4px] shrink-0" strokeWidth={2.4} />}
      {worktree && <TreeDeciduous className="size-[15.4px] shrink-0" strokeWidth={2.4} />}
    </span>
  );

  return (
    <ContextMenuWrap
      items={() => (isHeadBadge ? headMenu() : refMenu(primary!))}
      onOpenChange={onMenuOpenChange}
    >
      <span
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (primary) void A.checkoutRef(primary);
        }}
        onMouseEnter={() => hover(true)}
        onMouseLeave={() => hover(false)}
        title={
          isHeadBadge
            ? t('HEAD (detached) at {hash}', { hash: short(headHash ?? '') })
            : worktree
              ? `${names}\n${t('Checked out in worktree {name}', { name: A.baseName(worktree.path) })}`
              : group.head
                ? `${names}\n${t('Checked out (HEAD)')}`
                : names
        }
        className="relative inline-flex max-w-[176px] min-w-0"
      >
        {/* The in-column badge keeps its place (nothing shifts); the full one overlays it. */}
        {body(false)}
        {hovered && body(true)}
      </span>
    </ContextMenuWrap>
  );
}

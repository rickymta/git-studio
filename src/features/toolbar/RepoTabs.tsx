import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderGit2,
  Pin,
  Plus,
  X,
} from 'lucide-react';
import { Popover } from 'radix-ui';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { ContextMenuWrap, type MenuItem } from '@/components/ui';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { copyText, revealPath } from '@/lib/native';
import { canReopenTab, useRepo, type RepoTab } from '@/stores/repo';
import { toast } from '@/stores/ui';
import { samePath } from '@/stores/workspace';
import { TabPicker } from './TabSwitcher';
import { describeStatus, isClean, useTabStatus, useTabStatusRefresh } from './tabStatus';

const same = (a: string | null, b: string) => !!a && samePath(a, b);

/** The small marks after a tab name: conflict / operation, uncommitted changes, behind. */
export function TabBadges({ path, active }: { path: string; active: boolean }) {
  const s = useTabStatus(path, active);
  if (!s) return null;
  if (s.error) return null;
  const busy = s.conflicts > 0 || (!!s.state && s.state !== 'clean');
  return (
    <span className="flex shrink-0 items-center gap-1 text-[10px] leading-none tabular-nums">
      {busy && <AlertTriangle aria-hidden className="size-3 text-danger" />}
      {s.behind > 0 && <span className="text-warning">↓{s.behind > 99 ? '99+' : s.behind}</span>}
      {s.changes > 0 && !busy && (
        <span aria-hidden className="block size-1.5 rounded-full bg-warning" />
      )}
    </span>
  );
}

/** Menu of one tab (right-click). */
function tabMenu(tab: RepoTab): MenuItem[] {
  const r = useRepo.getState();
  const tabs = r.tabs;
  const idx = tabs.findIndex((x) => samePath(x.path, tab.path));
  const others = tabs.filter((x) => !x.pinned && !samePath(x.path, tab.path));
  const right = tabs.slice(idx + 1).filter((x) => !x.pinned);
  const clean = tabs.filter(
    (x) => !x.pinned && !same(r.path, x.path) && !samePath(x.path, tab.path) && isClean(x.path),
  );
  const unpinned = tabs.filter((x) => !x.pinned);
  return [
    tab.pinned
      ? {
          label: t('Unpin tab'),
          icon: <Pin className="size-3.5" />,
          onSelect: () => r.pinTab(tab.path, false),
        }
      : {
          label: t('Pin tab'),
          icon: <Pin className="size-3.5" />,
          onSelect: () => r.pinTab(tab.path, true),
        },
    'sep',
    { label: t('Close'), icon: <X className="size-3.5" />, onSelect: () => r.closeTab(tab.path) },
    {
      label: t('Close other tabs ({n})', { n: others.length }),
      disabled: !others.length,
      onSelect: () => r.closeTabs(others.map((x) => x.path)),
    },
    {
      label: t('Close tabs to the right ({n})', { n: right.length }),
      disabled: !right.length,
      onSelect: () => r.closeTabs(right.map((x) => x.path)),
    },
    {
      label: t('Close clean tabs ({n})', { n: clean.length }),
      disabled: !clean.length,
      onSelect: () => r.closeTabs(clean.map((x) => x.path)),
    },
    {
      label: t('Close all tabs ({n})', { n: unpinned.length }),
      disabled: !unpinned.length,
      danger: true,
      onSelect: () => r.closeTabs(unpinned.map((x) => x.path)),
    },
    'sep',
    {
      label: t('Reopen closed tab'),
      disabled: !canReopenTab(),
      onSelect: () => r.reopenClosedTab(),
    },
    'sep',
    { label: t('Copy path'), onSelect: () => void copyText(tab.path) },
    { label: t('Show in folder'), onSelect: () => void revealPath(tab.path) },
    {
      label: t('Open in terminal'),
      onSelect: () =>
        void api
          .openTerminal(tab.path)
          .catch((e) => toast('error', t('Could not open terminal'), (e as Error).message)),
    },
  ];
}

interface TabProps {
  tab: RepoTab;
  index: number;
  active: boolean;
  outside: string | null;
  onNavigate: () => void;
  onDragStart: (i: number) => void;
  onDrop: (i: number) => void;
}

const Tab = memo(function Tab({
  tab,
  index,
  active,
  outside,
  onNavigate,
  onDragStart,
  onDrop,
}: TabProps) {
  const status = useTabStatus(tab.path, active);
  const tip = [tab.name, tab.path, ...describeStatus(status), outside ?? '']
    .filter(Boolean)
    .join('\n');
  return (
    <ContextMenuWrap items={() => tabMenu(tab)}>
      <div
        role="tab"
        aria-selected={active}
        data-tab-path={tab.path}
        title={tip}
        draggable
        onDragStart={() => onDragStart(index)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => onDrop(index)}
        onClick={() => {
          onNavigate();
          void useRepo.getState().open(tab.path);
        }}
        onAuxClick={(e) => e.button === 1 && useRepo.getState().closeTab(tab.path)}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        className={cn(
          'group relative flex cursor-default items-center gap-1.5 border-r border-border',
          tab.pinned
            ? 'max-w-36 shrink-0 px-2.5'
            : 'max-w-[24rem] min-w-[7.5rem] flex-[1_1_12rem] pr-1.5 pl-2.5',
          active
            ? 'bg-surface text-foreground'
            : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
        )}
      >
        {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
        {tab.pinned ? (
          <Pin className={cn('size-3 shrink-0 -rotate-45', active && 'text-accent')} />
        ) : (
          <FolderGit2 className={cn('size-3.5 shrink-0', active && 'text-accent')} />
        )}
        <span
          className={cn('min-w-0 flex-1 truncate', active && 'font-semibold', outside && 'italic')}
        >
          {tab.name}
        </span>
        <TabBadges path={tab.path} active={active} />
        {!tab.pinned && (
          <button
            type="button"
            aria-label={t('Close {name}', { name: tab.name })}
            onClick={(e) => {
              e.stopPropagation();
              useRepo.getState().closeTab(tab.path);
            }}
            className={cn(
              'size-4 shrink-0 items-center justify-center rounded',
              // Inactive tabs only show it on hover, over the badges, so it takes no room.
              active
                ? 'flex hover:bg-surface-hover'
                : 'absolute right-1.5 hidden bg-surface-hover group-hover:flex hover:bg-border focus-visible:flex',
            )}
          >
            <X className="size-3" />
          </button>
        )}
      </div>
    </ContextMenuWrap>
  );
});

const stripBtn =
  'flex w-6 shrink-0 items-center justify-center text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent';

/**
 * The repository tabs. Tabs shrink to a minimum width first; past that the strip scrolls
 * sideways (mouse wheel, ◀ ▶ buttons, the shown tab is always brought into view) without a
 * scrollbar, and ▾ lists every open tab with a search box.
 */
export function RepoTabs({
  showNewTabPlaceholder,
  inWorkspace,
  workspaceName,
  onNavigate,
}: {
  onNavigate: () => void;
  showNewTabPlaceholder: boolean;
  inWorkspace: (path: string) => boolean;
  workspaceName: string | null;
}) {
  const tabs = useRepo((s) => s.tabs);
  const path = useRepo((s) => s.path);
  const strip = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [listOpen, setListOpen] = useState(false);
  const drag = useRef<number | null>(null);

  useTabStatusRefresh(tabs);
  // Stable for the memoised tabs: the parent passes a new function on every render.
  const navRef = useRef(onNavigate);
  useLayoutEffect(() => {
    navRef.current = onNavigate;
  });
  const navigate = useCallback(() => navRef.current(), []);

  const measure = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);

  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Vertical wheel scrolls the strip sideways (a native listener: React's is passive).
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      e.preventDefault();
      el.scrollLeft += e.deltaMode === 1 ? d * 40 : d;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
    };
  }, [measure]);

  // Re-measure when tabs come and go (the strip's own size may not change).
  useLayoutEffect(measure, [tabs.length, measure]);

  // Keep the shown tab in view.
  useEffect(() => {
    const el = strip.current;
    if (!el || !path) return;
    const tab = [...el.querySelectorAll<HTMLElement>('[data-tab-path]')].find((n) =>
      samePath(n.dataset.tabPath!, path),
    );
    tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [path, tabs.length]);

  const scrollBy = (dir: -1 | 1) => {
    const el = strip.current;
    if (el) el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: 'smooth' });
  };

  const onDragStart = useCallback((i: number) => {
    drag.current = i;
  }, []);
  const onDrop = useCallback((i: number) => {
    const from = drag.current;
    drag.current = null;
    if (from !== null && from !== i) useRepo.getState().moveTab(from, i);
  }, []);

  const overflow = edges.left || edges.right;

  const renderTab = (tab: RepoTab, i: number) => (
    <Tab
      key={tab.path}
      tab={tab}
      index={i}
      active={same(path, tab.path)}
      outside={
        inWorkspace(tab.path) ? null : t('Not in workspace {name}', { name: workspaceName ?? '' })
      }
      onNavigate={navigate}
      onDragStart={onDragStart}
      onDrop={onDrop}
    />
  );

  return (
    <div className="flex min-w-0 flex-1 items-stretch">
      {/* Pinned tabs stay in view: they are not part of the scrolling strip. */}
      {tabs.map((tab, i) => tab.pinned && renderTab(tab, i))}
      {overflow && (
        <button
          type="button"
          aria-label={t('Scroll tabs left')}
          disabled={!edges.left}
          onClick={() => scrollBy(-1)}
          className={cn(stripBtn, 'border-r border-border')}
        >
          <ChevronLeft className="size-4" />
        </button>
      )}
      <div
        ref={strip}
        role="tablist"
        onScroll={measure}
        className="no-scrollbar flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden"
      >
        {tabs.map((tab, i) => !tab.pinned && renderTab(tab, i))}
        {showNewTabPlaceholder && (
          <div className="relative flex shrink-0 items-center gap-2 border-r border-border bg-surface px-3 font-semibold">
            <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />
            {t('New tab')}
          </div>
        )}
      </div>
      {overflow && (
        <button
          type="button"
          aria-label={t('Scroll tabs right')}
          disabled={!edges.right}
          onClick={() => scrollBy(1)}
          className={cn(stripBtn, 'border-x border-border')}
        >
          <ChevronRight className="size-4" />
        </button>
      )}
      <button
        type="button"
        title={`${t('Open a repository in a new tab')} (Ctrl+T)`}
        aria-label={t('New tab')}
        onClick={() => {
          navigate();
          useRepo.getState().newTab();
        }}
        className="flex w-9 shrink-0 items-center justify-center text-muted-foreground hover:bg-surface-hover hover:text-foreground"
      >
        <Plus className="size-4" />
      </button>
      {tabs.length > 0 && (
        <Popover.Root open={listOpen} onOpenChange={setListOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              title={`${t('All open tabs')} (Ctrl+P)`}
              aria-label={t('All open tabs')}
              className={cn(
                'flex shrink-0 items-center gap-0.5 px-1.5 text-xs text-muted-foreground tabular-nums hover:bg-surface-hover hover:text-foreground',
                listOpen && 'bg-surface-hover text-foreground',
              )}
            >
              {tabs.length}
              <ChevronDown className="size-3.5" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={4}
              collisionPadding={8}
              onCloseAutoFocus={(e) => e.preventDefault()}
              className="z-50 w-[min(440px,calc(100vw-16px))] rounded-md border border-border bg-surface shadow-xl"
            >
              <TabPicker mode="tabs" onDone={() => setListOpen(false)} onPick={navigate} />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  );
}

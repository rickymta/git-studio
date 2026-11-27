import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderGit2,
  Palette,
  Pin,
  Plus,
  Tag,
  X,
} from 'lucide-react';
import { Popover } from 'radix-ui';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { flushSync } from 'react-dom';

import { ContextMenuWrap, type MenuItem } from '@/components/ui';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { copyText, revealPath } from '@/lib/native';
import { canReopenTab, useRepo, type RepoTab } from '@/stores/repo';
import {
  colorValue,
  TAB_COLORS,
  TAG_MAX,
  tabMarkOf,
  useTabMark,
  useTabMarks,
} from '@/stores/tabMarks';
import { ask, toast } from '@/stores/ui';
import { samePath } from '@/stores/workspace';
import { TabPicker } from './TabSwitcher';
import { TabTag } from './TabTag';
import { dropIndex, edgeSpeed, shiftFor } from './tabDrag';
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

/** Colour and tag items of a tab's menu. */
function markMenu(tab: RepoTab): MenuItem[] {
  const marks = useTabMarks.getState();
  const mark = tabMarkOf(tab.path);
  const dot = (c: string | undefined) => (
    <span
      className={cn('size-3 rounded-full', !c && 'border border-dashed border-muted-foreground')}
      style={c ? { background: c } : undefined}
    />
  );
  return [
    {
      label: t('Tab colour'),
      icon: <Palette className="size-3.5" />,
      items: [
        {
          label: mark.color ? t('No colour') : `${t('No colour')} ✓`,
          icon: dot(undefined),
          onSelect: () => marks.setColor(tab.path, null),
        },
        'sep',
        ...TAB_COLORS.map((c): MenuItem => ({
          label: mark.color === c.id ? `${t(c.label)} ✓` : t(c.label),
          icon: dot(c.value),
          onSelect: () => marks.setColor(tab.path, c.id),
        })),
      ],
    },
    {
      label: mark.tag ? t('Edit tag…') : t('Add tag…'),
      icon: <Tag className="size-3.5" />,
      onSelect: async () => {
        const v = await ask({
          title: mark.tag ? t('Edit tag') : t('Add tag'),
          fields: [
            {
              name: 'tag',
              label: t('Tag (up to {n} characters)', { n: TAG_MAX }),
              initial: mark.tag ?? '',
              placeholder: t('e.g. API, FE, v2'),
              maxLength: TAG_MAX,
            },
          ],
          confirmLabel: t('Save'),
        });
        if (v) marks.setTag(tab.path, v.tag as string);
      },
    },
    ...(mark.tag
      ? [{ label: t('Remove tag'), onSelect: () => marks.setTag(tab.path, null) } as MenuItem]
      : []),
  ];
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
    ...markMenu(tab),
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
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
}

const Tab = memo(function Tab({
  tab,
  index,
  active,
  outside,
  onNavigate,
  onPointerDown,
}: TabProps) {
  const status = useTabStatus(tab.path, active);
  const mark = useTabMark(tab.path);
  const color = colorValue(mark.color);
  const tip = [
    mark.tag ? `${tab.name} [${mark.tag}]` : tab.name,
    tab.path,
    ...describeStatus(status),
    outside ?? '',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <ContextMenuWrap items={() => tabMenu(tab)}>
      <div
        role="tab"
        aria-selected={active}
        data-tab-path={tab.path}
        data-tab-index={index}
        data-pinned={tab.pinned ? 'true' : 'false'}
        title={tip}
        onPointerDown={onPointerDown}
        onClick={() => {
          onNavigate();
          void useRepo.getState().open(tab.path);
        }}
        onAuxClick={(e) => e.button === 1 && useRepo.getState().closeTab(tab.path)}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        className={cn(
          'group relative flex cursor-default items-center gap-1.5 border-r border-border select-none',
          // While dragged it floats over the others.
          'data-[dragging]:z-10 data-[dragging]:bg-surface data-[dragging]:shadow-lg',
          tab.pinned
            ? 'max-w-36 shrink-0 px-2.5'
            : // At most 10.2rem whatever the window or tab count.
              'w-[10.2rem] max-w-[10.2rem] min-w-[7.5rem] shrink pr-1.5 pl-2.5',
          active
            ? 'bg-surface text-foreground'
            : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
        )}
      >
        {color && (
          <>
            {/* The tab's colour: a light tint and a bar along the bottom. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ background: color, opacity: active ? 0.14 : 0.08 }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5"
              style={{ background: color }}
            />
          </>
        )}
        {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
        {tab.pinned ? (
          <Pin
            className={cn('size-3 shrink-0 -rotate-45', active && !color && 'text-accent')}
            style={color ? { color } : undefined}
          />
        ) : (
          <FolderGit2
            className={cn('size-3.5 shrink-0', active && !color && 'text-accent')}
            style={color ? { color } : undefined}
          />
        )}
        <TabTag path={tab.path} />
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

/**
 * The "New tab" tab, shown with the start page. It can be closed (×, middle click, Ctrl+W)
 * when there is a repository tab or a workspace overview to go back to.
 */
function NewTab({ covered, onNavigate }: { covered: boolean; onNavigate: () => void }) {
  const closable = useRepo((s) => s.newTabOpen && s.tabs.length > 0);
  const active = !covered;
  const close = () => {
    onNavigate();
    useRepo.getState().closeNewTab();
  };
  return (
    <div
      role="tab"
      aria-selected={active}
      data-new-tab=""
      title={t('New tab')}
      onClick={onNavigate}
      onAuxClick={(e) => e.button === 1 && closable && close()}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      className={cn(
        'relative flex w-[10.2rem] max-w-[10.2rem] min-w-[7.5rem] shrink-0 cursor-default items-center gap-1.5 border-r border-border pr-1.5 pl-2.5 select-none',
        active
          ? 'bg-surface font-semibold text-foreground'
          : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
      )}
    >
      {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
      <Plus className={cn('size-3.5 shrink-0', active && 'text-accent')} />
      <span className="min-w-0 flex-1 truncate">{t('New tab')}</span>
      {closable && (
        <button
          type="button"
          aria-label={t('Close {name}', { name: t('New tab') })}
          title={`${t('Close')} (Ctrl+W)`}
          onClick={(e) => {
            e.stopPropagation();
            close();
          }}
          className="flex size-4 shrink-0 items-center justify-center rounded font-normal hover:bg-surface-hover"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

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
  covered = false,
}: {
  onNavigate: () => void;
  showNewTabPlaceholder: boolean;
  inWorkspace: (path: string) => boolean;
  workspaceName: string | null;
  /** Launchpad or Preferences are shown over the repository: no tab is the current one. */
  covered?: boolean;
}) {
  const tabs = useRepo((s) => s.tabs);
  const path = useRepo((s) => s.path);
  const strip = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [listOpen, setListOpen] = useState(false);
  const outer = useRef<HTMLDivElement>(null);
  /** Set when a drag ends, so the click that follows does not open the tab. */
  const justDragged = useRef(false);

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

  // Keep the shown tab (or the "New tab") in view.
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const tab = path
      ? [...el.querySelectorAll<HTMLElement>('[data-tab-path]')].find((n) =>
          samePath(n.dataset.tabPath!, path),
        )
      : el.querySelector<HTMLElement>('[data-new-tab]');
    tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [path, tabs.length, showNewTabPlaceholder]);

  const scrollBy = (dir: -1 | 1) => {
    const el = strip.current;
    if (el) el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: 'smooth' });
  };

  // Drag to reorder, with pointer events (HTML5 drag and drop does not reach the page in the
  // desktop app's webview). A tab moves within its group: the pinned tabs, or the strip. The
  // others slide aside to show where it will land; near the strip's edges the strip scrolls.
  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const el = e.currentTarget;
    const root = outer.current;
    const sc = strip.current;
    if (!root || !sc) return;
    const pinned = el.dataset.pinned === 'true';
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startScroll = sc.scrollLeft;
    let x = startX;
    let started = false;
    let raf = 0;
    let items: HTMLElement[] = [];
    let centers: number[] = [];
    let indexes: number[] = [];
    let from = 0;
    let to = 0;
    let width = 0;
    let minDx = 0;
    let maxDx = 0;

    const scrolled = () => (pinned ? 0 : sc.scrollLeft - startScroll);
    const begin = () => {
      started = true;
      items = [...root.querySelectorAll<HTMLElement>('[data-tab-index]')].filter(
        (n) => (n.dataset.pinned === 'true') === pinned,
      );
      indexes = items.map((n) => Number(n.dataset.tabIndex));
      const rects = items.map((n) => n.getBoundingClientRect());
      centers = rects.map((r) => r.left + r.width / 2);
      from = Math.max(0, items.indexOf(el));
      to = from;
      const own = rects[from]!;
      width = own.width;
      // It stays within its group.
      minDx = rects[0]!.left - own.left;
      maxDx = rects[rects.length - 1]!.right - own.right;
      for (const n of items) if (n !== el) n.style.transition = 'transform 150ms ease';
      el.dataset.dragging = '';
      document.body.style.cursor = 'grabbing';
      try {
        el.setPointerCapture(pointerId);
      } catch {
        // The pointer may be gone already; the window listeners still end the drag.
      }
    };
    const update = () => {
      const dx = Math.min(maxDx, Math.max(minDx, x - startX + scrolled()));
      el.style.transform = `translateX(${dx}px)`;
      to = dropIndex(centers, from, centers[from]! + dx);
      items.forEach((n, j) => {
        if (n !== el) n.style.transform = `translateX(${shiftFor(j, from, to, width)}px)`;
      });
    };
    const tick = () => {
      raf = 0;
      if (!started || pinned) return;
      const r = sc.getBoundingClientRect();
      const v = edgeSpeed(x, r.left, r.right);
      if (!v) return;
      const before = sc.scrollLeft;
      sc.scrollLeft += v;
      if (sc.scrollLeft !== before) update();
      raf = requestAnimationFrame(tick);
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onCancel);
      cancelAnimationFrame(raf);
      if (!started) return;
      for (const n of items) {
        n.style.transition = '';
        n.style.transform = '';
      }
      delete el.dataset.dragging;
      document.body.style.cursor = '';
      justDragged.current = true;
      const a = indexes[from];
      const b = indexes[to];
      if (commit && a !== undefined && b !== undefined && a !== b) {
        // In the same frame as the styles are cleared, so the tabs do not jump back first.
        flushSync(() => useRepo.getState().moveTab(a, b, pinned));
      }
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      x = ev.clientX;
      if (!started) {
        if (Math.abs(x - startX) < 4) return;
        begin();
      }
      update();
      if (!pinned && !raf) raf = requestAnimationFrame(tick);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish(true);
    };
    const onCancel = () => finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !started) return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onCancel);
  }, []);

  const overflow = edges.left || edges.right;

  const renderTab = (tab: RepoTab, i: number) => (
    <Tab
      key={tab.path}
      tab={tab}
      index={i}
      active={!covered && same(path, tab.path)}
      outside={
        inWorkspace(tab.path) ? null : t('Not in workspace {name}', { name: workspaceName ?? '' })
      }
      onNavigate={navigate}
      onPointerDown={onPointerDown}
    />
  );

  return (
    <div
      ref={outer}
      className="flex min-w-0 flex-1 items-stretch"
      onPointerDownCapture={() => {
        justDragged.current = false;
      }}
      onClickCapture={(e) => {
        // The click that ends a drag does not open the tab.
        if (!justDragged.current) return;
        justDragged.current = false;
        e.stopPropagation();
        e.preventDefault();
      }}
    >
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
        {showNewTabPlaceholder && <NewTab covered={covered} onNavigate={navigate} />}
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

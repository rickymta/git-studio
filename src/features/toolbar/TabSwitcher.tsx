import { FolderGit2, FolderOpen, History, Pin, Search, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { tabsByRecent, useRepo, type RepoTab } from '@/stores/repo';
import { useUi } from '@/stores/ui';
import { samePath, summaryKey, useWorkspaces } from '@/stores/workspace';
import { TabBadges } from './RepoTabs';

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

interface PickItem {
  path: string;
  name: string;
  /** Open as a tab (shows badges and a close button). */
  tab: RepoTab | null;
  group: 'tabs' | 'workspace' | 'recent';
}

/** Every word of the query appears in the name or the path. Name matches rank first. */
function filterItems(items: PickItem[], query: string): PickItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  const hit = items.filter((it) => {
    const name = it.name.toLowerCase();
    const path = it.path.toLowerCase();
    return words.every((w) => name.includes(w) || path.includes(w));
  });
  const score = (it: PickItem) => {
    const name = it.name.toLowerCase();
    if (name.startsWith(words[0]!)) return 0;
    if (words.every((w) => name.includes(w))) return 1;
    return 2;
  };
  // Stable: within a score the groups and their order stay as they were.
  return hit
    .map((it, i) => ({ it, i, s: score(it) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.it);
}

/**
 * Searchable repository list. `tabs`: the open tabs in tab-bar order (the ▾ menu). `quick`
 * (Ctrl+P): open tabs, most recent first, then the workspace's other repositories and recently
 * opened ones.
 */
export function TabPicker({
  mode,
  onDone,
  onPick,
}: {
  mode: 'tabs' | 'quick';
  /** Close the list. */
  onDone: () => void;
  /** A repository was picked (before it opens). */
  onPick?: () => void;
}) {
  const tabs = useRepo((s) => s.tabs);
  const current = useRepo((s) => s.path);
  const recent = useRepo((s) => s.settings?.recent);
  const wsRepos = useWorkspaces(
    (s) => s.data.items.find((w) => w.id === s.data.active)?.repos ?? null,
  );
  const summaries = useWorkspaces((s) => s.summaries);
  const [query, setQuery] = useState('');
  const list = useRef<HTMLDivElement>(null);

  const items = useMemo(() => {
    const ordered = mode === 'quick' ? tabsByRecent(tabs) : tabs;
    const out: PickItem[] = ordered.map((tab) => ({
      path: tab.path,
      name: tab.name,
      tab,
      group: 'tabs',
    }));
    if (mode === 'quick') {
      const seen = new Set(tabs.map((x) => summaryKey(x.path)));
      for (const p of wsRepos ?? []) {
        const k = summaryKey(p);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({
          path: p,
          name: summaries[k]?.name ?? baseName(p),
          tab: null,
          group: 'workspace',
        });
      }
      for (const r of recent ?? []) {
        const k = summaryKey(r.path);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ path: r.path, name: r.name, tab: null, group: 'recent' });
      }
    }
    return out;
  }, [mode, tabs, wsRepos, recent, summaries]);

  const shown = useMemo(() => filterItems(items, query), [items, query]);

  // Ctrl+P starts on the previous tab (Ctrl+P, Enter goes back); the ▾ list on the shown one.
  const startAt = (q: string, list: PickItem[]) => {
    if (q) return 0;
    const i = current ? list.findIndex((x) => samePath(x.path, current)) : -1;
    if (mode === 'quick') return i === 0 && list.length > 1 ? 1 : 0;
    return Math.max(0, i);
  };
  const [cursor, setCursor] = useState(() => startAt('', shown));
  const search = (q: string) => {
    setQuery(q);
    setCursor(startAt(q, filterItems(items, q)));
  };

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor, shown]);

  const pick = (it: PickItem | undefined) => {
    if (!it) return;
    onDone();
    onPick?.();
    void useRepo.getState().open(it.path);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(shown.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      setCursor((c) =>
        Math.max(0, Math.min(shown.length - 1, c + (e.key === 'PageDown' ? 10 : -10))),
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(shown[cursor]);
    }
  };

  const heading = (g: PickItem['group']) =>
    g === 'tabs'
      ? t('Open tabs')
      : g === 'workspace'
        ? t('In this workspace')
        : t('Recently opened');

  return (
    <div className="flex max-h-[min(70vh,560px)] flex-col" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder={
            mode === 'quick' ? t('Go to repository by name or path…') : t('Search open tabs…')
          }
          aria-label={t('Search')}
          className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        />
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {shown.length}/{items.length}
        </span>
      </div>
      <div ref={list} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1">
        {shown.length === 0 && (
          <div className="px-3 py-6 text-center text-muted-foreground">
            {t('No matching repository')}
          </div>
        )}
        {shown.map((it, i) => {
          const showHeading = mode === 'quick' && !query && shown[i - 1]?.group !== it.group;
          const isCurrent = !!current && samePath(current, it.path);
          return (
            <div key={it.path}>
              {showHeading && (
                <div className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {heading(it.group)}
                </div>
              )}
              <div
                role="option"
                aria-selected={i === cursor}
                data-index={i}
                title={it.path}
                onMouseMove={() => i !== cursor && setCursor(i)}
                onClick={() => pick(it)}
                className={cn(
                  'group flex h-8 cursor-default items-center gap-2 rounded px-2',
                  i === cursor && 'bg-accent text-accent-foreground',
                )}
              >
                {it.tab?.pinned ? (
                  <Pin className="size-3.5 shrink-0 -rotate-45" />
                ) : it.group === 'tabs' ? (
                  <FolderGit2 className="size-3.5 shrink-0" />
                ) : it.group === 'workspace' ? (
                  <FolderOpen className="size-3.5 shrink-0 opacity-70" />
                ) : (
                  <History className="size-3.5 shrink-0 opacity-70" />
                )}
                <span className={cn('shrink-0 truncate', isCurrent && 'font-semibold')}>
                  {it.name}
                </span>
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-xs',
                    i === cursor ? 'opacity-75' : 'text-muted-foreground',
                  )}
                >
                  {it.path}
                </span>
                {it.tab && <TabBadges path={it.path} active={isCurrent} />}
                {it.tab && !it.tab.pinned && (
                  <button
                    type="button"
                    aria-label={t('Close {name}', { name: it.name })}
                    onClick={(e) => {
                      e.stopPropagation();
                      useRepo.getState().closeTab(it.path);
                    }}
                    className="flex size-5 shrink-0 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-black/15"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Ctrl+P: jump to any open tab or repository of the workspace. */
function QuickOpen({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="fixed top-[12vh] left-1/2 z-50 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
        >
          <Dialog.Title className="sr-only">{t('Go to repository')}</Dialog.Title>
          <TabPicker mode="quick" onDone={onClose} onPick={onPick} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Ctrl+Tab overlay: tabs by most recent use; release Ctrl to switch. */
function RecentSwitcher({ list, index }: { list: RepoTab[]; index: number }) {
  const current = useRepo((s) => s.path);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center pt-[14vh]">
      <div
        ref={box}
        role="listbox"
        aria-label={t('Switch tab')}
        className="max-h-[60vh] w-[min(420px,calc(100vw-32px))] overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-2xl"
      >
        {list.map((tab, i) => (
          <div
            key={tab.path}
            data-index={i}
            role="option"
            aria-selected={i === index}
            className={cn(
              'flex h-8 items-center gap-2 rounded px-2',
              i === index && 'bg-accent text-accent-foreground',
            )}
          >
            {tab.pinned ? (
              <Pin className="size-3.5 shrink-0 -rotate-45" />
            ) : (
              <FolderGit2 className="size-3.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">{tab.name}</span>
            <TabBadges path={tab.path} active={!!current && samePath(current, tab.path)} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Tab keyboard shortcuts: Ctrl+Tab / Ctrl+Shift+Tab (most recent first, release Ctrl to switch),
 * Ctrl+PageDown / PageUp (next / previous in the bar), Ctrl+1…8 (that tab), Ctrl+9 (last tab),
 * Ctrl+P (go to repository), Ctrl+Shift+T (reopen closed tab).
 */
export function TabShortcuts({ onNavigate }: { onNavigate: () => void }) {
  const [quick, setQuick] = useState(false);
  const [mru, setMru] = useState<{ list: RepoTab[]; index: number } | null>(null);
  // The handlers read the ref (several key presses can come before a render).
  const mruRef = useRef(mru);

  useEffect(() => {
    const show = (v: typeof mru) => {
      mruRef.current = v;
      setMru(v);
    };
    const go = (path: string | undefined) => {
      if (!path) return;
      onNavigate();
      void useRepo.getState().open(path);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const cur = mruRef.current;
      if (cur && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        show(null);
        return;
      }
      if (!ctrl || e.altKey || useUi.getState().prompt) return;
      const r = useRepo.getState();
      if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        if (cur) {
          const n = cur.list.length;
          show({ ...cur, index: (cur.index + (e.shiftKey ? n - 1 : 1)) % n });
          return;
        }
        const list = tabsByRecent(r.tabs);
        if (list.length < 2) return;
        // With no tab shown (overview / new tab), the first entry is the target.
        const shownFirst = !!r.path && samePath(list[0]!.path, r.path);
        show({
          list,
          index: e.shiftKey ? list.length - 1 : shownFirst ? 1 : 0,
        });
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'p' && !e.shiftKey) {
        e.preventDefault();
        setQuick(true);
      } else if (key === 't' && e.shiftKey) {
        e.preventDefault();
        onNavigate();
        r.reopenClosedTab();
      } else if ((e.key === 'PageDown' || e.key === 'PageUp') && !e.shiftKey && r.tabs.length) {
        e.preventDefault();
        const i = r.path ? r.tabs.findIndex((x) => samePath(x.path, r.path!)) : -1;
        const n = r.tabs.length;
        const next = e.key === 'PageDown' ? (i + 1) % n : i < 0 ? n - 1 : (i - 1 + n) % n;
        go(r.tabs[next]?.path);
      } else if (!e.shiftKey && /^Digit[1-9]$/.test(e.code) && r.tabs.length) {
        e.preventDefault();
        const d = Number(e.code.slice(5));
        go((d === 9 ? r.tabs[r.tabs.length - 1] : r.tabs[d - 1])?.path);
      }
    };
    const commit = () => {
      const cur = mruRef.current;
      if (!cur) return;
      show(null);
      go(cur.list[cur.index]?.path);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (mruRef.current && (e.key === 'Control' || e.key === 'Meta')) commit();
    };
    const onBlur = () => show(null);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [onNavigate]);

  return (
    <>
      <QuickOpen open={quick} onClose={() => setQuick(false)} onPick={onNavigate} />
      {mru && <RecentSwitcher list={mru.list} index={mru.index} />}
    </>
  );
}

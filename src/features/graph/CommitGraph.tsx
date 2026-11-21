import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp, LocateFixed, Search, X } from 'lucide-react';
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Avatar, ContextMenuWrap, IconButton, Input, ResizeHandle, Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import { usePersistentWidth } from '@/components/usePersistentWidth';
import { useGravatar } from '@/components/useGravatar';
import { fullDate, hue, initials, relativeTime, short } from '@/lib/format';
import { hashIndex, laneColor, wipRowOf, type GraphRow, type Segment } from '@/lib/graph';
import { t } from '@/lib/i18n';
import type { Commit, GitRef } from '@/lib/types';
import { setGraphScrolling, useRepo } from '@/stores/repo';
import * as A from '../actions';
import { ColumnSettingsMenu } from './ColumnSettingsMenu';
import {
  COMPACT_WIDTHS,
  DEFAULT_WIDTHS,
  focusTips,
  relatedRows,
  useColumnSettings,
  type Column,
} from './columnSettings';
import { branchRows, rowIndex } from './branchFocus';
import { laneBranch } from './laneLabel';
import { SearchResults } from './HistorySearch';
import { SEARCH_MODES, useGitSearch, type SearchMode } from './gitSearch';
import { commitMenu, stashMenu } from './commitMenu';
import { pickCommits } from './menuUtils';
import { RefBadge } from './RefBadge';
import { groupRefs } from './refGroups';

import { Select } from '@/components/controls';

// Proportions measured from GitKraken: 28px rows, 22px lanes, ~20px avatar nodes.
const ROW = 28;
const MAX_GRAPH = 220;

/** Lane geometry: `node` is the commit circle's radius. */
interface Geom {
  lane: number;
  pad: number;
  node: number;
  compact: boolean;
}
// Nodes 20% larger than GitKraken's (user preference).
const NORMAL: Geom = { lane: 26, pad: 12, node: 12, compact: false };
/** "Compact Graph Column": narrow lanes and small dots instead of avatars. */
const COMPACT: Geom = { lane: 14, pad: 8, node: 6, compact: true };
/** Column widths live in CSS variables on the graph container, so resizing never re-renders rows. */
const REFS_W = 'var(--refs-w)';
const GRAPH_W = 'var(--graph-w)';
const bandLeft = (cx: number) => `calc(${REFS_W} + ${cx}px)`;

/** Shown while the graph is filtered (Solo / Hide) or has pinned branches. */
function ViewBar() {
  const view = useRepo((s) => s.view);
  const short = (full: string) => full.replace(/^refs\/(heads|remotes|tags)\//, '');
  const parts: string[] = [];
  if (view.solo.length) parts.push(t('Solo: {names}', { names: view.solo.map(short).join(', ') }));
  if (view.hidden.length)
    parts.push(t('Hidden: {names}', { names: view.hidden.map(short).join(', ') }));
  if (view.hiddenStashes.length)
    parts.push(t('{n} hidden stashes', { n: view.hiddenStashes.length }));
  if (view.pinned.length)
    parts.push(t('Pinned: {names}', { names: view.pinned.map(short).join(', ') }));
  if (!parts.length) return null;
  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-b border-border bg-accent-soft/60 px-3 text-xs">
      <span className="min-w-0 flex-1 truncate">{parts.join(' · ')}</span>
      {(view.solo.length > 0 || view.hidden.length > 0 || view.hiddenStashes.length > 0) && (
        <button type="button" className="text-accent hover:underline" onClick={A.showAllRefs}>
          {t('Show all branches')}
        </button>
      )}
      {view.pinned.length > 0 && (
        <button type="button" className="text-accent hover:underline" onClick={A.unpinAll}>
          {t('Unpin all')}
        </button>
      )}
    </div>
  );
}

const laneX = (lane: number, g: Geom) => g.pad + lane * g.lane + g.lane / 2;
/** `amount` is a `--lane-row*` token so each theme sets how strong the band is. */
const tint = (color: string, amount: string) =>
  `color-mix(in oklch, ${color} var(${amount}), transparent)`;
const band = (left: string, background: string): React.CSSProperties => ({
  left,
  background,
  borderRadius: `${ROW / 2}px 0 0 ${ROW / 2}px`,
});

export function CommitGraph() {
  const commits = useRepo((s) => s.commits);
  const graph = useRepo((s) => s.graph);
  const refs = useRepo((s) => s.refs);
  const info = useRepo((s) => s.info);
  const selection = useRepo((s) => s.selection);
  const select = useRepo((s) => s.select);
  const hasMore = useRepo((s) => s.hasMore);
  const loadMore = useRepo((s) => s.loadMore);
  const loading = useRepo((s) => s.loading);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>('loaded');
  const found = useGitSearch(searchOpen ? searchMode : 'loaded', query);
  // The list of commits git found folds away once one is picked; typing or focusing reopens it.
  const [resultsOpen, setResultsOpen] = useState(true);
  const [matchIdx, setMatchIdx] = useState(0);
  const { visible, compactGraph, smartBranches } = useColumnSettings();
  const show = useMemo(() => new Set<Column>(visible), [visible]);
  const geom = compactGraph ? COMPACT : NORMAL;

  const st = info?.status;
  const dirty = !!st && st.staged.length + st.unstaged.length + st.conflicted.length > 0;
  const offset = dirty ? 1 : 0;

  const refsByHash = useMemo(() => {
    const m = new Map<string, GitRef[]>();
    for (const r of refs?.refs ?? []) {
      const list = m.get(r.target) ?? [];
      list.push(r);
      m.set(r.target, list);
    }
    return m;
  }, [refs]);

  const autoGraph = useMemo(() => {
    const lanes = graph.reduce((m, r) => Math.max(m, r.width), 1);
    return Math.max(geom.compact ? 48 : 90, Math.min(MAX_GRAPH, geom.pad * 2 + lanes * geom.lane));
  }, [graph, geom]);
  const W = DEFAULT_WIDTHS;
  const [refsW, setRefsW] = usePersistentWidth('refs', W.refs, 70, 520);
  // 0 = automatic (fits the lanes up to MAX_GRAPH).
  const [graphUser, setGraphW] = usePersistentWidth('graph', W.graph, 0, 900);
  const graphWidth = graphUser >= 40 ? graphUser : autoGraph;
  const [authorW, setAuthorW] = usePersistentWidth('author', W.author, 70, 420);
  const [dateW, setDateW] = usePersistentWidth('date', W.date, 60, 300);
  const [shaW, setShaW] = usePersistentWidth('sha', W.sha, 60, 200);
  // 0 = fill the remaining space.
  const [msgW, setMsgW] = usePersistentWidth('message', W.message, 0, 3000);
  const msgRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /**
   * While a column is dragged only its CSS variable changes (no render of every row on each
   * pointer move, which made resizing stutter); the width is saved when the drag ends.
   */
  const live = (name: string, min: number, max: number) => (w: number) =>
    rootRef.current?.style.setProperty(name, `${Math.round(Math.min(max, Math.max(min, w)))}px`);
  // Hidden columns take no room: their width variables drop to 0. The message always takes the
  // rest of the row (a set width is its minimum), so it runs right up to the scrollbar.
  const vars = {
    '--refs-w': show.has('refs') ? `${refsW}px` : '0px',
    '--graph-w': show.has('graph') ? `${graphWidth}px` : '0px',
    '--author-w': `${authorW}px`,
    '--date-w': `${dateW}px`,
    '--sha-w': `${shaW}px`,
    '--msg-flex': !show.has('message') ? '0 0 0px' : msgW >= 120 ? `1 1 ${msgW}px` : '1 1 0%',
    '--msg-spacer': show.has('message') ? '0 0 0px' : '1 1 0%',
  } as React.CSSProperties;
  /** Column widths back to a layout preset (from the Column settings menu). */
  const resetWidths = (compact: boolean) => {
    const w = compact ? COMPACT_WIDTHS : DEFAULT_WIDTHS;
    setRefsW(w.refs);
    setGraphW(w.graph);
    setMsgW(w.message);
    setAuthorW(w.author);
    setDateW(w.date);
    setShaW(w.sha);
  };

  const headIdx = useMemo(
    () => (st?.head ? (hashIndex(commits).get(st.head) ?? -1) : -1),
    [commits, st?.head],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: number[] = [];
    // Searching the whole history: the loaded rows git found.
    if (found) {
      const hit = new Set((found.commits ?? []).map((c) => c.hash));
      commits.forEach((c, i) => hit.has(c.hash) && out.push(i));
      return out;
    }
    commits.forEach((c, i) => {
      if (
        c.subject.toLowerCase().includes(q) ||
        (c.body ?? '').toLowerCase().includes(q) ||
        c.authorName.toLowerCase().includes(q) ||
        c.hash.startsWith(q)
      )
        out.push(i);
    });
    return out;
  }, [commits, query, found]);
  const matchSet = useMemo(() => new Set(matches), [matches]);
  // Smart Branch Visibility: rows off the checked-out branch, its upstream and the base branches.
  const related = useMemo(
    () =>
      smartBranches ? relatedRows(commits, focusTips(refs?.refs ?? [], st?.head ?? null)) : null,
    [smartBranches, commits, refs, st?.head],
  );

  // Hovering a branch badge lights that branch's lane and fades the other rows (GitKraken).
  // Worked out from the in-memory layout, so a hover costs no backend call.
  const [hoverTip, setHoverTip] = useState<string | null>(null);
  const index = useMemo(() => rowIndex(commits), [commits]);
  const lit = useMemo(
    () => (hoverTip ? branchRows(commits, graph, index, hoverTip) : null),
    [commits, graph, index, hoverTip],
  );
  const onRefHover = useCallback(
    (hash: string, on: boolean) => setHoverTip((cur) => (on ? hash : cur === hash ? null : cur)),
    [],
  );

  const count = commits.length + offset + (hasMore || loading ? 1 : 0);
  // TanStack Virtual returns new functions on every render, so the React Compiler skips this
  // component on purpose; nothing memoized depends on `virt`.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virt = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 6,
  });

  // Scrolled near the end of what is loaded: fetch the next page (the background loader usually
  // got there first; this covers it while it waits).
  const liveItems = virt.getVirtualItems();
  const lastShown = liveItems.at(-1)?.index ?? 0;
  // Rows for a new scroll position render at low priority, in small slices: dragging the
  // scrollbar thumb across a long history mounts a whole screen of new rows per frame (~20 ms),
  // which made the thumb stutter. The scroll itself stays on the pointer; rows fill in right after.
  const items = useDeferredValue(liveItems);

  // While the list scrolls (wheel, or the scrollbar thumb held and dragged), pages loading in the
  // background wait: the list growing under the pointer makes the thumb jump.
  const scrolling = virt.isScrolling;
  const [thumbHeld, setThumbHeld] = useState(false);
  useEffect(() => {
    setGraphScrolling(scrolling || thumbHeld);
  }, [scrolling, thumbHeld]);
  useEffect(() => () => setGraphScrolling(false), []);
  // Held but still for a while (or the pointerup never came): loading goes on.
  useEffect(() => {
    if (!thumbHeld || scrolling) return;
    const t = setTimeout(() => setThumbHeld(false), 2000);
    return () => clearTimeout(t);
  }, [thumbHeld, scrolling]);
  useEffect(() => {
    if (!thumbHeld) return;
    const up = () => setThumbHeld(false);
    window.addEventListener('pointerup', up);
    window.addEventListener('blur', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('blur', up);
    };
  }, [thumbHeld]);
  useEffect(() => {
    if (hasMore && !loading && lastShown >= count - 60) void loadMore();
  }, [lastShown, count, hasMore, loading, loadMore]);

  const jump = (dir: 1 | -1) => {
    if (matches.length === 0) return;
    const next = (matchIdx + dir + matches.length) % matches.length;
    setMatchIdx(next);
    const i = matches[next]!;
    virt.scrollToIndex(i + offset, { align: 'center' });
    void select({ type: 'commit', hash: commits[i]!.hash });
  };

  // Keep the selected row in view when it is picked elsewhere (sidebar, parent links, …).
  const selectedHash = selection?.type === 'commit' ? selection.hash : null;
  const selectedIdx = selectedHash ? commits.findIndex((c) => c.hash === selectedHash) : -1;
  useEffect(() => {
    if (selectedIdx >= 0) virt.scrollToIndex(selectedIdx + offset, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Ctrl / Cmd + click toggles a commit, Shift + click selects from the last clicked one.
  const anchor = useRef<string | null>(null);
  const picked = useMemo(
    () => new Set(selection?.type === 'commits' ? selection.hashes : []),
    [selection],
  );
  // Rows get one stable handler (so their memo holds while the list scrolls); it calls the
  // latest `clickCommit`.
  const clickRef = useRef<(e: React.MouseEvent, i: number) => void>(() => {});
  const onPick = useCallback((e: React.MouseEvent, i: number) => clickRef.current(e, i), []);
  const clickCommit = (e: React.MouseEvent, i: number) => {
    const c = commits[i]!;
    const multi = !c.stash && (e.ctrlKey || e.metaKey || e.shiftKey);
    if (!multi) {
      anchor.current = c.hash;
      void select({ type: 'commit', hash: c.hash });
      return;
    }
    const current =
      selection?.type === 'commits'
        ? selection.hashes
        : selection?.type === 'commit'
          ? [selection.hash]
          : [];
    // Shift + click would also select the row text in between.
    if (e.shiftKey) window.getSelection()?.removeAllRanges();
    const a = anchor.current ? commits.findIndex((x) => x.hash === anchor.current) : -1;
    const next = pickCommits(commits, current, i, e.shiftKey ? a : -1);
    if (!e.shiftKey) anchor.current = c.hash;
    if (next.length === 0) void select(null);
    else if (next.length === 1) void select({ type: 'commit', hash: next[0]! });
    else void select({ type: 'commits', hashes: next });
  };
  useLayoutEffect(() => {
    clickRef.current = clickCommit;
  });

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const cur =
      selection?.type === 'commit'
        ? commits.findIndex((c) => c.hash === selection.hash) + offset
        : 0;
    const next = Math.max(
      0,
      Math.min(commits.length + offset - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)),
    );
    virt.scrollToIndex(next);
    if (next < offset) void select({ type: 'wip' });
    else void select({ type: 'commit', hash: commits[next - offset]!.hash });
  };

  const headerCls =
    'shrink-0 px-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase';

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col" style={vars}>
      <ViewBar />
      <div className="relative flex h-[22px] shrink-0 items-center border-b border-border bg-surface">
        {/* The column titles clip when the pane is narrow; search and the gear stay put. */}
        <div className="flex h-full min-w-0 flex-1 items-center overflow-hidden">
          {show.has('refs') && (
            <div
              className={cn(headerCls, 'relative h-full truncate leading-7')}
              style={{ width: REFS_W }}
            >
              {t('Branch / Tag')}
              <ResizeHandle
                width={refsW}
                onResize={setRefsW}
                onLive={live('--refs-w', 70, 520)}
                onReset={() => setRefsW(W.refs)}
              />
            </div>
          )}
          {show.has('graph') && (
            <div
              className={cn(headerCls, 'relative h-full truncate leading-7')}
              style={{ width: GRAPH_W }}
            >
              {t('Graph')}
              <ResizeHandle
                width={graphWidth}
                onResize={setGraphW}
                onLive={live('--graph-w', 40, 900)}
                onReset={() => setGraphW(W.graph)}
              />
            </div>
          )}
          {show.has('message') && (
            <div
              ref={msgRef}
              className={cn(headerCls, 'relative h-full min-w-0 truncate leading-7')}
              style={{ flex: 'var(--msg-flex)' }}
            >
              {t('Commit message')}
              <ResizeHandle
                width={msgW >= 120 ? msgW : (msgRef.current?.offsetWidth ?? 400)}
                onResize={(w) => setMsgW(Math.max(120, w))}
                onLive={(w) =>
                  rootRef.current?.style.setProperty(
                    '--msg-flex',
                    `1 1 ${Math.round(Math.min(3000, Math.max(120, w)))}px`,
                  )
                }
                onReset={() => setMsgW(W.message)}
              />
            </div>
          )}
          {!show.has('message') && <div className="flex-1" />}
          {!searchOpen && (
            <>
              {show.has('author') && (
                <div
                  className={cn(headerCls, 'relative h-full leading-7')}
                  style={{ width: 'var(--author-w)' }}
                >
                  <ResizeHandle
                    side="left"
                    width={authorW}
                    onResize={setAuthorW}
                    onLive={live('--author-w', 70, 420)}
                    onReset={() => setAuthorW(W.author)}
                  />
                  {t('Author')}
                </div>
              )}
              {show.has('date') && (
                <div
                  className={cn(headerCls, 'relative h-full leading-7')}
                  style={{ width: 'var(--date-w)' }}
                >
                  <ResizeHandle
                    side="left"
                    width={dateW}
                    onResize={setDateW}
                    onLive={live('--date-w', 60, 300)}
                    onReset={() => setDateW(W.date)}
                  />
                  {t('Date / Time')}
                </div>
              )}
              {show.has('sha') && (
                <div
                  className={cn(headerCls, 'relative h-full leading-7')}
                  style={{ width: 'var(--sha-w)' }}
                >
                  <ResizeHandle
                    side="left"
                    width={shaW}
                    onResize={setShaW}
                    onLive={live('--sha-w', 60, 200)}
                    onReset={() => setShaW(W.sha)}
                  />
                  {t('Sha')}
                </div>
              )}
            </>
          )}
        </div>
        {
          searchOpen ? (
            <div className="flex items-center gap-1 pr-2">
              <Select
                aria-label={t('Search in')}
                value={searchMode}
                onChange={(v) => {
                  setSearchMode(v as SearchMode);
                  setMatchIdx(-1);
                }}
                className="h-5 rounded px-1.5 text-[11px]"
                options={SEARCH_MODES.map((m) => ({ value: m.value, label: m.label() }))}
              />
              <div className="relative">
                <Search className="absolute top-1.5 left-2 size-3.5 text-muted-foreground" />
                <Input
                  autoFocus
                  className="h-6 w-60 pl-7 text-xs"
                  placeholder={
                    searchMode === 'loaded'
                      ? t('Search message, author or sha')
                      : searchMode === 'path'
                        ? t('Path, e.g. src/app')
                        : t('Text to find')
                  }
                  value={query}
                  onFocus={() => setResultsOpen(true)}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setMatchIdx(-1);
                    setResultsOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') jump(e.shiftKey ? -1 : 1);
                    if (e.key === 'Escape') {
                      setSearchOpen(false);
                      setQuery('');
                    }
                  }}
                />
              </div>
              <span className="w-12 text-center text-xs text-muted-foreground">
                {query ? `${matches.length ? Math.max(matchIdx, 0) + 1 : 0}/${matches.length}` : ''}
              </span>
              <IconButton label={t('Previous match')} onClick={() => jump(-1)}>
                <ChevronUp className="size-3.5" />
              </IconButton>
              <IconButton label={t('Next match')} onClick={() => jump(1)}>
                <ChevronDown className="size-3.5" />
              </IconButton>
              <IconButton
                label={t('Close search')}
                onClick={() => {
                  setSearchOpen(false);
                  setQuery('');
                }}
              >
                <X className="size-3.5" />
              </IconButton>
            </div>
          ) : null /* Opened from the toolbar's Search button or Ctrl+F. */
        }
        <IconButton
          label={t('Go to HEAD (Ctrl+Shift+H)')}
          disabled={!st?.head}
          onClick={() => void A.goToHead()}
        >
          <LocateFixed className="size-3.5" />
        </IconButton>
        <ColumnSettingsMenu onReset={resetWidths} />
        {searchOpen && found && resultsOpen && (
          <SearchResults result={found} onPick={() => setResultsOpen(false)} />
        )}
      </div>

      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onListKey}
        onPointerDown={(e) => {
          // On the scrollbar itself (the target is the scroll box, past its content width).
          const el = e.currentTarget;
          if (e.target === el && e.nativeEvent.offsetX >= el.clientWidth) setThumbHeld(true);
        }}
        className="min-h-0 flex-1 overflow-auto outline-none"
      >
        {commits.length === 0 && !dirty && (
          <div className="p-10 text-center text-muted-foreground">
            {t('No commits yet. Add files to the folder and make the first commit.')}
          </div>
        )}
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {/* One drag strip over the graph/message separators of every row. */}
          {show.has('graph') && (
            <div
              role="separator"
              aria-orientation="vertical"
              title={t('Drag to resize, double-click to reset')}
              onDoubleClick={() => setGraphW(0)}
              onPointerDown={(e) => {
                e.preventDefault();
                const x0 = e.clientX;
                const w0 = graphWidth;
                let last = w0;
                const show = live('--graph-w', 40, 900);
                const move = (ev: PointerEvent) => {
                  last = Math.max(40, w0 + ev.clientX - x0);
                  show(last);
                };
                const up = () => {
                  window.removeEventListener('pointermove', move);
                  window.removeEventListener('pointerup', up);
                  document.body.style.cursor = '';
                  if (last !== w0) setGraphW(last);
                };
                document.body.style.cursor = 'col-resize';
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', up);
              }}
              className="absolute top-0 z-20 h-full w-2 cursor-col-resize hover:bg-accent/40"
              style={{ left: `calc(${REFS_W} + ${GRAPH_W} - 3px)` }}
            />
          )}
          {items.map((v) => {
            const style = {
              position: 'absolute' as const,
              top: 0,
              left: 0,
              right: 0,
              height: ROW,
              transform: `translateY(${v.start}px)`,
            };
            if (dirty && v.index === 0) {
              return (
                <WipRow
                  key="wip"
                  style={style}
                  geom={geom}
                  show={show}
                  headRow={headIdx >= 0 ? graph[headIdx]! : null}
                  wipRow={wipRowOf(graph)}
                  selected={selection?.type === 'wip'}
                  onSelect={() => select({ type: 'wip' })}
                />
              );
            }
            const i = v.index - offset;
            if (i >= commits.length) {
              return (
                <div key="more" style={style} className="flex items-center justify-center">
                  {loading ? (
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Spinner className="size-3.5" />
                      {t('Loading commits…')}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="text-accent hover:underline"
                      onClick={() => loadMore()}
                    >
                      {t('Load more commits…')}
                    </button>
                  )}
                </div>
              );
            }
            const c = commits[i]!;
            const rowRefs = refsByHash.get(c.hash);
            const selected =
              (selection?.type === 'commit' && selection.hash === c.hash) ||
              (selection?.type === 'commits' && picked.has(c.hash)) ||
              (selection?.type === 'compare' &&
                (selection.base.hash === c.hash || selection.target.hash === c.hash));
            return (
              <CommitRow
                key={c.hash}
                start={v.start}
                index={i}
                commit={c}
                row={graph[i]!}
                refs={rowRefs}
                laneLabel={
                  rowRefs?.length || c.stash
                    ? null
                    : laneBranch(
                        graph[i]!.from,
                        (h) => refsByHash.get(h),
                        (h) => {
                          const k = index.get(h);
                          return k === undefined ? undefined : commits[k]?.subject;
                        },
                      )
                }
                geom={geom}
                show={show}
                selected={selected}
                isHead={c.hash === st?.head}
                detached={!st?.branch}
                match={matchSet.has(i)}
                dim={(matches.length > 0 && !matchSet.has(i)) || (!!related && !related.has(i))}
                faded={!!lit && !lit.has(i) && !selected}
                onRefHover={onRefHover}
                onPick={onPick}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function WipRow({
  style,
  geom,
  show,
  headRow,
  wipRow,
  selected,
  onSelect,
}: {
  style: React.CSSProperties;
  geom: Geom;
  show: Set<Column>;
  headRow: GraphRow | null;
  /** Laid out with the commits: a lane of its own, dotted down to HEAD however far it is. */
  wipRow: GraphRow | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const st = useRepo((s) => s.info?.status);
  if (!st) return null;
  const byPath = new Map<string, string>();
  for (const f of [...st.unstaged, ...st.staged, ...st.conflicted]) {
    if (!byPath.has(f.path)) byPath.set(f.path, f.status);
  }
  const counts = { mod: 0, add: 0, del: 0 };
  for (const s of byPath.values()) {
    if (s === 'A' || s === '?') counts.add++;
    else if (s === 'D') counts.del++;
    else counts.mod++;
  }
  const at = wipRow ?? headRow;
  const color = at ? laneColor(at.color) : 'var(--muted-foreground)';
  const cx = laneX(at?.lane ?? 0, geom);
  const r = geom.node;
  return (
    <div style={style} onClick={onSelect} className="relative flex cursor-default items-center">
      <div
        className="absolute inset-y-0.5 right-0"
        style={{
          ...band(
            bandLeft(show.has('graph') ? cx : 0),
            tint(color, selected ? '--lane-row-selected' : '--lane-row'),
          ),
          boxShadow: selected ? `inset 0 0 0 1px ${color}` : undefined,
        }}
      />
      <div style={{ width: REFS_W }} className="shrink-0" />
      {show.has('graph') && (
        <svg height={ROW} className="relative shrink-0 overflow-hidden" style={{ width: GRAPH_W }}>
          {/* Its dotted lane down to HEAD (and pinned lanes passing by). */}
          {wipRow?.segments.map((s, i) => (
            <path
              key={i}
              d={segmentPath(s, geom)}
              fill="none"
              stroke={laneColor(s.color)}
              strokeWidth={2}
              strokeDasharray={s.dashed ? '2 3' : undefined}
            />
          ))}
          {!wipRow && headRow && (
            <line
              x1={cx}
              x2={cx}
              y1={ROW / 2 + r}
              y2={ROW}
              stroke={color}
              strokeWidth={2}
              strokeDasharray="3 3"
            />
          )}
          <circle
            cx={cx}
            cy={ROW / 2}
            r={r - 1}
            fill="var(--background)"
            stroke={color}
            strokeWidth={2}
            strokeDasharray={geom.compact ? '2 2' : '4 3'}
          />
        </svg>
      )}
      <div className="relative my-px w-[3px] shrink-0 self-stretch" style={{ background: color }} />
      <div className="relative flex min-w-0 flex-1 items-center gap-3 overflow-hidden px-2">
        <span className="rounded border border-border/70 bg-background/60 px-2 py-0.5 text-muted-foreground italic">
          {'// WIP'}
        </span>
        {counts.mod > 0 && (
          <span className="flex items-center gap-1 font-medium text-foreground">
            <span className="font-bold text-wip-mod">✎</span>
            {counts.mod}
          </span>
        )}
        {counts.add > 0 && (
          <span className="flex items-center gap-1 font-medium text-foreground">
            <span className="text-[1.2em] leading-none font-black text-wip-add">+</span>
            {counts.add}
          </span>
        )}
        {counts.del > 0 && (
          <span className="flex items-center gap-1 font-medium text-foreground">
            <span className="font-bold text-wip-del">−</span>
            {counts.del}
          </span>
        )}
      </div>
    </div>
  );
}

const CommitRow = memo(function CommitRow({
  start,
  index,
  commit: c,
  row,
  refs,
  laneLabel,
  geom,
  show,
  selected,
  isHead,
  detached,
  match,
  dim,
  faded,
  onRefHover,
  onPick,
}: {
  /** Top of the row in the list (px). Numbers, not a style object, so the memo holds. */
  start: number;
  index: number;
  commit: Commit;
  row: GraphRow;
  refs: GitRef[] | undefined;
  /** Branch this commit's line belongs to, shown faintly while the row is hovered. */
  laneLabel: string | null;
  geom: Geom;
  show: Set<Column>;
  selected: boolean;
  isHead: boolean;
  /** HEAD is not on a branch: the HEAD commit gets a HEAD badge of its own. */
  detached: boolean;
  match: boolean;
  dim: boolean;
  /** Another branch's badge is hovered: fade this row's band and text. */
  faded: boolean;
  onRefHover: (hash: string, on: boolean) => void;
  /** Stable across renders: picks row `index`. */
  onPick: (e: React.MouseEvent, index: number) => void;
}) {
  const style: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: ROW,
    transform: `translateY(${start}px)`,
  };
  const groups = groupRefs(refs ?? [], isHead && detached);
  const color = laneColor(row.color);
  const cx = laneX(row.lane, geom);
  // With the graph hidden, the branch band starts right after the Branch / Tag column.
  const bandX = show.has('graph') ? cx : 0;
  // Several refs on one commit: hovering the badge column unfolds all of them in a stack.
  const [hovered, setHovered] = useState(false);
  // A badge's context menu takes the pointer away; keep the stack (and so the menu's anchor)
  // mounted until the menu closes, or the menu vanishes as soon as it opens.
  const [menuOpen, setMenuOpen] = useState(false);
  const stack = hovered || menuOpen;
  const onBadgeHover = (on: boolean) => onRefHover(c.hash, on);
  const fade = faded && 'opacity-35';
  return (
    <ContextMenuWrap
      items={() => {
        if (c.stash) return stashMenu(c.stash);
        // Right-clicking one of several picked commits acts on all of them, like GitKraken.
        const sel = useRepo.getState().selection;
        const picked =
          sel?.type === 'commits' && sel.hashes.includes(c.hash) ? A.commitsOf(sel.hashes) : [];
        return commitMenu(c, picked);
      }}
    >
      <div
        style={stack ? { ...style, zIndex: 30 } : style}
        onClick={(e) => onPick(e, index)}
        className={cn('group relative flex cursor-default items-center', dim && 'opacity-40')}
      >
        {/* Selected row: a faint full-width highlight and a bar in the branch colour, so the
            focused commit reads at a glance even when every row is on the same branch. */}
        {selected && (
          <>
            <div className="absolute inset-y-0 right-0 left-0 bg-selection/45" />
            <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />
          </>
        )}
        {/* Branch-coloured band from the node to the end of the row. Only the focused (selected)
            row lights up; every other row, including the checked-out one, stays faint. */}
        <div
          className={cn('absolute inset-y-0.5 right-0', fade)}
          style={{
            ...band(bandLeft(bandX), tint(color, selected ? '--lane-row-selected' : '--lane-row')),
            boxShadow: selected ? `inset 0 0 0 1px ${color}` : undefined,
          }}
        />
        {!selected && !faded && (
          <div
            className="absolute inset-y-0.5 right-0 opacity-0 group-hover:opacity-100"
            style={band(bandLeft(bandX), tint(color, '--lane-row-hover'))}
          />
        )}

        {show.has('refs') && (
          <div
            className="group/refs relative flex h-full shrink-0 items-center"
            style={{ width: REFS_W }}
            title={groups.length === 0 && laneLabel ? laneLabel : undefined}
            onMouseEnter={() => groups.length > 1 && setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            {stack && (
              // Just the badges, continuing downward from the row's own badge; no box around them.
              <div className="absolute top-[3px] right-1 left-2 z-10 flex flex-col items-start gap-[3px]">
                {groups.map((g) => (
                  <RefBadge
                    key={g.key}
                    group={g}
                    color={color}
                    onMenuOpenChange={setMenuOpen}
                    onHoverChange={onBadgeHover}
                  />
                ))}
              </div>
            )}
            {groups.length > 0 && (
              <div
                className="absolute top-1/2 right-0 h-0.5 -translate-y-1/2"
                style={{ left: 8, background: color }}
              />
            )}
            {groups.length === 0 && laneLabel && (
              // GitKraken-style: which branch this commit is on, while the row is hovered.
              // Hovering the column itself unfolds the whole name over the graph.
              <div className="pointer-events-none absolute inset-y-0 right-0 left-2 flex items-center opacity-0 transition-opacity group-hover:opacity-75 group-hover/refs:z-30 group-hover/refs:opacity-100">
                <span
                  className="min-w-0 truncate rounded px-1.5 py-px text-xs group-hover/refs:max-w-none group-hover/refs:shrink-0 group-hover/refs:overflow-visible group-hover/refs:shadow-md"
                  style={{
                    color,
                    background: `color-mix(in oklch, ${color} 18%, var(--background))`,
                    border: `1px dashed color-mix(in oklch, ${color} 55%, transparent)`,
                  }}
                >
                  {laneLabel}
                </span>
              </div>
            )}
            <div
              className={cn(
                'relative flex min-w-0 items-center gap-1 pl-2',
                // The unfolded list takes the badge's place while hovering.
                stack && 'invisible',
              )}
            >
              {groups.slice(0, 1).map((g) => (
                <RefBadge key={g.key} group={g} color={color} onHoverChange={onBadgeHover} />
              ))}
              {groups.length > 1 && (
                <span
                  className="shrink-0 rounded px-1 text-xs font-medium"
                  style={{ background: `color-mix(in oklch, ${color} 35%, var(--surface))` }}
                  title={groups
                    .slice(1)
                    .map((g) => g.label)
                    .join('\n')}
                >
                  +{groups.length - 1}
                </span>
              )}
            </div>
          </div>
        )}

        {show.has('graph') && (
          <GraphCell
            row={row}
            geom={geom}
            merge={c.parents.length > 1}
            stash={!!c.stash}
            head={isHead}
            name={c.authorName}
            email={c.authorEmail}
            withRefs={groups.length > 0 && show.has('refs')}
          />
        )}
        {/* Separator between the graph and the message; drag it (any row) to resize. */}
        {/* Same colour as the branch line; 1px gaps keep rows apart. */}
        <div
          className="relative my-px w-[3px] shrink-0 self-stretch"
          style={{ background: color }}
        />

        {show.has('message') && (
          <div
            className={cn('relative min-w-0 truncate px-2', match && 'text-accent', fade)}
            style={{ flex: 'var(--msg-flex)' }}
            title={c.body ? `${c.subject}\n\n${c.body}` : c.subject}
          >
            <span
              className={cn(
                selected && 'font-semibold text-foreground',
                c.stash && !selected && 'text-foreground/85 italic',
              )}
            >
              {c.subject}
            </span>
            {c.body && <span className="ml-2 text-muted-foreground">{c.body}</span>}
          </div>
        )}
        <div style={{ flex: 'var(--msg-spacer)' }} />
        {show.has('author') && (
          <div
            className={cn(
              'relative flex shrink-0 items-center gap-1.5 overflow-hidden px-2 text-muted-foreground',
              fade,
            )}
            style={{ width: 'var(--author-w)' }}
            title={`${c.authorName} <${c.authorEmail}>`}
          >
            <Avatar name={c.authorName} email={c.authorEmail} size={16} />
            <span className="min-w-0 truncate">{c.authorName}</span>
          </div>
        )}
        {show.has('date') && (
          <div
            className={cn('relative shrink-0 truncate px-2 text-muted-foreground', fade)}
            style={{ width: 'var(--date-w)' }}
            title={fullDate(c.authorTime)}
          >
            {relativeTime(c.authorTime)}
          </div>
        )}
        {show.has('sha') && (
          <div
            className={cn(
              'relative shrink-0 truncate px-2 font-mono text-xs text-muted-foreground',
              fade,
            )}
            style={{ width: 'var(--sha-w)' }}
          >
            {short(c.hash)}
          </div>
        )}
        {/* Author / date / sha line up with their titles, which end before the header's
            buttons; with none of them shown the message runs right up to the scrollbar. */}
        {(show.has('author') || show.has('date') || show.has('sha')) && (
          <div className="w-14 shrink-0" />
        )}
      </div>
    </ContextMenuWrap>
  );
});

/** Lines run straight down their lane and turn with a rounded corner. */
function segmentPath(s: Segment, g: Geom): string {
  const x1 = laneX(s.fromLane, g);
  const x2 = laneX(s.toLane, g);
  const y = (a: 0 | 1 | 2) => (a * ROW) / 2;
  const y1 = y(s.fromY);
  const y2 = y(s.toY);
  if (x1 === x2) return `M${x1} ${y1} V${y2}`;
  const dir = x2 > x1 ? 1 : -1;
  const r = Math.min(8, Math.abs(x2 - x1) / 2, ROW / 2);
  if (s.fromY === 1) {
    // From the node: across to the other lane, then down.
    return `M${x1} ${y1} H${x2 - dir * r} Q${x2} ${y1} ${x2} ${y1 + r} V${y2}`;
  }
  // Into the node: down the lane, then across.
  return `M${x1} ${y1} V${y2 - r} Q${x1} ${y2} ${x1 + dir * r} ${y2} H${x2}`;
}

function GraphCell({
  row,
  geom,
  merge,
  stash,
  head,
  name,
  email,
  withRefs,
}: {
  row: GraphRow;
  geom: Geom;
  merge: boolean;
  stash: boolean;
  head: boolean;
  name: string;
  email: string;
  withRefs: boolean;
}) {
  const cx = laneX(row.lane, geom);
  const cy = ROW / 2;
  const R = geom.node;
  const color = laneColor(row.color);
  // The author's Gravatar fills the avatar node (not compact dots, merges or stashes); the
  // initials underneath show until it has loaded, and stay when there is none.
  const face = R - 1.5;
  const gravatar = useGravatar(geom.compact || merge || stash ? null : email, face * 2);
  const clip = `gv${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg height={ROW} className="relative shrink-0 overflow-hidden" style={{ width: GRAPH_W }}>
      {withRefs && <line x1={0} x2={cx} y1={cy} y2={cy} stroke={color} strokeWidth={2} />}
      {row.segments.map((s, i) => (
        <path
          key={i}
          d={segmentPath(s, geom)}
          fill="none"
          stroke={laneColor(s.color)}
          strokeWidth={2}
          strokeDasharray={s.dashed ? '2 3' : undefined}
        />
      ))}
      {stash && geom.compact ? (
        <rect
          x={cx - R}
          y={cy - R}
          width={R * 2}
          height={R * 2}
          rx={2}
          fill="var(--background)"
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray="2 1.5"
        />
      ) : stash ? (
        // Like GitKraken: a dotted box with a stash (archive) glyph.
        <g>
          <rect
            x={cx - 10}
            y={cy - 10}
            width={20}
            height={20}
            rx={3}
            fill="var(--background)"
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray="3 2"
          />
          <path
            d={`M${cx - 5.5} ${cy - 3.5} H${cx + 5.5} V${cy - 1} H${cx - 5.5} Z M${cx - 4.5} ${cy - 1} V${cy + 5} H${cx + 4.5} V${cy - 1} M${cx - 1.5} ${cy + 1.5} H${cx + 1.5}`}
            fill="none"
            stroke={color}
            strokeWidth={1.3}
            strokeLinejoin="round"
          />
        </g>
      ) : merge ? (
        <circle
          cx={cx}
          cy={cy}
          r={geom.compact ? 4 : 6}
          fill={color}
          stroke="var(--background)"
          strokeWidth={1.5}
        />
      ) : geom.compact ? (
        // Compact: a small dot in the author's colour, ringed in the lane colour.
        <circle
          cx={cx}
          cy={cy}
          r={R}
          fill={`oklch(0.42 0.09 ${hue(name)})`}
          stroke={head ? 'white' : color}
          strokeWidth={2}
        >
          <title>{name}</title>
        </circle>
      ) : (
        <g>
          <title>{name}</title>
          <circle cx={cx} cy={cy} r={R} fill={color} />
          <circle
            cx={cx}
            cy={cy}
            r={R - 1.5}
            fill={`oklch(0.42 0.09 ${hue(name)})`}
            stroke={head ? 'white' : 'none'}
            strokeWidth={head ? 1 : 0}
          />
          <text
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={9}
            fontWeight={700}
            fill="white"
          >
            {initials(name)}
          </text>
          {gravatar.url && (
            <>
              <clipPath id={clip}>
                <circle cx={cx} cy={cy} r={face} />
              </clipPath>
              <image
                href={gravatar.url}
                x={cx - face}
                y={cy - face}
                width={face * 2}
                height={face * 2}
                clipPath={`url(#${clip})`}
                preserveAspectRatio="xMidYMid slice"
                onError={gravatar.fail}
              />
              {head && (
                <circle cx={cx} cy={cy} r={face} fill="none" stroke="white" strokeWidth={1} />
              )}
            </>
          )}
        </g>
      )}
      {/* The checked-out commit: a ring in the text colour around the node, so HEAD stands out
          in both themes even without a branch badge. */}
      {head && !stash && (
        <circle
          cx={cx}
          cy={cy}
          r={(merge ? (geom.compact ? 4 : 6) : R) + (geom.compact || merge ? 2.5 : 1.25)}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={1.5}
        >
          <title>HEAD</title>
        </circle>
      )}
    </svg>
  );
}

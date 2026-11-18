import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp, Pencil, Search, X } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import { Avatar, ContextMenuWrap, IconButton, Input, cn, type MenuItem } from '@/components/ui';
import { fullDate, relativeTime, short } from '@/lib/format';
import { laneColor, type GraphRow } from '@/lib/graph';
import { copyText } from '@/lib/native';
import type { Commit, GitRef } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import * as A from '../actions';
import { RefBadge, groupRefs } from './RefBadge';

const ROW = 30;
const LANE = 16;
const PAD = 8;
const MAX_GRAPH = 280;

function commitMenu(c: Commit): MenuItem[] {
  const cur = useRepo.getState().info?.status.branch;
  return [
    { label: 'Check out this commit', onSelect: () => A.checkoutCommit(c.hash) },
    { label: 'Create branch here', onSelect: () => A.newBranch(c.hash) },
    { label: 'Create tag here', onSelect: () => A.createTag(c.hash) },
    'sep',
    { label: 'Cherry-pick commit', onSelect: () => A.cherryPick(c) },
    { label: 'Revert commit', onSelect: () => A.revertCommit(c) },
    { label: `Reset ${cur ?? 'HEAD'} to this commit…`, onSelect: () => A.resetTo(c.hash) },
    'sep',
    { label: 'Copy commit SHA', onSelect: () => copyText(c.hash) },
    { label: 'Copy commit message', onSelect: () => copyText(c.subject) },
  ];
}

export function CommitGraph() {
  const commits = useRepo((s) => s.commits);
  const graph = useRepo((s) => s.graph);
  const refs = useRepo((s) => s.refs);
  const info = useRepo((s) => s.info);
  const selection = useRepo((s) => s.selection);
  const select = useRepo((s) => s.select);
  const hasMore = useRepo((s) => s.hasMore);
  const loadMore = useRepo((s) => s.loadMore);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [matchIdx, setMatchIdx] = useState(0);

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

  const graphWidth = useMemo(() => {
    const lanes = graph.reduce((m, r) => Math.max(m, r.width), 1);
    return Math.min(MAX_GRAPH, PAD * 2 + lanes * LANE);
  }, [graph]);

  const headIdx = useMemo(() => commits.findIndex((c) => c.hash === st?.head), [commits, st?.head]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: number[] = [];
    commits.forEach((c, i) => {
      if (
        c.subject.toLowerCase().includes(q) ||
        c.authorName.toLowerCase().includes(q) ||
        c.hash.startsWith(q)
      )
        out.push(i);
    });
    return out;
  }, [commits, query]);
  const matchSet = useMemo(() => new Set(matches), [matches]);

  const count = commits.length + offset + (hasMore ? 1 : 0);
  const virt = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 20,
  });

  const jump = (dir: 1 | -1) => {
    if (matches.length === 0) return;
    const next = (matchIdx + dir + matches.length) % matches.length;
    setMatchIdx(next);
    const i = matches[next]!;
    virt.scrollToIndex(i + offset, { align: 'center' });
    void select({ type: 'commit', hash: commits[i]!.hash });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Keyboard navigation through the list.
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center border-b border-border bg-surface text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        <div className="w-52 shrink-0 px-3">Branch / Tag</div>
        <div style={{ width: graphWidth }} className="shrink-0 px-2">
          Graph
        </div>
        <div className="flex-1 px-2">Commit message</div>
        {searchOpen ? (
          <div className="flex items-center gap-1 pr-2 normal-case">
            <div className="relative">
              <Search className="absolute top-1.5 left-2 size-3.5" />
              <Input
                autoFocus
                className="h-6 w-56 pl-7 text-xs"
                placeholder="Message, author or SHA"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setMatchIdx(-1);
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
            <span className="w-14 text-center font-normal">
              {query ? `${matches.length ? Math.max(matchIdx, 0) + 1 : 0}/${matches.length}` : ''}
            </span>
            <IconButton label="Previous match" onClick={() => jump(-1)}>
              <ChevronUp className="size-3.5" />
            </IconButton>
            <IconButton label="Next match" onClick={() => jump(1)}>
              <ChevronDown className="size-3.5" />
            </IconButton>
            <IconButton
              label="Close search"
              onClick={() => {
                setSearchOpen(false);
                setQuery('');
              }}
            >
              <X className="size-3.5" />
            </IconButton>
          </div>
        ) : (
          <>
            <div className="w-36 shrink-0 px-2">Author</div>
            <div className="w-24 shrink-0 px-2">Date</div>
            <div className="w-20 shrink-0 px-2">SHA</div>
            <IconButton
              label="Search commits (Ctrl+F)"
              className="mr-2"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="size-3.5" />
            </IconButton>
          </>
        )}
      </div>

      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onListKey}
        className="min-h-0 flex-1 overflow-auto outline-none"
      >
        {commits.length === 0 && !dirty && (
          <div className="p-10 text-center text-muted-foreground">
            No commits yet. Add files to the folder and make the first commit.
          </div>
        )}
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {virt.getVirtualItems().map((v) => {
            const style = {
              position: 'absolute' as const,
              top: 0,
              left: 0,
              right: 0,
              height: ROW,
              transform: `translateY(${v.start}px)`,
            };
            if (dirty && v.index === 0) {
              const lane = headIdx >= 0 ? graph[headIdx]!.lane : 0;
              const n = st!.staged.length + st!.unstaged.length + st!.conflicted.length;
              return (
                <div
                  key="wip"
                  style={style}
                  onClick={() => select({ type: 'wip' })}
                  className={cn(
                    'flex cursor-default items-center border-b border-border/40',
                    selection?.type === 'wip' ? 'bg-selection' : 'hover:bg-surface-hover',
                  )}
                >
                  <div className="w-52 shrink-0" />
                  <svg width={graphWidth} height={ROW} className="shrink-0">
                    {headIdx >= 0 && (
                      <line
                        x1={PAD + lane * LANE + LANE / 2}
                        x2={PAD + lane * LANE + LANE / 2}
                        y1={ROW / 2}
                        y2={ROW}
                        stroke={laneColor(graph[headIdx]!.color)}
                        strokeWidth={2}
                        strokeDasharray="3 3"
                      />
                    )}
                    <circle
                      cx={PAD + lane * LANE + LANE / 2}
                      cy={ROW / 2}
                      r={6}
                      fill="var(--background)"
                      stroke="var(--muted-foreground)"
                      strokeWidth={2}
                      strokeDasharray="3 2"
                    />
                  </svg>
                  <div className="flex min-w-0 flex-1 items-center gap-2 px-2 italic text-muted-foreground">
                    <Pencil className="size-3.5" />
                    {'// WIP'}
                    <span className="rounded bg-surface-muted px-1.5 text-xs not-italic">
                      {n} changed
                    </span>
                  </div>
                </div>
              );
            }
            const i = v.index - offset;
            if (i >= commits.length) {
              return (
                <div key="more" style={style} className="flex items-center justify-center">
                  <button
                    type="button"
                    className="text-accent hover:underline"
                    onClick={() => loadMore()}
                  >
                    Load more commits…
                  </button>
                </div>
              );
            }
            const c = commits[i]!;
            return (
              <CommitRow
                key={c.hash}
                style={style}
                commit={c}
                row={graph[i]!}
                refs={refsByHash.get(c.hash)}
                graphWidth={graphWidth}
                selected={selection?.type === 'commit' && selection.hash === c.hash}
                isHead={c.hash === st?.head}
                match={matchSet.has(i)}
                dim={matches.length > 0 && !matchSet.has(i)}
                onSelect={() => select({ type: 'commit', hash: c.hash })}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

const CommitRow = memo(function CommitRow({
  style,
  commit: c,
  row,
  refs,
  graphWidth,
  selected,
  isHead,
  match,
  dim,
  onSelect,
}: {
  style: React.CSSProperties;
  commit: Commit;
  row: GraphRow;
  refs: GitRef[] | undefined;
  graphWidth: number;
  selected: boolean;
  isHead: boolean;
  match: boolean;
  dim: boolean;
  onSelect: () => void;
}) {
  const groups = refs ? groupRefs(refs) : [];
  const color = laneColor(row.color);
  return (
    <ContextMenuWrap items={() => commitMenu(c)}>
      <div
        style={style}
        onClick={onSelect}
        className={cn(
          'flex cursor-default items-center',
          selected ? 'bg-selection' : 'hover:bg-surface-hover',
          dim && 'opacity-45',
        )}
      >
        <div className="flex w-52 shrink-0 items-center gap-1 overflow-hidden px-2">
          {groups.slice(0, 2).map((g) => (
            <RefBadge key={g.key} group={g} color={color} />
          ))}
          {groups.length > 2 && (
            <span
              className="shrink-0 rounded bg-surface-muted px-1 text-xs text-muted-foreground"
              title={groups
                .slice(2)
                .map((g) => g.label)
                .join(', ')}
            >
              +{groups.length - 2}
            </span>
          )}
        </div>
        <GraphCell
          row={row}
          width={graphWidth}
          merge={c.parents.length > 1}
          head={isHead}
          name={c.authorName}
        />
        <div
          className={cn('min-w-0 flex-1 truncate px-2', match && 'font-semibold text-accent')}
          title={c.subject}
        >
          {c.subject}
        </div>
        <div className="flex w-36 shrink-0 items-center gap-1.5 truncate px-2 text-muted-foreground">
          <Avatar name={c.authorName} size={16} />
          <span className="truncate">{c.authorName}</span>
        </div>
        <div
          className="w-24 shrink-0 truncate px-2 text-muted-foreground"
          title={fullDate(c.authorTime)}
        >
          {relativeTime(c.authorTime)}
        </div>
        <div className="w-20 shrink-0 px-2 font-mono text-xs text-muted-foreground">
          {short(c.hash)}
        </div>
        <div className="w-8 shrink-0" />
      </div>
    </ContextMenuWrap>
  );
});

function GraphCell({
  row,
  width,
  merge,
  head,
  name,
}: {
  row: GraphRow;
  width: number;
  merge: boolean;
  head: boolean;
  name: string;
}) {
  const x = (lane: number) => PAD + lane * LANE + LANE / 2;
  const y = (a: 0 | 1 | 2) => (a * ROW) / 2;
  const cx = x(row.lane);
  const color = laneColor(row.color);
  return (
    <svg width={width} height={ROW} className="shrink-0 overflow-hidden">
      {row.segments.map((s, i) => {
        const x1 = x(s.fromLane);
        const x2 = x(s.toLane);
        const y1 = y(s.fromY);
        const y2 = y(s.toY);
        const stroke = laneColor(s.color);
        if (x1 === x2)
          return <line key={i} x1={x1} x2={x2} y1={y1} y2={y2} stroke={stroke} strokeWidth={2} />;
        const my = (y1 + y2) / 2;
        return (
          <path
            key={i}
            d={`M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`}
            fill="none"
            stroke={stroke}
            strokeWidth={2}
          />
        );
      })}
      {merge ? (
        <circle cx={cx} cy={ROW / 2} r={4} fill={color} />
      ) : (
        <g>
          <title>{name}</title>
          <circle
            cx={cx}
            cy={ROW / 2}
            r={head ? 7 : 6}
            fill={color}
            stroke={head ? 'var(--foreground)' : 'var(--background)'}
            strokeWidth={head ? 2 : 1.5}
          />
        </g>
      )}
    </svg>
  );
}

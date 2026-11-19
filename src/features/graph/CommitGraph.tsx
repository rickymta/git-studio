import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp, Search, Settings2, X } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import {
  ContextMenuWrap,
  Dropdown,
  IconButton,
  Input,
  ResizeHandle,
  cn,
  usePersistentWidth,
  type MenuItem,
} from '@/components/ui';
import { fullDate, hue, initials, relativeTime, short } from '@/lib/format';
import { laneColor, type GraphRow, type Segment } from '@/lib/graph';
import { t } from '@/lib/i18n';
import { copyText } from '@/lib/native';
import type { Commit, GitRef, Stash } from '@/lib/types';
import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';
import * as A from '../actions';
import { onCurrentBranch, tidy } from './menuUtils';
import { RefBadge, groupRefs } from './RefBadge';

// Proportions measured from GitKraken: 28px rows, 22px lanes, ~20px avatar nodes.
const ROW = 28;
const LANE = 26;
const PAD = 12;
// Nodes 20% larger than GitKraken's (user preference).
const NODE_R = 12;
const MAX_GRAPH = 220;
/** Column widths live in CSS variables on the graph container, so resizing never re-renders rows. */
const REFS_W = 'var(--refs-w)';
const GRAPH_W = 'var(--graph-w)';
const bandLeft = (cx: number) => `calc(${REFS_W} + ${cx}px)`;

type Column = 'author' | 'date' | 'sha';

function useColumns(): [Set<Column>, (c: Column) => void] {
  const [cols, setCols] = useState<Set<Column>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('gitstudio.columns') ?? '[]'));
    } catch {
      return new Set();
    }
  });
  const toggle = (c: Column) => {
    const next = new Set(cols);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setCols(next);
    try {
      localStorage.setItem('gitstudio.columns', JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  };
  return [cols, toggle];
}

/** One entry for a single branch, a submenu of branch names for several. */
function perBranch(label: string, refs: GitRef[], onSelect: (r: GitRef) => void): MenuItem[] {
  if (refs.length === 0) return [];
  if (refs.length === 1) return [{ label, onSelect: () => onSelect(refs[0]!) }];
  return [{ label, items: refs.map((r) => ({ label: r.name, onSelect: () => onSelect(r) })) }];
}

function stashMenu(s: Stash): MenuItem[] {
  return [
    { label: t('Apply Stash'), onSelect: () => A.stashOp(s, 'apply') },
    { label: t('Pop Stash'), onSelect: () => A.stashOp(s, 'pop') },
    { label: t('Delete Stash'), danger: true, onSelect: () => A.stashOp(s, 'drop') },
    'sep',
    { label: t('Edit stash message'), onSelect: () => A.editStashMessage(s) },
    'sep',
    { label: t('Hide'), onSelect: () => A.hideStash(s) },
  ];
}

function commitMenu(c: Commit): MenuItem[] {
  const { info, refs } = useRepo.getState();
  const cur = info?.status.branch ?? null;
  const all = refs?.refs ?? [];
  const here = all.filter((r) => r.target === c.hash);
  const locals = here.filter((r) => r.kind === 'local');
  const remotes = here.filter((r) => r.kind === 'remote' && !r.name.endsWith('/HEAD'));
  const headBranch = locals.find((r) => r.isHead);
  const branches = [...locals, ...remotes];
  const mine = onCurrentBranch(c.hash);
  const hasGitHub = !!refs?.remotes.some((r) => r.github) && !!useGitHub.getState().user;
  /** The remote branch a local branch pushes to (its upstream, else origin/<name>). */
  const remoteOf = (l: GitRef) =>
    all.find((r) => r.kind === 'remote' && r.name === (l.upstream ?? `origin/${l.name}`));
  const tracked = new Set(locals.map((l) => remoteOf(l)?.fullName));

  const branchItems: MenuItem[] = [];
  for (const l of locals) {
    const remote = remoteOf(l);
    branchItems.push({
      label: t('Rename {name}…', { name: l.name }),
      onSelect: () => A.renameBranch(l),
    });
    branchItems.push({
      label: t('Delete {name}', { name: l.name }),
      danger: true,
      disabled: l.isHead,
      onSelect: () => A.deleteBranch(l),
    });
    if (remote) {
      branchItems.push({
        label: t('Delete {name}', { name: remote.name }),
        danger: true,
        onSelect: () => A.deleteBranch(remote),
      });
      branchItems.push({
        label: t('Delete {name} and {remote}', { name: l.name, remote: remote.name }),
        danger: true,
        disabled: l.isHead,
        onSelect: () => A.deleteBranchAndRemote(l, remote),
      });
    }
  }
  for (const r of remotes.filter((r) => !tracked.has(r.fullName)))
    branchItems.push({
      label: t('Delete {name}', { name: r.name }),
      danger: true,
      onSelect: () => A.deleteBranch(r),
    });

  const isHeadCommit = info?.status.head === c.hash;
  const isMerge = c.parents.length > 1;
  const view = useRepo.getState().view;
  // Branches here other than the checked-out one and the remote it tracks.
  const others = branches.filter(
    (r) => !r.isHead && !(headBranch && remoteOf(headBranch)?.fullName === r.fullName),
  );
  const viewItems = (label: string, active: string[], onSelect: (r: GitRef) => void): MenuItem[] =>
    branches.length === 0
      ? []
      : [
          {
            label,
            items: branches.map((r) => ({
              label: r.name,
              icon: active.includes(r.fullName) ? '✓' : undefined,
              onSelect: () => onSelect(r),
            })),
          },
        ];

  return tidy([
    ...(headBranch
      ? ([
          { label: t('Pull (fast-forward if possible)'), onSelect: () => A.pull() },
          { label: t('Push'), onSelect: () => A.push() },
          { label: t('Set Upstream'), onSelect: () => A.setUpstream(headBranch) },
          'sep',
        ] as MenuItem[])
      : []),
    ...(cur
      ? [
          ...perBranch(t('Merge into {branch}', { branch: cur }), others, (r) =>
            A.mergeInto(r.name),
          ),
          ...perBranch(t('Rebase {branch} onto', { branch: cur }), others, (r) =>
            A.rebaseOnto(r.name),
          ),
          'sep' as const,
        ]
      : []),
    {
      label: t('Checkout'),
      items: [
        ...branches
          .filter((r) => !r.isHead)
          .map((r) => ({ label: r.name, onSelect: () => A.checkoutRef(r) })),
        { label: t('this commit'), onSelect: () => A.checkoutCommit(c.hash) },
      ],
    },
    {
      label: t('Create worktree from'),
      items: [
        ...locals
          .filter((r) => !r.isHead)
          .map((r) => ({ label: r.name, onSelect: () => A.addWorktree({ branch: r.name }) })),
        ...remotes.map((r) => ({
          label: r.name,
          onSelect: () => A.addWorktree({ start: r.name }),
        })),
        { label: t('this commit'), onSelect: () => A.addWorktree({ start: c.hash }) },
      ],
    },
    'sep',
    { label: t('Create branch here'), onSelect: () => A.newBranch(c.hash) },
    {
      label: t('Reset {branch} to this commit', { branch: cur ?? 'HEAD' }),
      items: [
        { label: t('Soft - keep all changes'), onSelect: () => A.resetWithMode(c.hash, 'soft') },
        {
          label: t('Mixed - keep working copy but reset index'),
          onSelect: () => A.resetWithMode(c.hash, 'mixed'),
        },
        {
          label: t('Hard - discard all changes'),
          danger: true,
          onSelect: () => A.resetWithMode(c.hash, 'hard'),
        },
      ],
    },
    {
      label: t('Edit commit message'),
      disabled: !mine,
      onSelect: () => A.editCommitMessage(c.hash),
    },
    { label: t('Revert commit'), onSelect: () => A.revertCommit(c) },
    // Like GitKraken, entries that cannot apply to this commit are left out, not greyed.
    ...(mine ? [] : [{ label: t('Cherry pick commit'), onSelect: () => A.cherryPick(c) }]),
    'sep',
    { label: t('Drop commit'), danger: true, disabled: !mine, onSelect: () => A.dropCommit(c) },
    ...(mine && !isHeadCommit && !isMerge
      ? [{ label: t('Move commit up'), onSelect: () => A.moveCommit(c, false) }]
      : []),
    {
      label: t('Move commit down'),
      disabled: !mine || isMerge || c.parents.length === 0,
      onSelect: () => A.moveCommit(c, true),
    },
    'sep',
    ...(hasGitHub
      ? perBranch(
          locals.length === 1
            ? t('Start a pull request to {remote} from {branch}', {
                remote: A.prRemoteName() ?? 'origin',
                branch: remoteOf(locals[0]!)?.name ?? locals[0]!.name,
              })
            : t('Start a pull request from…'),
          locals,
          (r) => A.createPullRequest(r.name),
        )
      : []),
    'sep',
    { label: t('Apply patch…'), onSelect: () => A.applyPatchFile() },
    ...branchItems,
    'sep',
    // The local branch name, as GitKraken copies it ("main", not "origin/main").
    ...perBranch(t('Copy branch name'), locals.length ? locals : remotes, (r) => copyText(r.name)),
    { label: t('Copy commit sha'), onSelect: () => copyText(c.hash) },
    { label: t('Copy commit message'), onSelect: () => copyText(c.subject) },
    ...(A.hasWebRemote()
      ? [
          ...(() => {
            // The remote branch the link points at: the upstream of a local branch, or itself.
            const linkable = [
              ...new Map(
                branches
                  .map((r) => (r.kind === 'local' ? (remoteOf(r) ?? r) : r))
                  .filter((r) => A.branchUrl(r))
                  .map((r) => [r.fullName, r]),
              ).values(),
            ];
            return linkable.length === 1
              ? [
                  {
                    label: t('Copy link to branch: {name}', { name: linkable[0]!.name }),
                    onSelect: () => A.copyBranchLink(linkable[0]!),
                  },
                ]
              : perBranch(t('Copy link to branch'), linkable, (r) => A.copyBranchLink(r));
          })(),
          {
            label: t('Copy link to this commit on remote: {remote}', {
              remote: A.webRemoteName() ?? 'origin',
            }),
            onSelect: () => A.copyCommitLink(c.hash),
          },
        ]
      : []),
    { label: t('Create patch from commit'), onSelect: () => A.createPatch(c.hash) },
    'sep',
    ...viewItems(t('Pin to Left'), view.pinned, A.pinRef),
    ...viewItems(t('Solo'), view.solo, A.soloRef),
    ...viewItems(t('Hide'), view.hidden, A.hideRef),
    ...(view.solo.length || view.hidden.length
      ? [{ label: t('Show all branches'), onSelect: () => A.showAllRefs() }]
      : []),
    'sep',
    {
      label: t('Compare commit against working directory'),
      onSelect: () => A.compareWithWorkingDirectory(c.hash),
    },
    'sep',
    { label: t('Create tag here'), onSelect: () => A.createTag(c.hash) },
    { label: t('Create annotated tag here'), onSelect: () => A.createAnnotatedTag(c.hash) },
  ]);
}

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

const laneX = (lane: number) => PAD + lane * LANE + LANE / 2;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [matchIdx, setMatchIdx] = useState(0);
  const [cols, toggleCol] = useColumns();

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
    return Math.max(90, Math.min(MAX_GRAPH, PAD * 2 + lanes * LANE));
  }, [graph]);
  const [refsW, setRefsW] = usePersistentWidth('refs', 134, 70, 520);
  // 0 = automatic (fits the lanes up to MAX_GRAPH).
  const [graphUser, setGraphW] = usePersistentWidth('graph', 0, 0, 900);
  const graphWidth = graphUser >= 40 ? graphUser : autoGraph;
  const [authorW, setAuthorW] = usePersistentWidth('author', 160, 70, 420);
  const [dateW, setDateW] = usePersistentWidth('date', 112, 60, 300);
  const [shaW, setShaW] = usePersistentWidth('sha', 80, 60, 200);
  // 0 = fill the remaining space.
  const [msgW, setMsgW] = usePersistentWidth('message', 0, 0, 3000);
  const msgRef = useRef<HTMLDivElement>(null);
  const vars = {
    '--refs-w': `${refsW}px`,
    '--graph-w': `${graphWidth}px`,
    '--author-w': `${authorW}px`,
    '--date-w': `${dateW}px`,
    '--sha-w': `${shaW}px`,
    '--msg-flex': msgW >= 120 ? `0 0 ${msgW}px` : '1 1 0%',
    '--msg-spacer': msgW >= 120 ? '1 1 0%' : '0 0 0px',
  } as React.CSSProperties;

  const headIdx = useMemo(() => commits.findIndex((c) => c.hash === st?.head), [commits, st?.head]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: number[] = [];
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

  const colMenu: MenuItem[] = (
    [
      ['author', 'Author'],
      ['date', 'Date / time'],
      ['sha', 'Commit sha'],
    ] as const
  ).map(([c, label]) => ({
    label: t(label),
    icon: cols.has(c) ? '✓' : undefined,
    onSelect: () => toggleCol(c),
  }));

  const headerCls =
    'shrink-0 px-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase';

  return (
    <div className="flex h-full min-h-0 flex-col" style={vars}>
      <ViewBar />
      <div className="flex h-[22px] shrink-0 items-center border-b border-border bg-surface">
        <div className={cn(headerCls, 'relative h-full leading-7')} style={{ width: REFS_W }}>
          {t('Branch / Tag')}
          <ResizeHandle width={refsW} onResize={setRefsW} onReset={() => setRefsW(134)} />
        </div>
        <div className={cn(headerCls, 'relative h-full leading-7')} style={{ width: GRAPH_W }}>
          {t('Graph')}
          <ResizeHandle width={graphWidth} onResize={setGraphW} onReset={() => setGraphW(0)} />
        </div>
        <div
          ref={msgRef}
          className={cn(headerCls, 'relative h-full min-w-0 leading-7')}
          style={{ flex: 'var(--msg-flex)' }}
        >
          {t('Commit message')}
          <ResizeHandle
            width={msgW >= 120 ? msgW : (msgRef.current?.offsetWidth ?? 400)}
            onResize={(w) => setMsgW(Math.max(120, w))}
            onReset={() => setMsgW(0)}
          />
        </div>
        {msgW >= 120 && <div className="flex-1" />}
        {searchOpen ? (
          <div className="flex items-center gap-1 pr-2">
            <div className="relative">
              <Search className="absolute top-1.5 left-2 size-3.5 text-muted-foreground" />
              <Input
                autoFocus
                className="h-6 w-60 pl-7 text-xs"
                placeholder={t('Search message, author or sha')}
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
        ) : (
          <>
            {cols.has('author') && (
              <div
                className={cn(headerCls, 'relative h-full leading-7')}
                style={{ width: 'var(--author-w)' }}
              >
                <ResizeHandle
                  side="left"
                  width={authorW}
                  onResize={setAuthorW}
                  onReset={() => setAuthorW(160)}
                />
                {t('Author')}
              </div>
            )}
            {cols.has('date') && (
              <div
                className={cn(headerCls, 'relative h-full leading-7')}
                style={{ width: 'var(--date-w)' }}
              >
                <ResizeHandle
                  side="left"
                  width={dateW}
                  onResize={setDateW}
                  onReset={() => setDateW(112)}
                />
                {t('Date')}
              </div>
            )}
            {cols.has('sha') && (
              <div
                className={cn(headerCls, 'relative h-full leading-7')}
                style={{ width: 'var(--sha-w)' }}
              >
                <ResizeHandle
                  side="left"
                  width={shaW}
                  onResize={setShaW}
                  onReset={() => setShaW(80)}
                />
                {t('Sha')}
              </div>
            )}
            <IconButton label={t('Search commits (Ctrl+F)')} onClick={() => setSearchOpen(true)}>
              <Search className="size-3.5" />
            </IconButton>
            <Dropdown items={colMenu}>
              <button
                type="button"
                aria-label={t('Graph columns')}
                title={t('Graph columns')}
                className="mr-2 ml-0.5 flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover"
              >
                <Settings2 className="size-3.5" />
              </button>
            </Dropdown>
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
            {t('No commits yet. Add files to the folder and make the first commit.')}
          </div>
        )}
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {/* One drag strip over the graph/message separators of every row. */}
          <div
            role="separator"
            aria-orientation="vertical"
            title={t('Drag to resize, double-click to reset')}
            onDoubleClick={() => setGraphW(0)}
            onPointerDown={(e) => {
              e.preventDefault();
              const x0 = e.clientX;
              const w0 = graphWidth;
              const move = (ev: PointerEvent) => setGraphW(Math.max(40, w0 + ev.clientX - x0));
              const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                document.body.style.cursor = '';
              };
              document.body.style.cursor = 'col-resize';
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
            }}
            className="absolute top-0 z-20 h-full w-2 cursor-col-resize hover:bg-accent/40"
            style={{ left: `calc(${REFS_W} + ${GRAPH_W} - 3px)` }}
          />
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
              return (
                <WipRow
                  key="wip"
                  style={style}
                  graphWidth={graphWidth}
                  headRow={headIdx >= 0 ? graph[headIdx]! : null}
                  selected={selection?.type === 'wip'}
                  onSelect={() => select({ type: 'wip' })}
                />
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
                    {t('Load more commits…')}
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
                cols={cols}
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

function WipRow({
  style,
  graphWidth,
  headRow,
  selected,
  onSelect,
}: {
  style: React.CSSProperties;
  graphWidth: number;
  headRow: GraphRow | null;
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
  const color = headRow ? laneColor(headRow.color) : 'var(--muted-foreground)';
  const cx = laneX(headRow?.lane ?? 0);
  return (
    <div style={style} onClick={onSelect} className="relative flex cursor-default items-center">
      <div
        className="absolute inset-y-0.5 right-0"
        style={{
          ...band(bandLeft(cx), tint(color, selected ? '--lane-row-selected' : '--lane-row')),
          boxShadow: selected ? `inset 0 0 0 1px ${color}` : undefined,
        }}
      />
      <div style={{ width: REFS_W }} className="shrink-0" />
      <svg width={graphWidth} height={ROW} className="relative shrink-0">
        {headRow && (
          <line
            x1={cx}
            x2={cx}
            y1={ROW / 2 + NODE_R}
            y2={ROW}
            stroke={color}
            strokeWidth={2}
            strokeDasharray="3 3"
          />
        )}
        <circle
          cx={cx}
          cy={ROW / 2}
          r={NODE_R - 1}
          fill="var(--background)"
          stroke={color}
          strokeWidth={2}
          strokeDasharray="4 3"
        />
      </svg>
      <div className="relative my-px w-[3px] shrink-0 self-stretch" style={{ background: color }} />
      <div className="relative flex min-w-0 flex-1 items-center gap-3 px-2">
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
  style,
  commit: c,
  row,
  refs,
  graphWidth,
  cols,
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
  cols: Set<Column>;
  selected: boolean;
  isHead: boolean;
  match: boolean;
  dim: boolean;
  onSelect: () => void;
}) {
  const groups = refs ? groupRefs(refs) : [];
  const color = laneColor(row.color);
  const cx = laneX(row.lane);
  // Several refs on one commit: hovering the badge column unfolds all of them in a stack.
  const [hovered, setHovered] = useState(false);
  // A badge's context menu takes the pointer away; keep the stack (and so the menu's anchor)
  // mounted until the menu closes, or the menu vanishes as soon as it opens.
  const [menuOpen, setMenuOpen] = useState(false);
  const stack = hovered || menuOpen;
  return (
    <ContextMenuWrap items={() => (c.stash ? stashMenu(c.stash) : commitMenu(c))}>
      <div
        style={stack ? { ...style, zIndex: 30 } : style}
        onClick={onSelect}
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
          className="absolute inset-y-0.5 right-0"
          style={{
            ...band(bandLeft(cx), tint(color, selected ? '--lane-row-selected' : '--lane-row')),
            boxShadow: selected ? `inset 0 0 0 1px ${color}` : undefined,
          }}
        />
        {!selected && (
          <div
            className="absolute inset-y-0.5 right-0 opacity-0 group-hover:opacity-100"
            style={band(bandLeft(cx), tint(color, '--lane-row-hover'))}
          />
        )}

        <div
          className="relative flex h-full shrink-0 items-center"
          style={{ width: REFS_W }}
          onMouseEnter={() => groups.length > 1 && setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {stack && (
            // Just the badges, continuing downward from the row's own badge; no box around them.
            <div className="absolute top-[3px] right-1 left-2 z-10 flex flex-col items-start gap-[3px]">
              {groups.map((g) => (
                <RefBadge key={g.key} group={g} color={color} onMenuOpenChange={setMenuOpen} />
              ))}
            </div>
          )}
          {groups.length > 0 && (
            <div
              className="absolute top-1/2 right-0 h-0.5 -translate-y-1/2"
              style={{ left: 8, background: color }}
            />
          )}
          <div
            className={cn(
              'relative flex min-w-0 items-center gap-1 pl-2',
              // The unfolded list takes the badge's place while hovering.
              stack && 'invisible',
            )}
          >
            {groups.slice(0, 1).map((g) => (
              <RefBadge key={g.key} group={g} color={color} />
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

        <GraphCell
          row={row}
          width={graphWidth}
          merge={c.parents.length > 1}
          stash={!!c.stash}
          head={isHead}
          name={c.authorName}
          withRefs={groups.length > 0}
        />
        {/* Separator between the graph and the message; drag it (any row) to resize. */}
        {/* Same colour as the branch line; 1px gaps keep rows apart. */}
        <div
          className="relative my-px w-[3px] shrink-0 self-stretch"
          style={{ background: color }}
        />

        <div
          className={cn('relative min-w-0 truncate px-2', match && 'text-accent')}
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
        <div style={{ flex: 'var(--msg-spacer)' }} />
        {cols.has('author') && (
          <div
            className="relative shrink-0 truncate px-2 text-muted-foreground"
            style={{ width: 'var(--author-w)' }}
          >
            {c.authorName}
          </div>
        )}
        {cols.has('date') && (
          <div
            className="relative shrink-0 truncate px-2 text-muted-foreground"
            style={{ width: 'var(--date-w)' }}
            title={fullDate(c.authorTime)}
          >
            {relativeTime(c.authorTime)}
          </div>
        )}
        {cols.has('sha') && (
          <div
            className="relative shrink-0 truncate px-2 font-mono text-xs text-muted-foreground"
            style={{ width: 'var(--sha-w)' }}
          >
            {short(c.hash)}
          </div>
        )}
        <div className="w-14 shrink-0" />
      </div>
    </ContextMenuWrap>
  );
});

/** Lines run straight down their lane and turn with a rounded corner. */
function segmentPath(s: Segment): string {
  const x1 = laneX(s.fromLane);
  const x2 = laneX(s.toLane);
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
  width,
  merge,
  stash,
  head,
  name,
  withRefs,
}: {
  row: GraphRow;
  width: number;
  merge: boolean;
  stash: boolean;
  head: boolean;
  name: string;
  withRefs: boolean;
}) {
  const cx = laneX(row.lane);
  const cy = ROW / 2;
  const color = laneColor(row.color);
  return (
    <svg width={width} height={ROW} className="relative shrink-0 overflow-hidden">
      {withRefs && <line x1={0} x2={cx} y1={cy} y2={cy} stroke={color} strokeWidth={2} />}
      {row.segments.map((s, i) => (
        <path
          key={i}
          d={segmentPath(s)}
          fill="none"
          stroke={laneColor(s.color)}
          strokeWidth={2}
          strokeDasharray={s.dashed ? '2 3' : undefined}
        />
      ))}
      {stash ? (
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
        <circle cx={cx} cy={cy} r={6} fill={color} stroke="var(--background)" strokeWidth={1.5} />
      ) : (
        <g>
          <title>{name}</title>
          <circle cx={cx} cy={cy} r={NODE_R} fill={color} />
          <circle
            cx={cx}
            cy={cy}
            r={NODE_R - 1.5}
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
        </g>
      )}
    </svg>
  );
}

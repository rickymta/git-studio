import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Cloud,
  CornerDownLeft,
  FileText,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  LocateFixed,
  RefreshCw,
  Search,
  SquareTerminal,
  Tag,
  Zap,
} from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Spinner } from '@/components/ui';
import { toggleTerminal } from '@/features/terminal/runtime';
import { cn } from '@/lib/cn';
import { relativeTime, short } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { Commit, CommitDetail } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { useSpotlight } from '@/stores/spotlight';
import * as A from '../actions';
import {
  group,
  hitKey,
  matchCommits,
  matchFiles,
  matchRefs,
  matchStashes,
  score,
  type Group,
  type Hit,
} from './match';

/** Quick actions on the open repository. */
const ACTIONS: {
  id: string;
  label: () => string;
  detail: () => string;
  icon: ReactNode;
  run: () => void;
}[] = [
  {
    id: 'pull',
    label: () => t('Pull'),
    detail: () => t('Pull the current branch'),
    icon: <ArrowDownToLine className="size-4" />,
    run: () => void A.pull(),
  },
  {
    id: 'push',
    label: () => t('Push'),
    detail: () => t('Push the current branch'),
    icon: <ArrowUpFromLine className="size-4" />,
    run: () => void A.push(),
  },
  {
    id: 'fetch',
    label: () => t('Fetch all'),
    detail: () => t('Fetch every remote'),
    icon: <RefreshCw className="size-4" />,
    run: () => void A.fetchAll(),
  },
  {
    id: 'branch',
    label: () => t('New branch…'),
    detail: () => t('Create a branch at HEAD'),
    icon: <GitBranchPlus className="size-4" />,
    run: () => void A.newBranch(),
  },
  {
    id: 'stash',
    label: () => t('Stash changes'),
    detail: () => t('Put the uncommitted changes aside'),
    icon: <Archive className="size-4" />,
    run: () => void A.stash(),
  },
  {
    id: 'head',
    label: () => t('Go to HEAD'),
    detail: () => t('Show the checked-out commit in the graph'),
    icon: <LocateFixed className="size-4" />,
    run: () => void A.goToHead(),
  },
  {
    id: 'terminal',
    label: () => t('Terminal'),
    detail: () => t('Show or hide the terminal'),
    icon: <SquareTerminal className="size-4" />,
    run: toggleTerminal,
  },
];

const GROUP_LABEL: Record<Group['kind'], () => string> = {
  top: () => t('Top hit'),
  branch: () => t('Branches'),
  commit: () => t('Commits'),
  file: () => t('Files'),
  tag: () => t('Tags'),
  stash: () => t('Stashes'),
  action: () => t('Actions'),
};

/** Tracked files per repository and HEAD, read once per Spotlight opening at most. */
const fileLists = new Map<string, Promise<string[]>>();
function trackedFiles(repo: string, head: string | null): Promise<string[]> {
  const key = `${repo}\u0000${head}`;
  let p = fileLists.get(key);
  if (!p) {
    p = api.listFiles(repo, 'HEAD').catch(() => []);
    fileLists.set(key, p);
    if (fileLists.size > 8) fileLists.delete(fileLists.keys().next().value!);
  }
  return p;
}

/** Ctrl+Enter's action for a hit, if it has one. */
function altLabel(h: Hit): string | null {
  if (h.kind === 'branch') return h.ref.isHead ? null : t('Checkout');
  if (h.kind === 'file') return t('File history');
  if (h.kind === 'stash') return t('Apply');
  return null;
}

function activate(h: Hit, alt: boolean) {
  const r = useRepo.getState();
  const show = (hash: string) => {
    r.closeDiff();
    void r.reveal(hash);
  };
  switch (h.kind) {
    case 'commit':
      return show(h.commit.hash);
    case 'branch':
      if (alt && !h.ref.isHead) return void A.checkoutRef(h.ref);
      return show(h.ref.target);
    case 'tag':
      return show(h.ref.target);
    case 'file': {
      const head = r.info?.status.head ?? undefined;
      return void r.openDiff(
        { source: 'worktree', path: h.path, commit: head },
        alt ? 'history' : 'file',
      );
    }
    case 'stash':
      if (alt) return void A.stashOp(h.stash, 'apply');
      r.closeDiff();
      return void r.select({ type: 'commit', hash: h.stash.hash });
    case 'action':
      return ACTIONS.find((a) => a.id === h.id)?.run();
  }
}

/** Spotlight-style search over the open repository: branches, commits, files, tags, stashes. */
export function Spotlight() {
  const open = useSpotlight((s) => s.open);
  const setOpen = useSpotlight((s) => s.setOpen);
  const path = useRepo((s) => s.path);
  if (!path) return null;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed top-[12vh] left-1/2 z-50 flex max-h-[72vh] w-[min(920px,92vw)] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-surface/95 shadow-2xl backdrop-blur"
        >
          <Dialog.Title className="sr-only">{t('Search this repository')}</Dialog.Title>
          {open && <SpotlightBody repo={path} onClose={() => setOpen(false)} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SpotlightBody({ repo, onClose }: { repo: string; onClose: () => void }) {
  const refs = useRepo((s) => s.refs);
  const commits = useRepo((s) => s.commits);
  const head = useRepo((s) => s.info?.status.head ?? null);
  const repoName = useRepo((s) => s.info?.name ?? '');
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<string[] | null>(null);
  const [remote, setRemote] = useState<{ q: string; commits: Commit[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    input.current?.focus();
    let live = true;
    void trackedFiles(repo, head).then((f) => live && setFiles(f));
    return () => {
      live = false;
    };
  }, [repo, head]);

  // Older history: ask git for the message (debounced), past what the graph has loaded.
  const q = query.trim();
  useEffect(() => {
    if (q.length < 3) return;
    let live = true;
    const timer = setTimeout(() => {
      setSearching(true);
      api
        .searchCommits(repo, { message: q }, 30)
        .then((found) => live && setRemote({ q, commits: found }))
        .catch(() => live && setRemote({ q, commits: [] }))
        .finally(() => live && setSearching(false));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [repo, q]);

  const groups = useMemo(() => {
    const hits: Hit[] = [];
    if (!q) {
      // Nothing typed: local branches (checked-out first) and the actions.
      const local = (refs?.refs ?? [])
        .filter((r) => r.kind === 'local')
        .sort((a, b) => Number(b.isHead) - Number(a.isHead));
      for (const ref of local.slice(0, 6)) hits.push({ kind: 'branch', ref, score: 0 });
      for (const a of ACTIONS)
        hits.push({ kind: 'action', id: a.id, label: a.label(), detail: a.detail(), score: 0 });
      return group(hits, false);
    }
    hits.push(...matchRefs(refs?.refs ?? [], q));
    hits.push(...matchStashes(refs?.stashes ?? [], q));
    const local = matchCommits(commits, q, 40);
    hits.push(...local);
    if (remote?.q === q) {
      const seen = new Set(local.map((h) => (h.kind === 'commit' ? h.commit.hash : '')));
      for (const c of remote.commits)
        if (!seen.has(c.hash)) hits.push({ kind: 'commit', commit: c, score: 300 });
    }
    if (files) hits.push(...matchFiles(files, q, 30));
    for (const a of ACTIONS) {
      const s = score(a.label(), q);
      if (s !== null)
        hits.push({ kind: 'action', id: a.id, label: a.label(), detail: a.detail(), score: s });
    }
    return group(hits, true);
  }, [q, refs, commits, remote, files]);

  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);
  const index = Math.min(cursor, Math.max(0, flat.length - 1));
  const current = flat[index] ?? null;

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const run = (h: Hit, alt: boolean) => {
    onClose();
    activate(h, alt);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      setCursor((index + 1) % Math.max(1, flat.length));
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      setCursor((index - 1 + flat.length) % Math.max(1, flat.length));
    } else if (e.key === 'Enter' && current) {
      e.preventDefault();
      run(current, e.ctrlKey || e.metaKey);
    }
  };

  // Where each group starts in the flat list (the cursor's numbering).
  const starts: number[] = [];
  groups.reduce((at, g) => (starts.push(at), at + g.hits.length), 0);
  return (
    <div className="flex min-h-0 flex-col" onKeyDown={onKey}>
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <Search className="size-5 shrink-0 text-muted-foreground" />
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          placeholder={t('Search {name}: branches, commits, files, tags…', { name: repoName })}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-muted-foreground"
        />
        {(searching || (q && files === null)) && <Spinner className="size-4" />}
      </div>
      {flat.length === 0 ? (
        <div className="px-4 py-10 text-center text-muted-foreground">
          {searching ? t('Searching the whole history…') : t('No results in this repository.')}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
          <div ref={list} role="listbox" className="min-h-0 overflow-y-auto py-1.5">
            {groups.map((g, gi) => (
              <div key={g.kind} role="group" aria-label={GROUP_LABEL[g.kind]()}>
                <div className="px-4 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  {GROUP_LABEL[g.kind]()}
                </div>
                {g.hits.map((h, hi) => {
                  const i = starts[gi]! + hi;
                  return (
                    <HitRow
                      key={hitKey(h)}
                      hit={h}
                      index={i}
                      active={i === index}
                      onHover={() => i !== index && setCursor(i)}
                      onPick={(alt) => run(h, alt)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div className="min-h-0 overflow-y-auto border-l border-border bg-background/40">
            {current && <Preview key={hitKey(current)} repo={repo} hit={current} />}
          </div>
        </div>
      )}
      <div className="flex h-8 shrink-0 items-center gap-4 border-t border-border px-4 text-[11px] text-muted-foreground">
        <span>↑↓ {t('Move')}</span>
        <span className="flex items-center gap-1">
          <CornerDownLeft className="size-3" /> {t('Open')}
        </span>
        {current && altLabel(current) && <span>Ctrl+↵ {altLabel(current)}</span>}
        <span className="ml-auto">Esc {t('Close')}</span>
      </div>
    </div>
  );
}

function hitIcon(h: Hit): ReactNode {
  const cls = 'size-4 shrink-0';
  switch (h.kind) {
    case 'branch':
      return h.ref.kind === 'remote' ? <Cloud className={cls} /> : <GitBranch className={cls} />;
    case 'tag':
      return <Tag className={cls} />;
    case 'commit':
      return <GitCommitHorizontal className={cls} />;
    case 'file':
      return <FileText className={cls} />;
    case 'stash':
      return <Archive className={cls} />;
    case 'action':
      return ACTIONS.find((a) => a.id === h.id)?.icon ?? <Zap className={cls} />;
  }
}

function hitText(h: Hit): { title: string; sub: string; meta: string } {
  switch (h.kind) {
    case 'branch':
      return {
        title: h.ref.name,
        sub: h.ref.isHead ? t('Checked out') : h.ref.kind === 'remote' ? t('Remote branch') : '',
        meta: h.ref.ahead || h.ref.behind ? `↑${h.ref.ahead} ↓${h.ref.behind}` : '',
      };
    case 'tag':
      return { title: h.ref.name, sub: '', meta: short(h.ref.target) };
    case 'commit':
      return {
        title: h.commit.subject,
        sub: h.commit.authorName,
        meta: `${short(h.commit.hash)} · ${relativeTime(h.commit.commitTime)}`,
      };
    case 'file': {
      const cut = h.path.lastIndexOf('/');
      return { title: h.path.slice(cut + 1), sub: cut > 0 ? h.path.slice(0, cut) : '', meta: '' };
    }
    case 'stash':
      return { title: h.stash.message, sub: h.stash.name, meta: relativeTime(h.stash.time) };
    case 'action':
      return { title: h.label, sub: h.detail, meta: '' };
  }
}

function HitRow({
  hit,
  index,
  active,
  onHover,
  onPick,
}: {
  hit: Hit;
  index: number;
  active: boolean;
  onHover: () => void;
  onPick: (alt: boolean) => void;
}) {
  const { title, sub, meta } = hitText(hit);
  return (
    <div
      role="option"
      aria-selected={active}
      data-index={index}
      onMouseMove={onHover}
      onClick={(e) => onPick(e.ctrlKey || e.metaKey)}
      className={cn(
        'mx-1.5 flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-surface-hover',
      )}
    >
      <span className={cn(active ? '' : 'text-muted-foreground')}>{hitIcon(hit)}</span>
      <span className="min-w-0 shrink truncate">{title}</span>
      {sub && (
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-xs',
            active ? 'opacity-75' : 'text-muted-foreground',
          )}
        >
          {sub}
        </span>
      )}
      {!sub && <span className="flex-1" />}
      {meta && (
        <span
          className={cn(
            'shrink-0 text-[11px] tabular-nums',
            active ? 'opacity-75' : 'text-muted-foreground',
          )}
        >
          {meta}
        </span>
      )}
    </div>
  );
}

// ---- preview ----------------------------------------------------------------------------------

function useCommitDetail(repo: string, hash: string | null) {
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  useEffect(() => {
    if (!hash) return;
    let live = true;
    // A short wait: arrowing through the list does not ask for every row.
    const timer = setTimeout(() => {
      api
        .commit(repo, hash)
        .then((d) => live && setDetail(d))
        .catch(() => {});
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [repo, hash]);
  return detail;
}

function Preview({ repo, hit }: { repo: string; hit: Hit }) {
  if (hit.kind === 'file') return <FilePreview repo={repo} path={hit.path} />;
  if (hit.kind === 'action') {
    const a = ACTIONS.find((x) => x.id === hit.id);
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <span className="text-accent [&>svg]:size-8">{a?.icon}</span>
        <div className="text-base font-semibold">{hit.label}</div>
        <div className="text-sm text-muted-foreground">{hit.detail}</div>
      </div>
    );
  }
  const hash =
    hit.kind === 'commit'
      ? hit.commit.hash
      : hit.kind === 'stash'
        ? hit.stash.hash
        : hit.ref.target;
  return <CommitPreview repo={repo} hit={hit} hash={hash} />;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 text-xs">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

function CommitPreview({ repo, hit, hash }: { repo: string; hit: Hit; hash: string }) {
  const d = useCommitDetail(repo, hash);
  const heading =
    hit.kind === 'branch' || hit.kind === 'tag'
      ? hit.ref.name
      : hit.kind === 'stash'
        ? hit.stash.message
        : (d?.subject ?? (hit.kind === 'commit' ? hit.commit.subject : ''));
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-accent">{hitIcon(hit)}</span>
        <div className="min-w-0 text-[15px] leading-snug font-semibold break-words">{heading}</div>
      </div>
      {hit.kind === 'branch' && hit.ref.upstream && (
        <Field label={t('Upstream')}>
          {hit.ref.upstream}
          {(hit.ref.ahead > 0 || hit.ref.behind > 0) && ` · ↑${hit.ref.ahead} ↓${hit.ref.behind}`}
        </Field>
      )}
      {!d ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3.5" /> {t('Loading…')}
        </div>
      ) : (
        <>
          {hit.kind !== 'commit' && <Field label={t('Last commit')}>{d.subject}</Field>}
          <Field label={t('Author')}>{d.authorName}</Field>
          <Field label={t('Date')}>
            {new Date(d.commitTime * 1000).toLocaleString()} · {relativeTime(d.commitTime)}
          </Field>
          <Field label="SHA">
            <span className="font-mono">{d.hash.slice(0, 12)}</span>
          </Field>
          {d.body.trim() && (
            <pre className="max-h-40 overflow-hidden text-xs leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
              {d.body.trim()}
            </pre>
          )}
          {d.files.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                {t('{n} files changed', { n: d.files.length })}
              </div>
              {d.files.slice(0, 12).map((f) => (
                <div key={f.path} className="flex gap-2 truncate font-mono text-[11px]">
                  <span className="w-3 shrink-0 text-muted-foreground">{f.status}</span>
                  <span className="truncate">{f.path}</span>
                </div>
              ))}
              {d.files.length > 12 && (
                <div className="text-[11px] text-muted-foreground">
                  {t('and {n} more', { n: d.files.length - 12 })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilePreview({ repo, path }: { repo: string; path: string }) {
  const [text, setText] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api
        .readFile(repo, path)
        .then((f) => {
          if (!live) return;
          if (f.binary) setNote(t('Binary file'));
          else setText(f.text.split('\n').slice(0, 80).join('\n'));
        })
        .catch((e: Error) => live && setNote(e.message));
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [repo, path]);
  const cut = path.lastIndexOf('/');
  return (
    <div className="flex min-h-0 flex-col gap-2 p-4">
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="min-w-0">
          <div className="text-[15px] font-semibold break-words">{path.slice(cut + 1)}</div>
          {cut > 0 && (
            <div className="text-xs break-words text-muted-foreground">{path.slice(0, cut)}</div>
          )}
        </div>
      </div>
      {note ? (
        <div className="text-xs text-muted-foreground">{note}</div>
      ) : text === null ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3.5" /> {t('Loading…')}
        </div>
      ) : (
        <pre className="overflow-hidden rounded-md border border-border bg-background p-2 font-mono text-[11px] leading-[1.45] whitespace-pre text-muted-foreground">
          {text}
        </pre>
      )}
    </div>
  );
}

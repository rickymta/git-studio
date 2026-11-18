import {
  Archive,
  ChevronDown,
  ChevronRight,
  Cloud,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Laptop,
  Plus,
  RefreshCw,
  Search,
  Tag,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { Avatar, ContextMenuWrap, IconButton, cn } from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { api } from '@/lib/ipc';
import { openUrl } from '@/lib/native';
import type { GitRef, PullRequest } from '@/lib/types';
import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';
import * as A from '../actions';
import { refMenu } from '../graph/RefBadge';

function Section({
  id,
  title,
  icon,
  count,
  actions,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(`gitstudio.section.${id}`) !== '0';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(`gitstudio.section.${id}`, open ? '0' : '1');
    } catch {
      /* ignore */
    }
  };
  return (
    <div>
      <div className="group flex h-8 items-center gap-1.5 px-2 text-xs font-semibold text-muted-foreground">
        <button
          type="button"
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 uppercase tracking-wide hover:text-foreground"
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          {icon}
          <span className="truncate">{title}</span>
          {count !== undefined && <span className="font-normal">{count}</span>}
        </button>
        <span className="flex opacity-0 group-hover:opacity-100">{actions}</span>
      </div>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

function scrollToCommit(hash: string) {
  void useRepo.getState().select({ type: 'commit', hash });
}

function RefRow({ refItem, label, depth = 0 }: { refItem: GitRef; label: string; depth?: number }) {
  return (
    <ContextMenuWrap items={() => refMenu(refItem)}>
      <div
        onClick={() => scrollToCommit(refItem.target)}
        onDoubleClick={() => A.checkoutRef(refItem)}
        title={refItem.name}
        style={{ paddingLeft: 24 + depth * 12 }}
        className={cn(
          'flex h-7 cursor-default items-center gap-1.5 pr-2 hover:bg-surface-hover',
          refItem.isHead && 'font-semibold text-accent',
        )}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {refItem.upstreamGone && (
          <span className="text-xs text-warning" title="Upstream deleted">
            gone
          </span>
        )}
        {refItem.ahead > 0 && (
          <span className="text-xs text-muted-foreground" title="Commits to push">
            ↑{refItem.ahead}
          </span>
        )}
        {refItem.behind > 0 && (
          <span className="text-xs text-muted-foreground" title="Commits to pull">
            ↓{refItem.behind}
          </span>
        )}
      </div>
    </ContextMenuWrap>
  );
}

/** Group `feature/a`, `feature/b` under a folder like GitKraken does. */
function RefTree({ refs, strip = 0 }: { refs: GitRef[]; strip?: number }) {
  const { roots, folders } = useMemo(() => {
    const roots: GitRef[] = [];
    const folders = new Map<string, GitRef[]>();
    for (const r of refs) {
      const name = r.name.slice(strip);
      const i = name.indexOf('/');
      if (i > 0) {
        const f = name.slice(0, i);
        folders.set(f, [...(folders.get(f) ?? []), r]);
      } else roots.push(r);
    }
    return { roots, folders };
  }, [refs, strip]);
  return (
    <>
      {[...folders.entries()].map(([f, list]) => (
        <Folder key={f} name={f} refs={list} strip={strip + f.length + 1} />
      ))}
      {roots.map((r) => (
        <RefRow key={r.fullName} refItem={r} label={r.name.slice(strip)} />
      ))}
    </>
  );
}

function Folder({ name, refs, strip }: { name: string; refs: GitRef[]; strip: number }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-7 w-full items-center gap-1 pl-4 text-left text-muted-foreground hover:bg-surface-hover"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        {name}
      </button>
      {open && (
        <div className="pl-3">
          <RefTree refs={refs} strip={strip} />
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const refs = useRepo((s) => s.refs);
  const info = useRepo((s) => s.info);
  const { user, pulls, pullsError, loadPulls } = useGitHub();
  const [filter, setFilter] = useState('');

  const ghRemote =
    refs?.remotes.find((r) => r.name === 'origin' && r.github) ??
    refs?.remotes.find((r) => r.github);
  const slugKey = ghRemote?.github ? `${ghRemote.github.owner}/${ghRemote.github.repo}` : null;

  useEffect(() => {
    void loadPulls(ghRemote?.github ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugKey, user?.login]);

  const q = filter.trim().toLowerCase();
  const match = (r: GitRef) => !q || r.name.toLowerCase().includes(q);
  const all = refs?.refs ?? [];
  const locals = all.filter((r) => r.kind === 'local' && match(r));
  const tags = all.filter((r) => r.kind === 'tag' && match(r)).reverse();
  const remotes = refs?.remotes ?? [];

  const checkoutPr = async (pr: PullRequest) => {
    const remote = ghRemote?.name ?? 'origin';
    const sameRepo = pr.headRepo === slugKey;
    const remoteRef = all.find((r) => r.kind === 'remote' && r.name === `${remote}/${pr.headRef}`);
    if (sameRepo && remoteRef) await A.checkoutRef(remoteRef);
    else if (sameRepo) {
      await A.fetchAll();
      const again = useRepo
        .getState()
        .refs?.refs.find((r) => r.kind === 'remote' && r.name === `${remote}/${pr.headRef}`);
      if (again) await A.checkoutRef(again);
    } else {
      await openUrl(pr.htmlUrl);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 p-2">
        <div className="relative">
          <Search className="absolute top-2 left-2 size-3.5 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter branches and tags"
            className="h-7 w-full rounded-md border border-border bg-background pr-2 pl-7 text-xs outline-none focus:border-accent"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Section
          id="local"
          title="Local"
          icon={<Laptop className="size-3.5" />}
          count={locals.length}
          actions={
            <IconButton label="New branch" onClick={() => A.newBranch()}>
              <Plus className="size-3.5" />
            </IconButton>
          }
        >
          {info?.status.branch === null && info.status.head && (
            <div className="flex h-7 items-center gap-1.5 pl-6 font-semibold text-accent">
              <GitBranch className="size-3.5" /> HEAD (detached)
            </div>
          )}
          <RefTree refs={locals} />
        </Section>

        <Section
          id="remote"
          title="Remote"
          icon={<Cloud className="size-3.5" />}
          count={remotes.length}
          actions={
            <>
              <IconButton label="Fetch all" onClick={() => A.fetchAll()}>
                <RefreshCw className="size-3.5" />
              </IconButton>
              <IconButton label="Add remote" onClick={() => A.addRemote()}>
                <Plus className="size-3.5" />
              </IconButton>
            </>
          }
        >
          {remotes.length === 0 && (
            <div className="pl-6 text-xs text-muted-foreground">No remotes</div>
          )}
          {remotes.map((rm) => (
            <RemoteGroup
              key={rm.name}
              name={rm.name}
              url={rm.url}
              refs={all.filter((r) => r.kind === 'remote' && r.remote === rm.name && match(r))}
            />
          ))}
        </Section>

        {ghRemote?.github && (
          <Section
            id="prs"
            title="Pull requests"
            icon={<GitPullRequest className="size-3.5" />}
            count={pulls?.length}
            actions={
              user && (
                <>
                  <IconButton label="Refresh" onClick={() => loadPulls(ghRemote.github)}>
                    <RefreshCw className="size-3.5" />
                  </IconButton>
                  <IconButton label="Create pull request" onClick={() => A.createPullRequest()}>
                    <Plus className="size-3.5" />
                  </IconButton>
                </>
              )
            }
          >
            {!user && (
              <div className="pr-2 pl-6 text-xs text-muted-foreground">
                Connect GitHub to see pull requests.
              </div>
            )}
            {user && pullsError && (
              <div className="pr-2 pl-6 text-xs text-danger">{pullsError}</div>
            )}
            {user && pulls?.length === 0 && (
              <div className="pl-6 text-xs text-muted-foreground">No open pull requests</div>
            )}
            {pulls?.map((pr) => (
              <ContextMenuWrap
                key={pr.number}
                items={() => [
                  {
                    label: 'Open on GitHub',
                    icon: <ExternalLink className="size-3.5" />,
                    onSelect: () => openUrl(pr.htmlUrl),
                  },
                  { label: `Check out ${pr.headRef}`, onSelect: () => checkoutPr(pr) },
                ]}
              >
                <div
                  onClick={() => openUrl(pr.htmlUrl)}
                  title={`#${pr.number} ${pr.title}\n${pr.headRef} → ${pr.baseRef}`}
                  className="flex cursor-default items-start gap-2 py-1 pr-2 pl-6 hover:bg-surface-hover"
                >
                  <Avatar name={pr.author} url={pr.authorAvatar} size={16} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      <span className="text-muted-foreground">#{pr.number}</span> {pr.title}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {pr.draft && 'Draft · '}
                      {pr.headRef} → {pr.baseRef} · {relativeTime(Date.parse(pr.updatedAt) / 1000)}
                    </div>
                  </div>
                </div>
              </ContextMenuWrap>
            ))}
          </Section>
        )}

        <Section id="tags" title="Tags" icon={<Tag className="size-3.5" />} count={tags.length}>
          {tags.map((t) => (
            <RefRow key={t.fullName} refItem={t} label={t.name} />
          ))}
        </Section>

        <Section
          id="stashes"
          title="Stashes"
          icon={<Archive className="size-3.5" />}
          count={refs?.stashes.length}
          actions={
            <IconButton label="Stash changes" onClick={() => A.stash()}>
              <Plus className="size-3.5" />
            </IconButton>
          }
        >
          {refs?.stashes.map((s) => (
            <ContextMenuWrap
              key={s.name}
              items={() => [
                { label: 'Apply stash', onSelect: () => A.stashOp(s, 'apply') },
                { label: 'Pop stash', onSelect: () => A.stashOp(s, 'pop') },
                'sep',
                { label: 'Delete stash', danger: true, onSelect: () => A.stashOp(s, 'drop') },
              ]}
            >
              <div
                title={`${s.name}: ${s.message}`}
                onDoubleClick={() => A.stashOp(s, 'apply')}
                className="flex h-7 cursor-default items-center gap-2 pr-2 pl-6 hover:bg-surface-hover"
              >
                <span className="min-w-0 flex-1 truncate">{s.message}</span>
                <span className="text-xs text-muted-foreground">{relativeTime(s.time)}</span>
              </div>
            </ContextMenuWrap>
          ))}
        </Section>
      </div>
    </div>
  );
}

function RemoteGroup({ name, url, refs }: { name: string; url: string; refs: GitRef[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <ContextMenuWrap
        items={() => [
          {
            label: `Fetch ${name}`,
            onSelect: () => useRepo.getState().run('Fetch', (p) => api.fetch(p, name)),
          },
          'sep',
          { label: `Remove ${name}`, danger: true, onSelect: () => A.removeRemote(name) },
        ]}
      >
        <button
          type="button"
          title={url}
          onClick={() => setOpen(!open)}
          className="flex h-7 w-full items-center gap-1 pl-4 text-left hover:bg-surface-hover"
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <Cloud className="size-3.5 text-muted-foreground" /> {name}
        </button>
      </ContextMenuWrap>
      {open && (
        <div className="pl-3">
          <RefTree refs={refs} strip={name.length + 1} />
        </div>
      )}
    </div>
  );
}

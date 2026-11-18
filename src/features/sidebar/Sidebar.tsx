import {
  Archive,
  ChevronDown,
  ChevronRight,
  Cloud,
  ExternalLink,
  FolderTree,
  GitBranch,
  GitPullRequest,
  Laptop,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Tag,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Avatar, ContextMenuWrap, Dropdown, IconButton, cn, type MenuItem } from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { copyText, openUrl, revealPath } from '@/lib/native';
import type { GitRef, PullRequest, Worktree } from '@/lib/types';
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
    <div className="border-b border-border/60">
      <div className="group flex h-[30px] items-center gap-1 pr-2 pl-1.5 text-xs font-semibold text-muted-foreground hover:bg-surface-hover">
        <button
          type="button"
          onClick={toggle}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 tracking-wide uppercase hover:text-foreground"
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          {icon}
          <span className="truncate">{title}</span>
        </button>
        <span className="flex opacity-0 group-hover:opacity-100">{actions}</span>
        {count !== undefined && (
          <span className="w-6 text-right font-normal tabular-nums">{count}</span>
        )}
      </div>
      {open && <div className="pb-1.5">{children}</div>}
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
          <span className="text-xs text-warning" title={t('Upstream deleted')}>
            {t('gone')}
          </span>
        )}
        {refItem.ahead > 0 && (
          <span className="text-xs text-muted-foreground" title={t('Commits to push')}>
            ↑{refItem.ahead}
          </span>
        )}
        {refItem.behind > 0 && (
          <span className="text-xs text-muted-foreground" title={t('Commits to pull')}>
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
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        filterRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  // "Viewing {n}": the count is styled inside the sentence.
  const viewing = t('Viewing {n}').split('{n}');

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
      <div className="shrink-0 border-b border-border/60 px-2.5 pt-2.5 pb-2">
        <div className="mb-1.5 text-xs text-muted-foreground">
          {viewing[0]}
          <span className="font-semibold text-accent">
            {locals.length +
              tags.length +
              all.filter((r) => r.kind === 'remote' && match(r)).length}
          </span>
          {viewing[1]}
        </div>
        <div className="relative">
          <input
            ref={filterRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
            placeholder={t('Filter (Ctrl + Alt + F)')}
            className="h-7 w-full rounded border border-border bg-background pr-7 pl-2 text-xs outline-none focus:border-accent"
          />
          <Search className="absolute top-2 right-2 size-3.5 text-muted-foreground" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Section
          id="local"
          title={t('Local')}
          icon={<Laptop className="size-3.5" />}
          count={locals.length}
          actions={
            <IconButton label={t('New branch')} onClick={() => A.newBranch()}>
              <Plus className="size-3.5" />
            </IconButton>
          }
        >
          {info?.status.branch === null && info.status.head && (
            <div className="flex h-7 items-center gap-1.5 pl-6 font-semibold text-accent">
              <GitBranch className="size-3.5" /> {t('HEAD (detached)')}
            </div>
          )}
          <RefTree refs={locals} />
        </Section>

        <Section
          id="remote"
          title={t('Remote')}
          icon={<Cloud className="size-3.5" />}
          count={remotes.length}
          actions={
            <>
              <IconButton label={t('Fetch all')} onClick={() => A.fetchAll()}>
                <RefreshCw className="size-3.5" />
              </IconButton>
              <Dropdown
                items={[
                  { label: t('Add remote by URL…'), onSelect: () => A.addRemote() },
                  { label: t('Add remote from GitHub…'), onSelect: () => A.addRemoteFromGitHub() },
                  ...(remotes.some((r) => r.name === 'origin')
                    ? []
                    : [{ label: t('Publish to GitHub…'), onSelect: () => A.publishToGitHub() }]),
                ]}
              >
                <button
                  type="button"
                  aria-label={t('Add remote')}
                  title={t('Add remote')}
                  className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                </button>
              </Dropdown>
            </>
          }
        >
          {remotes.length === 0 && (
            <div className="pl-6 text-xs text-muted-foreground">{t('No remotes')}</div>
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

        <WorktreesSection />

        {ghRemote?.github && (
          <Section
            id="prs"
            title={t('Pull requests')}
            icon={<GitPullRequest className="size-3.5" />}
            count={pulls?.length}
            actions={
              user && (
                <>
                  <IconButton label={t('Refresh')} onClick={() => loadPulls(ghRemote.github)}>
                    <RefreshCw className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={t('Create pull request')}
                    onClick={() => A.createPullRequest()}
                  >
                    <Plus className="size-3.5" />
                  </IconButton>
                </>
              )
            }
          >
            {!user && (
              <div className="pr-2 pl-6 text-xs text-muted-foreground">
                {t('Connect GitHub to see pull requests.')}
              </div>
            )}
            {user && pullsError && (
              <div className="pr-2 pl-6 text-xs text-danger">{pullsError}</div>
            )}
            {user && pulls?.length === 0 && (
              <div className="pl-6 text-xs text-muted-foreground">{t('No open pull requests')}</div>
            )}
            {pulls?.map((pr) => (
              <ContextMenuWrap
                key={pr.number}
                items={() => [
                  {
                    label: t('Open on GitHub'),
                    icon: <ExternalLink className="size-3.5" />,
                    onSelect: () => openUrl(pr.htmlUrl),
                  },
                  {
                    label: t('Check out {name}', { name: pr.headRef }),
                    onSelect: () => checkoutPr(pr),
                  },
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
                      {pr.draft && t('Draft · ')}
                      {pr.headRef} → {pr.baseRef} · {relativeTime(Date.parse(pr.updatedAt) / 1000)}
                    </div>
                  </div>
                </div>
              </ContextMenuWrap>
            ))}
          </Section>
        )}

        <Section
          id="tags"
          title={t('Tags')}
          icon={<Tag className="size-3.5" />}
          count={tags.length}
        >
          {tags.map((tag) => (
            <RefRow key={tag.fullName} refItem={tag} label={tag.name} />
          ))}
        </Section>

        <Section
          id="stashes"
          title={t('Stashes')}
          icon={<Archive className="size-3.5" />}
          count={refs?.stashes.length}
          actions={
            <IconButton label={t('Stash changes')} onClick={() => A.stash()}>
              <Plus className="size-3.5" />
            </IconButton>
          }
        >
          {refs?.stashes.map((s) => (
            <ContextMenuWrap
              key={s.name}
              items={() => [
                { label: t('Apply stash'), onSelect: () => A.stashOp(s, 'apply') },
                { label: t('Pop stash'), onSelect: () => A.stashOp(s, 'pop') },
                'sep',
                { label: t('Delete stash'), danger: true, onSelect: () => A.stashOp(s, 'drop') },
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
  const gh = useRepo((s) => s.refs?.remotes.find((r) => r.name === name)?.github);
  return (
    <div>
      <ContextMenuWrap
        items={() => [
          {
            label: t('Fetch {name}', { name }),
            onSelect: () => useRepo.getState().run(t('Fetch'), (p) => api.fetch(p, name)),
          },
          ...(gh
            ? [
                {
                  label: url.startsWith('http') ? t('Switch to SSH URL') : t('Switch to HTTPS URL'),
                  onSelect: () => A.switchRemoteProtocol(name),
                },
                {
                  label: t('Open on GitHub'),
                  onSelect: () => openUrl(`https://github.com/${gh.owner}/${gh.repo}`),
                },
              ]
            : []),
          { label: t('Copy URL'), onSelect: () => navigator.clipboard.writeText(url) },
          'sep',
          {
            label: t('Remove {name}', { name }),
            danger: true,
            onSelect: () => A.removeRemote(name),
          },
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

function useWorktrees(): Worktree[] | null {
  const path = useRepo((s) => s.path);
  const head = useRepo((s) => s.info?.status.head);
  const branch = useRepo((s) => s.info?.status.branch);
  const refs = useRepo((s) => s.refs);
  const [list, setList] = useState<{ path: string; items: Worktree[] } | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api
      .worktrees(path)
      .then((items) => live && setList({ path, items }))
      .catch(() => live && setList({ path, items: [] }));
    return () => {
      live = false;
    };
  }, [path, head, branch, refs]);
  return list && list.path === path ? list.items : null;
}

function worktreeMenu(w: Worktree): MenuItem[] {
  return [
    {
      label: t('Open in new tab'),
      disabled: w.isCurrent,
      onSelect: () => A.openWorktree(w),
    },
    { label: t('Show in file explorer'), onSelect: () => revealPath(w.path) },
    { label: t('Open terminal here'), onSelect: () => A.openTerminalAt(w.path) },
    'sep',
    w.locked
      ? { label: t('Unlock'), onSelect: () => A.lockWorktree(w, false) }
      : { label: t('Lock'), disabled: w.isMain, onSelect: () => A.lockWorktree(w, true) },
    { label: t('Copy path'), onSelect: () => copyText(w.path) },
    'sep',
    {
      label: t('Remove worktree'),
      danger: true,
      disabled: w.isMain || w.isCurrent,
      onSelect: () => A.removeWorktree(w),
    },
  ];
}

function WorktreesSection() {
  const worktrees = useWorktrees();
  const badge = 'rounded border border-border px-1 text-[10px] leading-4 text-muted-foreground';
  return (
    <Section
      id="worktrees"
      title={t('Worktrees')}
      icon={<FolderTree className="size-3.5" />}
      count={worktrees?.length}
      actions={
        <Dropdown
          items={[
            { label: t('New worktree…'), onSelect: () => A.addWorktree() },
            { label: t('Prune stale worktrees'), onSelect: () => A.pruneWorktrees() },
          ]}
        >
          <button
            type="button"
            aria-label={t('Worktree actions')}
            title={t('Worktree actions')}
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        </Dropdown>
      }
    >
      {worktrees?.map((w) => (
        <ContextMenuWrap key={w.path} items={() => worktreeMenu(w)}>
          <div
            onDoubleClick={() => !w.isCurrent && A.openWorktree(w)}
            title={w.path}
            className={cn(
              'flex h-7 cursor-default items-center gap-1.5 pr-2 pl-6 hover:bg-surface-hover',
              w.isCurrent && 'font-semibold text-accent',
              w.prunable && 'opacity-60',
            )}
          >
            <span className="min-w-0 shrink truncate">{A.baseName(w.path)}</span>
            <span className="min-w-0 flex-1 truncate text-xs font-normal text-muted-foreground">
              {w.branch ?? (w.bare ? t('bare') : t('detached'))}
            </span>
            {w.isCurrent && <span className={badge}>{t('current')}</span>}
            {w.isMain && <span className={badge}>{t('main')}</span>}
            {w.locked && (
              <Lock className="size-3 shrink-0 text-muted-foreground" aria-label={t('locked')} />
            )}
            {w.prunable && <span className={cn(badge, 'text-warning')}>{t('prunable')}</span>}
          </div>
        </ContextMenuWrap>
      ))}
    </Section>
  );
}

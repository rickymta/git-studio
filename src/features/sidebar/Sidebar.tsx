import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudOff,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  GitPullRequestDraft,
  History,
  House,
  Laptop,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Tag,
  TreeDeciduous,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Avatar, ContextMenuWrap, Dropdown, IconButton, type MenuItem } from '@/components/ui';
import { cn } from '@/lib/cn';
import { relativeTime, short } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { copyText, openUrl, revealPath } from '@/lib/native';
import type { GitRef, PullRequest, ReflogEntry, Worktree } from '@/lib/types';
import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';
import { hostWords, useRepoPulls } from '../pulls/hosting';
import * as A from '../actions';
import { ExtraSections } from './ExtraSections';
import { Section } from './Section';
import { headMenu, refMenu } from '../graph/refMenu';
import { headOffBranch, worktreeOf } from '../graph/refGroups';

function scrollToCommit(hash: string | null | undefined) {
  if (hash) void useRepo.getState().reveal(hash);
}

/** A stash sits on the commit it was made from; highlight that commit in the graph. */
async function revealStash(hash: string) {
  const path = useRepo.getState().path;
  if (!path) return;
  try {
    const base = (await api.commit(path, hash)).parents[0];
    scrollToCommit(base);
  } catch {
    /* stash gone meanwhile */
  }
}

/** Small state marker at the end of a row; the tooltip names the state. */
function StateIcon({
  icon: Icon,
  label,
  className,
}: {
  icon: LucideIcon;
  label: string;
  className?: string;
}) {
  return (
    <span title={label} className="inline-flex shrink-0">
      <Icon
        aria-label={label}
        className={cn('size-3.5 shrink-0 text-muted-foreground', className)}
      />
    </span>
  );
}

function RefRow({ refItem, label, depth = 0 }: { refItem: GitRef; label: string; depth?: number }) {
  const worktree = useRepo((s) => worktreeOf(refItem, s.worktrees));
  // Leading icon says what the row is: the checked-out branch, a branch, or a tag.
  const Kind = refItem.kind === 'tag' ? Tag : refItem.isHead ? Check : GitBranch;
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
        <Kind
          className={cn('size-3.5 shrink-0', !refItem.isHead && 'text-muted-foreground')}
          strokeWidth={refItem.isHead ? 2.4 : 2}
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {worktree && (
          <StateIcon
            icon={TreeDeciduous}
            label={t('Checked out in worktree {name}', { name: A.baseName(worktree.path) })}
          />
        )}
        {refItem.kind === 'local' &&
          (refItem.upstreamGone ? (
            <StateIcon icon={CloudOff} label={t('Upstream deleted')} className="text-warning" />
          ) : refItem.upstream ? (
            <StateIcon icon={Cloud} label={t('Tracks {name}', { name: refItem.upstream })} />
          ) : (
            <StateIcon icon={Laptop} label={t('Local only (not pushed)')} />
          ))}
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
  const { host, signedIn, pulls, error: pullsError, reload: reloadPulls } = useRepoPulls();
  const words = host ? hostWords(host.kind) : null;
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

  const q = filter.trim().toLowerCase();
  const match = (r: GitRef) => !q || r.name.toLowerCase().includes(q);
  const all = refs?.refs ?? [];
  const locals = all.filter((r) => r.kind === 'local' && match(r));
  const tags = all.filter((r) => r.kind === 'tag' && match(r)).reverse();
  const remotes = refs?.remotes ?? [];

  // "Viewing {n}": the count is styled inside the sentence.
  const viewing = t('Viewing {n}').split('{n}');

  const checkoutPr = async (pr: PullRequest) => {
    const remote = host?.remote.name ?? 'origin';
    const sameRepo = pr.headRepo === host?.project;
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
          defaultOpen
          forceOpen={!!q}
          actions={
            <IconButton label={t('New branch')} onClick={() => A.newBranch()}>
              <Plus className="size-3.5" />
            </IconButton>
          }
        >
          {info?.status.head && headOffBranch(info.status.branch, info.status.head, refs?.refs) && (
            <ContextMenuWrap items={headMenu}>
              <div
                onClick={() => void A.goToHead()}
                title={t('HEAD (detached) at {hash}', { hash: short(info.status.head) })}
                className="flex h-7 cursor-default items-center gap-1.5 pr-2 pl-6 font-semibold text-accent hover:bg-surface-hover"
              >
                <Check className="size-3.5 shrink-0" strokeWidth={2.4} />
                <GitCommitHorizontal className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{t('HEAD (detached)')}</span>
                <span className="shrink-0 font-mono text-xs font-normal text-muted-foreground">
                  {short(info.status.head)}
                </span>
              </div>
            </ContextMenuWrap>
          )}
          <RefTree refs={locals} />
        </Section>

        <Section
          id="remote"
          title={t('Remote')}
          icon={<Cloud className="size-3.5" />}
          count={remotes.length}
          forceOpen={!!q}
          actions={
            <>
              <IconButton label={t('Fetch all')} onClick={() => A.fetchAll()}>
                <RefreshCw className="size-3.5" />
              </IconButton>
              <IconButton label={t('Add remote')} onClick={() => A.addRemote()}>
                <Plus className="size-3.5" />
              </IconButton>
            </>
          }
        >
          {remotes.length === 0 && (
            <div className="flex flex-col items-start gap-1 pl-6 text-xs text-muted-foreground">
              {t('No remotes')}
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => A.addRemote()}
              >
                {t('Add remote…')}
              </button>
              {!!useGitHub.getState().user && (
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => A.publishToGitHub()}
                >
                  {t('Publish to GitHub…')}
                </button>
              )}
            </div>
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

        <ReflogSection />

        <ExtraSections />

        {host && words && (
          <Section
            id="prs"
            title={words.section}
            icon={<GitPullRequest className="size-3.5" />}
            count={pulls?.length}
            actions={
              signedIn && (
                <>
                  <IconButton label={t('Refresh')} onClick={() => void reloadPulls()}>
                    <RefreshCw className="size-3.5" />
                  </IconButton>
                  <IconButton label={words.create} onClick={() => A.createPullRequest()}>
                    <Plus className="size-3.5" />
                  </IconButton>
                </>
              )
            }
          >
            {!signedIn && (
              <div className="pr-2 pl-6 text-xs text-muted-foreground">{words.connect}</div>
            )}
            {signedIn && pullsError && (
              <div className="pr-2 pl-6 text-xs text-danger">{pullsError}</div>
            )}
            {signedIn && pulls?.length === 0 && (
              <div className="pl-6 text-xs text-muted-foreground">{words.none}</div>
            )}
            {pulls?.map((pr) => (
              <ContextMenuWrap
                key={pr.number}
                items={() => [
                  {
                    label: words.open,
                    icon: <ExternalLink className="size-3.5" />,
                    onSelect: () => openUrl(pr.htmlUrl),
                  },
                  {
                    label: t('Copy link'),
                    onSelect: () => copyText(pr.htmlUrl),
                  },
                  {
                    label: t('Check out {name}', { name: pr.headRef }),
                    onSelect: () => checkoutPr(pr),
                  },
                ]}
              >
                <div
                  onClick={() =>
                    scrollToCommit(
                      all.find(
                        (r) =>
                          r.kind === 'remote' && r.name === `${host.remote.name}/${pr.headRef}`,
                      )?.target,
                    )
                  }
                  onDoubleClick={() => openUrl(pr.htmlUrl)}
                  title={`${words.ref(pr.number)} ${pr.title}\n${pr.headRef} → ${pr.baseRef}\n${t('Double-click to open on {host}', { host: words.host })}`}
                  className="flex cursor-default items-start gap-2 py-1 pr-2 pl-6 hover:bg-surface-hover"
                >
                  {pr.draft ? (
                    <GitPullRequestDraft className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <GitPullRequest className="mt-0.5 size-3.5 shrink-0 text-success" />
                  )}
                  <Avatar name={pr.author} url={pr.authorAvatar} size={16} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      <span className="text-muted-foreground">{words.ref(pr.number)}</span>{' '}
                      {pr.title}
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
          forceOpen={!!q}
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
                { label: t('Create branch from stash…'), onSelect: () => A.stashToBranch(s) },
                { label: t('Delete stash'), danger: true, onSelect: () => A.stashOp(s, 'drop') },
              ]}
            >
              <div
                title={`${s.name}: ${s.message}`}
                onClick={() => void revealStash(s.hash)}
                onDoubleClick={() => A.stashOp(s, 'apply')}
                className="flex h-7 cursor-default items-center gap-1.5 pr-2 pl-6 hover:bg-surface-hover"
              >
                <Archive className="size-3.5 shrink-0 text-muted-foreground" />
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

/** "github.com/owner/repo" from https / ssh / scp-style URLs; local paths unchanged. */
function displayUrl(url: string): string {
  const scp = /^[\w.-]+@([^:/]+):(.+?)(?:\.git)?$/.exec(url);
  if (scp) return `${scp[1]}/${scp[2]}`;
  try {
    const u = new URL(url);
    if (u.host) return `${u.host}${u.pathname.replace(/\.git$/, '')}`;
  } catch {
    /* not a URL */
  }
  return url;
}

function RemoteGroup({ name, url, refs }: { name: string; url: string; refs: GitRef[] }) {
  const [open, setOpen] = useState(true);
  const gh = useRepo((s) => s.refs?.remotes.find((r) => r.name === name)?.github);
  const gl = useRepo((s) => s.refs?.remotes.find((r) => r.name === name)?.gitlab);
  const pushUrl = useRepo((s) => s.refs?.remotes.find((r) => r.name === name)?.pushUrl);
  const branch = useRepo((s) => s.info?.status.branch ?? null);
  const tracked = useRepo((s) => s.info?.status.upstream?.startsWith(`${name}/`) ?? false);
  return (
    <div>
      <ContextMenuWrap
        items={() => [
          {
            label: t('Fetch {name}', { name }),
            onSelect: () => useRepo.getState().run(t('Fetch'), (p) => api.fetch(p, name)),
          },
          {
            label: t('Pull from {name}', { name }),
            disabled: !branch,
            onSelect: () => A.pull({ remote: name }),
          },
          {
            label: t('Push {branch} to {name}', { branch: branch ?? '', name }),
            disabled: !branch,
            onSelect: () => A.push({ remote: name }),
          },
          'sep',
          { label: t('Edit remote…'), onSelect: () => A.editRemote(name) },
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
          ...(gl
            ? [
                {
                  label: t('Open on GitLab'),
                  onSelect: () => openUrl(`https://gitlab.com/${gl.path}`),
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
        <div className="group/remote flex w-full items-center pr-1 hover:bg-surface-hover">
          <button
            type="button"
            title={
              pushUrl && pushUrl !== url
                ? `${url}
${t('push:')} ${pushUrl}`
                : url
            }
            onClick={() => setOpen(!open)}
            onDoubleClick={() => A.editRemote(name)}
            className="flex min-w-0 flex-1 items-start gap-1 py-1 pl-4 text-left"
          >
            <span className="mt-0.5 shrink-0">
              {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </span>
            <Cloud className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                {name}
                {tracked && (
                  <span className="rounded bg-accent-soft px-1 text-[10.5px] text-accent">
                    {t('tracking')}
                  </span>
                )}
              </span>
              <span className="block truncate text-[11.5px] text-muted-foreground">
                {displayUrl(url)}
              </span>
            </span>
          </button>
          <IconButton
            label={t('Edit remote…')}
            className="opacity-0 group-hover/remote:opacity-100 focus-visible:opacity-100"
            onClick={() => A.editRemote(name)}
          >
            <Pencil className="size-3.5" />
          </IconButton>
        </div>
      </ContextMenuWrap>
      {open && (
        <div className="pl-3">
          <RefTree refs={refs} strip={name.length + 1} />
        </div>
      )}
    </div>
  );
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

const REFLOG_PAGE = 50;

/** Kind of HEAD move, from the start of the reflog message (`checkout: …`, `commit (amend): …`). */
function reflogKind(action: string) {
  return action.split(/[:(\s]/, 1)[0] ?? '';
}

function reflogMenu(e: ReflogEntry): MenuItem[] {
  const cur = useRepo.getState().info?.status.branch ?? null;
  const head = useRepo.getState().info?.status.head ?? null;
  return [
    { label: t('Create branch here'), onSelect: () => A.newBranch(e.hash, e.selector) },
    ...(e.hash !== head
      ? [
          {
            label: t('Checkout this commit'),
            onSelect: () => A.checkoutCommit(e.hash, e.selector),
          },
          { label: t('Cherry pick commit'), onSelect: () => A.cherryPickHash(e.hash) },
          {
            label: t('Reset {branch} to this commit', { branch: cur ?? 'HEAD' }),
            items: [
              {
                label: t('Soft - keep all changes'),
                onSelect: () => A.resetWithMode(e.hash, 'soft'),
              },
              {
                label: t('Mixed - keep working copy but reset index'),
                onSelect: () => A.resetWithMode(e.hash, 'mixed'),
              },
              {
                label: t('Hard - discard all changes'),
                danger: true,
                onSelect: () => A.resetWithMode(e.hash, 'hard'),
              },
            ],
          },
        ]
      : []),
    'sep',
    { label: t('Copy commit sha'), onSelect: () => copyText(e.hash) },
    { label: t('Copy {selector}', { selector: e.selector }), onSelect: () => copyText(e.selector) },
  ];
}

/**
 * Where HEAD has been (`git reflog`): every checkout, commit, reset, merge or rebase, so work
 * dropped from every branch can be found and kept again. Loaded only while the section is open.
 */
function ReflogSection() {
  return (
    <Section id="reflog" title={t('HEAD history (reflog)')} icon={<History className="size-3.5" />}>
      <ReflogList />
    </Section>
  );
}

function ReflogList() {
  const path = useRepo((s) => s.path);
  const head = useRepo((s) => s.info?.status.head ?? null);
  // A new refs object means the repository changed (commit, checkout, branch deleted…).
  const refs = useRepo((s) => s.refs);
  const selection = useRepo((s) => s.selection);
  const [entries, setEntries] = useState<ReflogEntry[] | null>(null);
  const [limit, setLimit] = useState(REFLOG_PAGE);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!path) return;
    let live = true;
    api
      .reflog(path, limit + 1)
      .then((list) => {
        if (!live) return;
        setMore(list.length > limit);
        setEntries(list.slice(0, limit));
      })
      .catch(() => live && setEntries([]));
    return () => {
      live = false;
    };
  }, [path, head, refs, limit]);

  if (!entries) return <div className="h-7 pl-6 text-xs leading-7 text-muted-foreground">…</div>;
  if (entries.length === 0)
    return (
      <div className="h-7 pl-6 text-xs leading-7 text-muted-foreground">
        {t('No HEAD history yet.')}
      </div>
    );
  return (
    <>
      {entries.map((e) => {
        const picked = selection?.type === 'commit' && selection.hash === e.hash;
        return (
          <ContextMenuWrap key={e.selector} items={() => reflogMenu(e)}>
            <div
              title={`${e.selector} · ${short(e.hash)}\n${e.action}\n${e.subject}${
                e.unreferenced ? `\n${t('On no branch or tag: create a branch to keep it.')}` : ''
              }`}
              // A lost commit is not in the graph: show its details without paging through it.
              onClick={() =>
                void (e.unreferenced
                  ? useRepo.getState().select({ type: 'commit', hash: e.hash })
                  : useRepo.getState().reveal(e.hash))
              }
              className={cn(
                'flex h-7 cursor-default items-center gap-1.5 pr-2 pl-6 hover:bg-surface-hover',
                picked && 'bg-selection/45',
              )}
            >
              <span className="w-14 shrink-0 truncate text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                {reflogKind(e.action)}
              </span>
              <span className={cn('min-w-0 flex-1 truncate', e.unreferenced && 'italic')}>
                {e.subject || e.action}
              </span>
              {e.unreferenced && (
                <span className="shrink-0 rounded border border-warning/60 px-1 text-[10px] leading-4 text-warning">
                  {t('lost')}
                </span>
              )}
              <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(e.time)}</span>
            </div>
          </ContextMenuWrap>
        );
      })}
      {more && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + REFLOG_PAGE)}
          className="h-7 w-full pl-6 text-left text-xs text-accent hover:underline"
        >
          {t('Show older entries')}
        </button>
      )}
    </>
  );
}

function WorktreesSection() {
  const worktrees = useRepo((s) => s.worktrees);
  const badge = 'rounded border border-border px-1 text-[10px] leading-4 text-muted-foreground';
  return (
    <Section
      id="worktrees"
      title={t('Worktrees')}
      icon={<TreeDeciduous className="size-3.5" />}
      count={worktrees.length}
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
      {worktrees.map((w) => (
        <ContextMenuWrap key={w.path} items={() => worktreeMenu(w)}>
          <div
            onClick={() => scrollToCommit(w.head)}
            onDoubleClick={() => !w.isCurrent && A.openWorktree(w)}
            title={w.path}
            className={cn(
              'flex h-7 cursor-default items-center gap-1.5 pr-2 pl-6 hover:bg-surface-hover',
              w.isCurrent && 'font-semibold text-accent',
              w.prunable && 'opacity-60',
            )}
          >
            {w.isMain ? (
              <span title={t('Main working tree')} className="inline-flex shrink-0">
                <House className={cn('size-3.5', !w.isCurrent && 'text-muted-foreground')} />
              </span>
            ) : (
              <span title={t('Linked worktree')} className="inline-flex shrink-0">
                <TreeDeciduous
                  className={cn('size-3.5', !w.isCurrent && 'text-muted-foreground')}
                />
              </span>
            )}
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

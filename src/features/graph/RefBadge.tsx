import { Check, Cloud, FolderGit2, Laptop, Tag } from 'lucide-react';

import { ContextMenuWrap, cn, type MenuItem } from '@/components/ui';
import { t } from '@/lib/i18n';
import { copyText } from '@/lib/native';
import type { GitRef, Worktree } from '@/lib/types';
import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';
import * as A from '../actions';
import { reaches, tidy } from './menuUtils';

/** Pin to Left / Solo / Hide for one ref; each toggles. */
function viewMenu(ref: GitRef): MenuItem[] {
  const v = useRepo.getState().view;
  const on = (list: string[]) => list.includes(ref.fullName);
  return [
    {
      label: on(v.pinned) ? t('Unpin from left') : t('Pin to Left'),
      onSelect: () => A.pinRef(ref),
    },
    { label: on(v.solo) ? t('Stop solo') : t('Solo'), onSelect: () => A.soloRef(ref) },
    { label: on(v.hidden) ? t('Show') : t('Hide'), onSelect: () => A.hideRef(ref) },
  ];
}

/** Copy sha / link / patch entries for the commit a ref points at. */
function commitCopyItems(hash: string): MenuItem[] {
  return [
    { label: t('Copy commit sha'), onSelect: () => copyText(hash) },
    ...(A.hasWebRemote()
      ? [
          {
            label: t('Copy link to this commit on remote: {remote}', {
              remote: A.webRemoteName() ?? 'origin',
            }),
            onSelect: () => A.copyCommitLink(hash),
          },
        ]
      : []),
    { label: t('Create patch from commit'), onSelect: () => A.createPatch(hash) },
  ];
}

function tagItems(hash: string, label: string): MenuItem[] {
  return [
    { label: t('Create tag here'), onSelect: () => A.createTag(hash, label) },
    { label: t('Create annotated tag here'), onSelect: () => A.createAnnotatedTag(hash, label) },
  ];
}

/**
 * Context-menu items for a branch or tag (shared by graph badges and the sidebar), laid out
 * like GitKraken's: entries that cannot apply to this ref are left out, not greyed.
 */
export function refMenu(ref: GitRef): MenuItem[] {
  const { info, refs, commits } = useRepo.getState();
  const cur = info?.status.branch ?? null;
  const head = info?.status.head ?? null;
  const hasGitHub = !!refs?.remotes.some((r) => r.github) && !!useGitHub.getState().user;
  const commit = commits.find((c) => c.hash === ref.target && !c.stash);
  const atHead = head === ref.target;
  const detachedHere = !cur && atHead;

  if (ref.kind === 'tag') {
    return tidy([
      { label: t('Check out {name}', { name: ref.name }), onSelect: () => A.checkoutRef(ref) },
      {
        label: t('Create worktree from this commit'),
        onSelect: () => A.addWorktree({ start: ref.target }),
      },
      { label: t('Create branch here'), onSelect: () => A.newBranch(ref.target, ref.name) },
      'sep',
      { label: t('Push {name} to remote', { name: ref.name }), onSelect: () => A.pushTag(ref) },
      { label: t('Copy tag name'), onSelect: () => copyText(ref.name) },
      ...commitCopyItems(ref.target),
      'sep',
      ...viewMenu(ref),
      'sep',
      {
        label: t('Delete {name}', { name: ref.name }),
        danger: true,
        onSelect: () => A.deleteTag(ref),
      },
    ]);
  }

  const local = ref.kind === 'local';
  const isCur = local && ref.isHead;
  // Checked out in another worktree: pull, merge and remove act on that worktree.
  const wt = local && !isCur ? A.worktreeOf(ref.name) : null;
  // This ref is behind HEAD (HEAD contains it) or ahead of it (it contains HEAD).
  const onHead = reaches(head, ref.target);
  const behind = !isCur && !atHead && onHead;
  const ahead = !isCur && !atHead && !!head && reaches(ref.target, head);

  const sync: MenuItem[] = local
    ? [
        ...(isCur || wt || ref.upstream
          ? [{ label: t('Pull (fast-forward if possible)'), onSelect: () => A.pullBranch(ref) }]
          : []),
        { label: t('Push'), onSelect: () => (isCur ? A.push() : A.push({ branch: ref.name })) },
        { label: t('Set Upstream'), onSelect: () => A.setUpstream(ref) },
        ...(hasGitHub
          ? [{ label: t('Create pull request…'), onSelect: () => A.createPullRequest(ref.name) }]
          : []),
      ]
    : [];

  const integrate: MenuItem[] = [];
  if (cur && !isCur && !atHead) {
    if (behind && local) {
      integrate.push({
        label: t('Fast-forward {branch} to {target}', { branch: ref.name, target: cur }),
        onSelect: () => A.fastForwardBranch(ref.name, cur),
      });
      integrate.push({
        label: t('Merge {source} into {target}', { source: cur, target: ref.name }),
        onSelect: () => A.mergeIntoBranch(cur, ref),
      });
    }
    if (ahead)
      integrate.push({
        label: t('Fast-forward {branch} to {target}', { branch: cur, target: ref.name }),
        onSelect: () => A.fastForwardBranch(cur, ref.name),
      });
    if (!behind)
      integrate.push({
        label: t('Merge {source} into {target}', { source: ref.name, target: cur }),
        onSelect: () => A.mergeInto(ref.name),
      });
    integrate.push({
      label: t('Rebase {branch} onto {target}', { branch: cur, target: ref.name }),
      onSelect: () => A.rebaseOnto(ref.name),
    });
  }

  const checkout: MenuItem[] = [];
  if (wt)
    checkout.push({
      label: t('Open worktree from {name}', { name: ref.name }),
      onSelect: () => A.openWorktree(wt),
    });
  else if (!isCur) {
    checkout.push({
      label: t('Check out {name}', { name: ref.name }),
      onSelect: () => A.checkoutRef(ref),
    });
    checkout.push({
      label: t('Create worktree from {name}', { name: ref.name }),
      onSelect: () => A.addWorktree(local ? { branch: ref.name } : { start: ref.name }),
    });
  }
  if (!detachedHere)
    checkout.push({
      label: t('Checkout this commit'),
      onSelect: () => A.checkoutCommit(ref.target, ref.name),
    });

  const edit: MenuItem[] = [
    { label: t('Create branch here'), onSelect: () => A.newBranch(ref.target, ref.name) },
  ];
  if (commit && !onHead)
    edit.push({ label: t('Cherry pick commit'), onSelect: () => A.cherryPick(commit) });
  if (cur && !atHead)
    edit.push({
      label: t('Reset {branch} to this commit', { branch: cur }),
      items: [
        {
          label: t('Soft - keep all changes'),
          onSelect: () => A.resetWithMode(ref.target, 'soft'),
        },
        {
          label: t('Mixed - keep working copy but reset index'),
          onSelect: () => A.resetWithMode(ref.target, 'mixed'),
        },
        {
          label: t('Hard - discard all changes'),
          danger: true,
          onSelect: () => A.resetWithMode(ref.target, 'hard'),
        },
      ],
    });
  if (commit && onHead)
    edit.push({ label: t('Revert commit'), onSelect: () => A.revertCommit(commit) });

  const manage: MenuItem[] = [];
  if (local) {
    manage.push({
      label: t('Rename {name}…', { name: ref.name }),
      onSelect: () => A.renameBranch(ref),
    });
    if (wt) {
      manage.push({ label: t('Remove this worktree'), onSelect: () => A.removeWorktree(wt) });
      manage.push({
        label: t('Remove worktree and delete branch'),
        danger: true,
        onSelect: () => A.removeWorktreeAndBranch(wt, ref),
      });
    } else
      manage.push({
        label: t('Delete {name}', { name: ref.name }),
        danger: true,
        disabled: isCur,
        onSelect: () => A.deleteBranch(ref),
      });
  } else
    manage.push({
      label: t('Delete {name} on remote', { name: ref.name }),
      danger: true,
      onSelect: () => A.deleteBranch(ref),
    });

  return tidy([
    ...sync,
    'sep',
    ...integrate,
    'sep',
    ...checkout,
    'sep',
    {
      label: t('Create worktree from this commit'),
      onSelect: () => A.addWorktree({ start: ref.target }),
    },
    'sep',
    ...edit,
    'sep',
    ...manage,
    'sep',
    { label: t('Copy branch name'), onSelect: () => copyText(ref.name) },
    ...(A.branchUrl(ref)
      ? [{ label: t('Copy link to branch'), onSelect: () => A.copyBranchLink(ref) }]
      : []),
    ...commitCopyItems(ref.target),
    'sep',
    ...viewMenu(ref),
    'sep',
    ...tagItems(ref.target, ref.name),
  ]);
}

/** A local branch and its matching remote branch at the same commit render as one badge. */
export interface BadgeGroup {
  key: string;
  label: string;
  refs: GitRef[];
  head: boolean;
  kind: 'branch' | 'tag';
}

export function groupRefs(refs: GitRef[]): BadgeGroup[] {
  const groups: BadgeGroup[] = [];
  const locals = refs.filter((r) => r.kind === 'local');
  const remotes = refs.filter((r) => r.kind === 'remote');
  const used = new Set<string>();
  for (const l of locals) {
    const match = remotes.filter((r) => r.name.slice((r.remote?.length ?? 0) + 1) === l.name);
    match.forEach((m) => used.add(m.fullName));
    groups.push({
      key: l.fullName,
      label: l.name,
      refs: [l, ...match],
      head: l.isHead,
      kind: 'branch',
    });
  }
  for (const r of remotes) {
    if (!used.has(r.fullName))
      groups.push({ key: r.fullName, label: r.name, refs: [r], head: false, kind: 'branch' });
  }
  for (const tag of refs.filter((r) => r.kind === 'tag')) {
    groups.push({ key: tag.fullName, label: tag.name, refs: [tag], head: false, kind: 'tag' });
  }
  // Current branch first.
  return groups.sort((a, b) => Number(b.head) - Number(a.head));
}

/** The other worktree (not the one open here) that has this local branch checked out. */
export function worktreeOf(ref: GitRef, worktrees: Worktree[]): Worktree | undefined {
  if (ref.kind !== 'local') return undefined;
  return worktrees.find((w) => !w.isCurrent && w.branch === ref.name);
}

export function RefBadge({
  group,
  color,
  onMenuOpenChange,
}: {
  group: BadgeGroup;
  color: string;
  onMenuOpenChange?: (open: boolean) => void;
}) {
  const primary = group.refs[0]!;
  const hasLocal = group.refs.some((r) => r.kind === 'local');
  const hasRemote = group.refs.some((r) => r.kind === 'remote');
  const worktrees = useRepo((s) => s.worktrees);
  const worktree = group.refs.map((r) => worktreeOf(r, worktrees)).find(Boolean);
  const names = group.refs.map((r) => r.name).join(', ');
  return (
    <ContextMenuWrap items={() => refMenu(primary)} onOpenChange={onMenuOpenChange}>
      <span
        onDoubleClick={(e) => {
          e.stopPropagation();
          void A.checkoutRef(primary);
        }}
        title={
          worktree
            ? `${names}\n${t('Checked out in worktree {name}', { name: A.baseName(worktree.path) })}`
            : names
        }
        className={cn(
          'inline-flex h-[22px] max-w-[176px] min-w-0 items-center gap-1 rounded border px-1.5 text-xs font-medium text-foreground',
          group.head && 'font-semibold',
        )}
        style={{
          borderColor: color,
          // Opaque so the connector line to the graph runs behind the badge.
          background: `color-mix(in oklch, ${color} ${group.head ? 60 : 42}%, var(--background))`,
        }}
      >
        {group.head && <Check className="size-[15.4px] shrink-0" strokeWidth={2.4} />}
        {group.kind === 'tag' && <Tag className="size-[15.4px] shrink-0" strokeWidth={2.4} />}
        <span className="truncate">{group.label}</span>
        {hasLocal && <Laptop className="size-[15.4px] shrink-0" strokeWidth={2.4} />}
        {hasRemote && <Cloud className="size-[15.4px] shrink-0" strokeWidth={2.4} />}
        {worktree && <FolderGit2 className="size-[15.4px] shrink-0" strokeWidth={2.4} />}
      </span>
    </ContextMenuWrap>
  );
}

// Context menus of graph rows: a commit (or several picked commits) and a stash.

import type { MenuItem } from '@/components/ui';
import { t } from '@/lib/i18n';
import { copyText } from '@/lib/native';
import type { Commit, GitRef, Stash } from '@/lib/types';
import { requestHost } from '../pulls/hosting';
import { useRepo } from '@/stores/repo';
import * as A from '../actions';
import { bisectMenu } from '../repoTools';
import { onCurrentBranch, tidy } from './menuUtils';

/** One entry for a single branch, a submenu of branch names for several. */
function perBranch(label: string, refs: GitRef[], onSelect: (r: GitRef) => void): MenuItem[] {
  if (refs.length === 0) return [];
  if (refs.length === 1) return [{ label, onSelect: () => onSelect(refs[0]!) }];
  return [{ label, items: refs.map((r) => ({ label: r.name, onSelect: () => onSelect(r) })) }];
}

export function stashMenu(s: Stash): MenuItem[] {
  return [
    { label: t('Apply Stash'), onSelect: () => A.stashOp(s, 'apply') },
    { label: t('Pop Stash'), onSelect: () => A.stashOp(s, 'pop') },
    { label: t('Delete Stash'), danger: true, onSelect: () => A.stashOp(s, 'drop') },
    'sep',
    { label: t('Edit stash message'), onSelect: () => A.editStashMessage(s) },
    { label: t('Create branch from stash…'), onSelect: () => A.stashToBranch(s) },
    'sep',
    { label: t('Hide'), onSelect: () => A.hideStash(s) },
  ];
}

/**
 * Menu of commit `c`. With several `picked` commits that include `c` (newest first), the entries
 * that act on commits act on all of them, like GitKraken's "Cherry pick 3 commits".
 */
export function commitMenu(c: Commit, picked: Commit[] = []): MenuItem[] {
  const { info, refs } = useRepo.getState();
  const many = picked.length > 1 && picked.some((p) => p.hash === c.hash) ? picked : null;
  const cur = info?.status.branch ?? null;
  const all = refs?.refs ?? [];
  const here = all.filter((r) => r.target === c.hash);
  const locals = here.filter((r) => r.kind === 'local');
  const remotes = here.filter((r) => r.kind === 'remote' && !r.name.endsWith('/HEAD'));
  const headBranch = locals.find((r) => r.isHead);
  const branches = [...locals, ...remotes];
  const mine = onCurrentBranch(c.hash);
  const reqHost = requestHost(refs?.remotes);
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
          ...perBranch(
            t('Merge into {branch}', { branch: cur }),
            others,
            (r) => void A.mergeInto(r.name),
          ),
          ...perBranch(t('Preview merge into {branch}', { branch: cur }), others, (r) =>
            A.previewMerge(r.name),
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
    { label: t('Bisect'), items: bisectMenu(c.hash) },
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
    ...(many
      ? manyCommitItems(many, info?.status.head ?? null)
      : [
          // Like GitKraken, entries that cannot apply to this commit are left out, not greyed.
          ...(mine ? [] : [{ label: t('Cherry pick commit'), onSelect: () => A.cherryPick(c) }]),
          'sep' as const,
          {
            label: t('Drop commit'),
            danger: true,
            disabled: !mine,
            onSelect: () => A.dropCommit(c),
          },
          ...(mine && !isHeadCommit && !isMerge
            ? [{ label: t('Move commit up'), onSelect: () => A.moveCommit(c, false) }]
            : []),
          {
            label: t('Move commit down'),
            disabled: !mine || isMerge || c.parents.length === 0,
            onSelect: () => A.moveCommit(c, true),
          },
          ...(mine && !isMerge
            ? [
                {
                  label: t('Interactive rebase from here…'),
                  onSelect: () => A.interactiveRebase(c.hash),
                },
              ]
            : []),
        ]),
    'sep',
    ...(reqHost
      ? perBranch(
          locals.length === 1
            ? t(
                reqHost === 'github'
                  ? 'Start a pull request to {remote} from {branch}'
                  : 'Start a merge request to {remote} from {branch}',
                {
                  remote: A.prRemoteName() ?? 'origin',
                  branch: remoteOf(locals[0]!)?.name ?? locals[0]!.name,
                },
              )
            : reqHost === 'github'
              ? t('Start a pull request from…')
              : t('Start a merge request from…'),
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
    many
      ? {
          label: t('Copy commit shas'),
          onSelect: () => copyText(many.map((m) => m.hash).join('\n')),
        }
      : { label: t('Copy commit sha'), onSelect: () => copyText(c.hash) },
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
    many
      ? { label: t('Create patch from commits'), onSelect: () => A.createPatchFromCommits(many) }
      : { label: t('Create patch from commit'), onSelect: () => A.createPatch(c.hash) },
    'sep',
    ...viewItems(t('Pin to Left'), view.pinned, A.pinRef),
    ...viewItems(t('Solo'), view.solo, A.soloRef),
    ...viewItems(t('Hide'), view.hidden, A.hideRef),
    ...(view.solo.length || view.hidden.length
      ? [{ label: t('Show all branches'), onSelect: () => A.showAllRefs() }]
      : []),
    'sep',
    ...(many?.length === 2
      ? [
          {
            label: t('Compare the 2 selected commits'),
            onSelect: () =>
              A.compareCommits(A.commitSide(many[1]!.hash), A.commitSide(many[0]!.hash)),
          },
        ]
      : []),
    {
      label: t('Compare commit against working directory'),
      onSelect: () => A.compareWithWorkingDirectory(c.hash),
    },
    ...A.compareMenu(A.commitSide(c.hash)),
    'sep',
    { label: t('Create tag here'), onSelect: () => A.createTag(c.hash) },
    { label: t('Create annotated tag here'), onSelect: () => A.createAnnotatedTag(c.hash) },
  ]);
}

/**
 * What several picked commits (newest first) can do together: cherry-pick the ones not on the
 * current branch; squash, drop, move or rebase them when they all are.
 */
function manyCommitItems(many: Commit[], head: string | null): MenuItem[] {
  const n = many.length;
  const allMine = many.every((m) => onCurrentBranch(m.hash));
  const merges = many.some((m) => m.parents.length > 1);
  const toPick = many.filter((m) => !onCurrentBranch(m.hash));
  const rewrite = allMine && !merges;
  const oldest = many[n - 1]!;
  return [
    ...(toPick.length
      ? [
          {
            label:
              toPick.length === 1
                ? t('Cherry pick commit')
                : t('Cherry pick {n} commits', { n: toPick.length }),
            onSelect: () => A.cherryPickMany(toPick),
          },
        ]
      : []),
    'sep',
    ...(rewrite
      ? [{ label: t('Squash {n} commits', { n }), onSelect: () => A.squashCommits(many) }]
      : []),
    {
      label: t('Drop {n} commits', { n }),
      danger: true,
      disabled: !rewrite,
      onSelect: () => A.dropCommits(many),
    },
    ...(rewrite && !many.some((m) => m.hash === head)
      ? [{ label: t('Move {n} commits up', { n }), onSelect: () => A.moveCommits(many, false) }]
      : []),
    ...(rewrite && oldest.parents.length > 0
      ? [{ label: t('Move {n} commits down', { n }), onSelect: () => A.moveCommits(many, true) }]
      : []),
    ...(rewrite
      ? [
          {
            label: t('Interactive rebase from here…'),
            onSelect: () => A.interactiveRebase(oldest.hash),
          },
        ]
      : []),
  ];
}

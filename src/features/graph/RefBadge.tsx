import { Check, Cloud, Laptop, Tag } from 'lucide-react';

import { ContextMenuWrap, cn, type MenuItem } from '@/components/ui';
import { t } from '@/lib/i18n';
import { copyText } from '@/lib/native';
import type { GitRef } from '@/lib/types';
import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';
import * as A from '../actions';

/** Context-menu items for a branch or tag (shared by graph badges and the sidebar). */
export function refMenu(ref: GitRef): MenuItem[] {
  const info = useRepo.getState().info;
  const cur = info?.status.branch ?? null;
  const hasGitHub =
    useRepo.getState().refs?.remotes.some((r) => r.github) && !!useGitHub.getState().user;
  if (ref.kind === 'tag') {
    return [
      { label: t('Check out {name}', { name: ref.name }), onSelect: () => A.checkoutRef(ref) },
      { label: t('Create branch here'), onSelect: () => A.newBranch(ref.target, ref.name) },
      'sep',
      { label: t('Push {name} to remote', { name: ref.name }), onSelect: () => A.pushTag(ref) },
      { label: t('Copy tag name'), onSelect: () => copyText(ref.name) },
      'sep',
      {
        label: t('Delete {name}', { name: ref.name }),
        danger: true,
        onSelect: () => A.deleteTag(ref),
      },
    ];
  }
  const isCur = ref.kind === 'local' && ref.isHead;
  const items: MenuItem[] = [];
  if (!isCur)
    items.push({
      label: t('Check out {name}', { name: ref.name }),
      onSelect: () => A.checkoutRef(ref),
    });
  if (!isCur && cur) {
    items.push({
      label: t('Merge {source} into {target}', { source: ref.name, target: cur }),
      onSelect: () => A.mergeInto(ref.name),
    });
    items.push({
      label: t('Rebase {branch} onto {target}', { branch: cur, target: ref.name }),
      onSelect: () => A.rebaseOnto(ref.name),
    });
  }
  items.push('sep');
  if (isCur) {
    items.push({ label: t('Pull'), onSelect: () => A.pull() });
    items.push({ label: t('Push'), onSelect: () => A.push() });
  } else if (ref.kind === 'local') {
    items.push({
      label: t('Push {name}', { name: ref.name }),
      onSelect: () => A.push({ branch: ref.name }),
    });
  }
  if (ref.kind === 'local') {
    items.push({ label: t('Set upstream…'), onSelect: () => A.setUpstream(ref) });
    if (hasGitHub)
      items.push({
        label: t('Create pull request…'),
        onSelect: () => A.createPullRequest(ref.name),
      });
  }
  items.push('sep');
  items.push({ label: t('Create branch here'), onSelect: () => A.newBranch(ref.target, ref.name) });
  items.push({ label: t('Create tag here'), onSelect: () => A.createTag(ref.target, ref.name) });
  if (cur && !isCur)
    items.push({
      label: t('Reset {branch} to here', { branch: cur }),
      onSelect: () => A.resetTo(ref.target, ref.name),
    });
  items.push({ label: t('Copy branch name'), onSelect: () => copyText(ref.name) });
  if (A.branchUrl(ref))
    items.push({ label: t('Copy link to branch'), onSelect: () => A.copyBranchLink(ref) });
  items.push('sep');
  if (ref.kind === 'local') {
    items.push({ label: t('Rename…'), onSelect: () => A.renameBranch(ref) });
    items.push({
      label: t('Delete {name}', { name: ref.name }),
      danger: true,
      disabled: isCur,
      onSelect: () => A.deleteBranch(ref),
    });
  } else {
    items.push({
      label: t('Delete {name} on remote', { name: ref.name }),
      danger: true,
      onSelect: () => A.deleteBranch(ref),
    });
  }
  return items;
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
  return (
    <ContextMenuWrap items={() => refMenu(primary)} onOpenChange={onMenuOpenChange}>
      <span
        onDoubleClick={(e) => {
          e.stopPropagation();
          void A.checkoutRef(primary);
        }}
        title={group.refs.map((r) => r.name).join(', ')}
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
      </span>
    </ContextMenuWrap>
  );
}

// User-level Git actions shared by the toolbar, sidebar, graph and panels.

import { short } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { MenuItem } from '@/components/ui';
import { copyText, pickFile, pickFolder } from '@/lib/native';
import type { Commit, GitRef, Remote, Stash, Worktree } from '@/lib/types';
import { useCompare } from '@/stores/compare';
import { useGitHub } from '@/stores/github';
import { useRemotePanel } from '@/stores/remotePanel';
import { useRepo, type CompareSide } from '@/stores/repo';
import { ask, confirm, toast, type Field } from '@/stores/ui';
import { reaches } from './graph/menuUtils';

const repo = () => useRepo.getState();
const run = (...a: Parameters<ReturnType<typeof repo>['run']>) => repo().run(...a);

export const currentBranch = () => repo().info?.status.branch ?? null;

/** Where HEAD is now: branch name or detached commit. */
function headState() {
  const st = repo().info?.status;
  return { branch: st?.branch ?? null, head: st?.head ?? null };
}

function backTo(h: { branch: string | null; head: string | null }) {
  return (p: string) =>
    h.branch ? api.checkout(p, h.branch, 'branch') : api.checkout(p, h.head!, 'detached');
}

/** Run `fn`; when it succeeds, record an Undo entry built from HEAD before and after. */
async function journaled(
  label: string,
  fn: (p: string) => Promise<unknown>,
  inverse: (
    before: ReturnType<typeof headState>,
    after: ReturnType<typeof headState>,
  ) => { undo: (p: string) => Promise<unknown>; redo: (p: string) => Promise<unknown> } | null,
  success?: string,
) {
  const before = headState();
  const ok = await run(label, fn, success);
  if (!ok) return false;
  const e = inverse(before, headState());
  if (e) repo().record({ label: label.toLowerCase(), ...e });
  return true;
}

export async function commitChanges(message: string, amend: boolean) {
  return journaled(
    amend ? 'Amend' : 'Commit',
    (p) => api.commitChanges(p, message, amend),
    (b, a) =>
      b.head && a.head
        ? {
            undo: (p) => api.reset(p, b.head!, 'soft'),
            redo: (p) => api.reset(p, a.head!, 'soft'),
          }
        : null,
  );
}

export async function undo() {
  await repo().undo();
}

export async function redo() {
  await repo().redo();
}

export async function fetchAll() {
  await run('Fetch', (p) => api.fetch(p), t('Fetched all remotes'));
}

/** `remote`: pull from that remote instead of the branch's upstream. */
export async function pull(opts: { mode?: string; remote?: string } = {}) {
  const mode = opts.mode ?? repo().settings?.pullMode ?? 'merge';
  await run(
    'Pull',
    (p) => api.pull(p, mode, opts.remote),
    opts.remote ? t('Pulled from {name}', { name: opts.remote }) : t('Pulled'),
  );
}

/** Remote the current branch tracks (`origin` for `origin/main`), if any. */
export function upstreamRemote(): string | null {
  const r = repo();
  const up = r.info?.status.upstream;
  if (!up) return null;
  const names = (r.refs?.remotes ?? []).map((x) => x.name).sort((a, b) => b.length - a.length);
  return names.find((n) => up.startsWith(`${n}/`)) ?? null;
}

export async function push(opts: { branch?: string; remote?: string } = {}) {
  const r = repo();
  const path = r.path;
  if (!path) return;
  useRepo.setState({ busy: 'Push' });
  try {
    await api.push(path, opts);
    toast('success', t('Pushed'));
  } catch (e) {
    const msg = (e as Error).message;
    if (/rejected|non-fast-forward|fetch first/i.test(msg)) {
      useRepo.setState({ busy: null });
      const force = await confirm(
        t('Push rejected'),
        t(
          'The remote has commits you do not have. Pull first, or force push (with lease) to overwrite the remote branch.',
        ),
        t('Force push'),
        true,
      );
      if (force)
        await run('Force push', (p) => api.push(p, { ...opts, force: true }), t('Force pushed'));
      return;
    }
    toast('error', t('Push failed'), msg);
  } finally {
    useRepo.setState({ busy: null });
    await repo().refresh();
  }
}

/** `checkoutInitial`: whether "Check out after creating" starts ticked. Resolves to whether
 *  the branch was created. */
export async function newBranch(
  start?: string,
  startLabel?: string,
  checkoutInitial = true,
): Promise<boolean> {
  const v = await ask({
    title: t('Create branch'),
    description: start
      ? t('Starting at {ref}', { ref: startLabel ?? short(start) })
      : t('Starting at HEAD'),
    fields: [
      { name: 'name', label: t('Branch name'), placeholder: 'feature/my-change', required: true },
      {
        name: 'checkout',
        label: t('Check out after creating'),
        type: 'checkbox',
        initial: checkoutInitial,
      },
    ],
    confirmLabel: t('Create'),
  });
  if (!v) return false;
  const name = (v.name as string).trim();
  const checkout = v.checkout as boolean;
  return journaled(
    'Create branch',
    (p) => api.createBranch(p, name, start, checkout),
    (b) => {
      const target = repo().refs?.refs.find((r) => r.kind === 'local' && r.name === name)?.target;
      if (!target) return null;
      return {
        undo: async (p) => {
          if (checkout) await backTo(b)(p);
          await api.deleteBranch(p, name, true);
        },
        redo: (p) => api.createBranch(p, name, target, checkout),
      };
    },
    t('Created {name}', { name }),
  );
}

/** Select the checked-out commit in the graph (loading older pages when needed). */
export async function goToHead() {
  const head = repo().info?.status.head;
  if (head) await repo().reveal(head);
}

/**
 * Before HEAD leaves a detached commit: commits made there that no branch, tag or remote
 * branch holds would be left only in the reflog. Offers to create a branch first.
 * Resolves to `false` when the user cancels the checkout.
 */
async function leaveDetachedHead(): Promise<boolean> {
  const { branch, head } = headState();
  const path = repo().path;
  if (branch || !head || !path) return true;
  // A failed check must not block the checkout itself.
  const n = await api.unreferenced(path, head).catch(() => 0);
  if (n === 0) return true;
  const v = await ask({
    title: t('Commits not on any branch'),
    description: t(
      'HEAD is detached at {hash} and {n} commit(s) there are on no branch or tag. Once you switch away they can only be found in the reflog.',
      { hash: short(head), n },
    ),
    fields: [
      {
        name: 'action',
        label: t('Before switching'),
        type: 'select',
        initial: 'branch',
        options: [
          { value: 'branch', label: t('Create a branch at HEAD to keep them') },
          { value: 'leave', label: t('Switch anyway') },
        ],
      },
    ],
    confirmLabel: t('Continue'),
  });
  if (!v) return false;
  if (v.action === 'branch') return newBranch(head, 'HEAD', false);
  return true;
}

export async function checkoutRef(ref: GitRef) {
  if (ref.kind === 'local' && ref.isHead) return;
  if (!(await leaveDetachedHead())) return;
  if (ref.kind === 'local') {
    await journaled(
      'Checkout',
      (p) => api.checkout(p, ref.name, 'branch'),
      (b, a) => ({ undo: backTo(b), redo: backTo(a) }),
      t('Switched to {name}', { name: ref.name }),
    );
  } else if (ref.kind === 'remote') {
    await checkoutRemote(ref);
  } else {
    await checkoutCommit(ref.target, ref.name, false);
  }
}

/**
 * How a local branch relates to the remote branch of the same name: from its ahead/behind
 * counts when it tracks that branch, otherwise from the loaded graph (`unknown` when the
 * commits are not loaded).
 */
export function compareWithRemote(
  local: GitRef,
  remote: GitRef,
): 'same' | 'behind' | 'ahead' | 'diverged' | 'unknown' {
  if (local.target === remote.target) return 'same';
  if (local.upstream === remote.name) {
    if (local.behind > 0 && local.ahead === 0) return 'behind';
    if (local.ahead > 0 && local.behind === 0) return 'ahead';
    if (local.ahead > 0 && local.behind > 0) return 'diverged';
  }
  if (reaches(remote.target, local.target)) return 'behind';
  if (reaches(local.target, remote.target)) return 'ahead';
  const loaded = new Set(repo().commits.map((c) => c.hash));
  return loaded.has(local.target) && loaded.has(remote.target) ? 'diverged' : 'unknown';
}

/**
 * Check out a remote branch: as a new tracking branch, or as its local namesake. When the local
 * branch points elsewhere, ask what to do with it instead of quietly landing on another commit.
 */
async function checkoutRemote(ref: GitRef) {
  const name = ref.name.slice((ref.remote?.length ?? 0) + 1);
  const local = repo().refs?.refs.find((r) => r.kind === 'local' && r.name === name);
  const switchBack = (b: ReturnType<typeof headState>, a: ReturnType<typeof headState>) => ({
    undo: backTo(b),
    redo: backTo(a),
  });
  const rel = local ? compareWithRemote(local, ref) : 'same';
  if (rel === 'same' || rel === 'ahead') {
    const ok = await journaled(
      'Checkout',
      (p) => api.checkout(p, ref.name, 'remote'),
      switchBack,
      t('Switched to {name}', { name }),
    );
    if (ok && rel === 'ahead')
      toast(
        'info',
        t('{local} has commits that {remote} does not have yet', { local: name, remote: ref.name }),
      );
    return;
  }

  const vars = { local: name, remote: ref.name };
  const v = await ask({
    title: t('Check out {name}', { name: ref.name }),
    description:
      rel === 'behind'
        ? t('The local branch {local} is behind {remote}.', vars)
        : rel === 'diverged'
          ? t('The local branch {local} and {remote} have diverged.', vars)
          : t('The local branch {local} points to a different commit than {remote}.', vars),
    fields: [
      {
        name: 'mode',
        label: t('Local branch {local}', vars),
        type: 'select',
        initial: rel === 'behind' ? 'ff' : 'keep',
        options: [
          ...(rel === 'behind'
            ? [{ value: 'ff', label: t('Fast-forward {local} to {remote}', vars) }]
            : []),
          { value: 'keep', label: t('Check out {local} as it is', vars) },
          ...(rel !== 'behind'
            ? [
                {
                  value: 'reset',
                  label: t('Reset {local} to {remote} (drops its own commits)', vars),
                },
              ]
            : []),
        ],
      },
    ],
    confirmLabel: t('Check out'),
  });
  if (!v) return;
  if (v.mode === 'keep') {
    await journaled(
      'Checkout',
      (p) => api.checkout(p, name, 'branch'),
      switchBack,
      t('Switched to {name}', { name }),
    );
  } else if (v.mode === 'ff') {
    // The branch itself moves, which switching back cannot undo: no Undo entry.
    await run(
      'Checkout',
      async (p) => {
        await api.fastForward(p, name, ref.name);
        await api.checkout(p, name, 'branch');
      },
      t('Fast-forwarded {branch} to {target}', { branch: name, target: ref.name }),
    );
  } else {
    const ok = await confirm(
      t('Reset {local} to {remote}', vars),
      t(
        'Commits on {local} that are not on {remote} will be left only in the reflog. Uncommitted changes are kept.',
        vars,
      ),
      t('Reset and check out'),
      true,
    );
    if (ok)
      await run(
        'Checkout',
        (p) => api.checkout(p, ref.name, 'remoteReset'),
        t('Reset {local} to {remote}', vars),
      );
  }
}

/** `guard`: first warn about commits a detached HEAD would leave behind (callers that already
 *  did so pass `false`). */
export async function checkoutCommit(hash: string, label?: string, guard = true) {
  const ok = await confirm(
    t('Check out commit'),
    t(
      'This puts the repository in "detached HEAD" at {ref}. Create a branch if you want to keep new commits.',
      { ref: label ?? short(hash) },
    ),
    t('Check out'),
  );
  if (!ok) return;
  if (guard && !(await leaveDetachedHead())) return;
  await journaled(
    'Checkout',
    (p) => api.checkout(p, hash, 'detached'),
    (b, a) => ({ undo: backTo(b), redo: backTo(a) }),
  );
}

export async function deleteBranch(ref: GitRef, confirmFirst = true) {
  if (ref.kind === 'remote') {
    const remote = ref.remote!;
    const name = ref.name.slice(remote.length + 1);
    const ok = await confirm(
      t('Delete remote branch'),
      t('Delete {name} on {remote}? This affects everyone using the remote.', { name, remote }),
      t('Delete'),
      true,
    );
    if (ok)
      await run(
        'Delete remote branch',
        (p) => api.deleteRemoteBranch(p, remote, name),
        t('Deleted {name}', { name: ref.name }),
      );
    return;
  }
  const ok =
    !confirmFirst ||
    (await confirm(
      t('Delete branch'),
      t('Delete local branch {name}?', { name: ref.name }),
      t('Delete'),
      true,
    ));
  if (!ok) return;
  const path = repo().path!;
  const recordDelete = () =>
    repo().record({
      label: 'delete branch',
      undo: (p) => api.createBranch(p, ref.name, ref.target, false),
      redo: (p) => api.deleteBranch(p, ref.name, true),
    });
  try {
    await api.deleteBranch(path, ref.name, false);
    recordDelete();
    toast('success', t('Deleted {name}', { name: ref.name }));
  } catch (e) {
    const msg = (e as Error).message;
    if (/not fully merged/i.test(msg)) {
      const force = await confirm(
        t('Branch not merged'),
        t(
          '{name} has commits that are not merged anywhere. Delete it anyway? Those commits may be lost.',
          { name: ref.name },
        ),
        t('Force delete'),
        true,
      );
      if (
        force &&
        (await run(
          'Delete branch',
          (p) => api.deleteBranch(p, ref.name, true),
          t('Deleted {name}', { name: ref.name }),
        ))
      )
        recordDelete();
    } else toast('error', t('Delete branch failed'), msg);
  }
  await repo().refresh();
}

export async function renameBranch(ref: GitRef) {
  const v = await ask({
    title: t('Rename branch'),
    fields: [{ name: 'name', label: t('New name'), initial: ref.name, required: true }],
    confirmLabel: t('Rename'),
  });
  if (v)
    await run('Rename branch', (p) => api.renameBranch(p, ref.name, (v.name as string).trim()));
}

export async function setUpstream(ref: GitRef) {
  const remotes = (repo().refs?.refs ?? []).filter((r) => r.kind === 'remote');
  if (remotes.length === 0) {
    toast('info', t('No remote branches to track. Push the branch first.'));
    return;
  }
  const v = await ask({
    title: t('Set upstream for {name}', { name: ref.name }),
    fields: [
      {
        name: 'up',
        label: t('Upstream branch'),
        type: 'select',
        initial: ref.upstream ?? remotes[0]!.name,
        options: remotes.map((r) => ({ value: r.name, label: r.name })),
      },
    ],
  });
  if (v) await run('Set upstream', (p) => api.setUpstream(p, ref.name, v.up as string));
}

export async function mergeInto(target: string) {
  const cur = currentBranch() ?? 'HEAD';
  const v = await ask({
    title: t('Merge'),
    description: t('Merge {source} into {target}.', { source: target, target: cur }),
    fields: [
      {
        name: 'noFf',
        label: t('Always create a merge commit (--no-ff)'),
        type: 'checkbox',
        initial: false,
      },
    ],
    confirmLabel: t('Merge'),
  });
  if (!v) return;
  const ok = await run(
    'Merge',
    (p) => api.merge(p, target, v.noFf as boolean),
    t('Merged {name}', { name: target }),
  );
  if (ok) await showMergeResult(null);
}

/**
 * Select what a merge produced: the commit `branch` (or HEAD, for `null`) points to now — the
 * merge commit, or the tip it fast-forwarded to — instead of leaving the old row selected.
 */
export async function showMergeResult(branch: string | null) {
  const r = repo();
  const hash = branch
    ? r.refs?.refs.find((x) => x.kind === 'local' && x.name === branch)?.target
    : r.info?.status.head;
  if (hash) await r.reveal(hash);
}

/** The worktree (other than this one) that has `branch` checked out, if any. */
export function worktreeOf(branch: string): Worktree | null {
  return repo().worktrees.find((w) => w.branch === branch && !w.isCurrent) ?? null;
}

/**
 * Pull into a local branch: the checked-out one as usual, one checked out in another worktree
 * inside that worktree, any other by fetching its upstream and fast-forwarding to it.
 */
export async function pullBranch(ref: GitRef) {
  if (ref.isHead) return pull();
  const w = worktreeOf(ref.name);
  if (w) {
    const mode = repo().settings?.pullMode ?? 'merge';
    await run('Pull', () => api.pull(w.path, mode), t('Pulled {name}', { name: ref.name }));
    return;
  }
  const up = ref.upstream
    ? repo().refs?.refs.find((r) => r.kind === 'remote' && r.name === ref.upstream)
    : undefined;
  if (!up) {
    toast('info', t('{name} has no upstream. Set one first.', { name: ref.name }));
    return;
  }
  await run(
    'Pull',
    async (p) => {
      if (up.remote) await api.fetch(p, up.remote);
      await api.fastForward(p, ref.name, up.name);
    },
    t('Pulled {name}', { name: ref.name }),
  );
}

/** Move local `branch` forward to `target` (refused unless it is a fast-forward). */
export async function fastForwardBranch(branch: string, target: string) {
  await run(
    'Fast-forward',
    (p) => api.fastForward(p, branch, target),
    t('Fast-forwarded {branch} to {target}', { branch, target }),
  );
}

/**
 * Merge `source` into a local branch that is not checked out here: inside the worktree that
 * has it checked out, otherwise by checking it out first.
 */
export async function mergeIntoBranch(source: string, target: GitRef) {
  const w = worktreeOf(target.name);
  const v = await ask({
    title: t('Merge'),
    description: w
      ? t('Merge {source} into {target} (in the worktree {path}).', {
          source,
          target: target.name,
          path: w.path,
        })
      : t('Check out {target}, then merge {source} into it.', { source, target: target.name }),
    fields: [
      {
        name: 'noFf',
        label: t('Always create a merge commit (--no-ff)'),
        type: 'checkbox',
        initial: false,
      },
    ],
    confirmLabel: t('Merge'),
  });
  if (!v) return;
  const noFf = v.noFf as boolean;
  const ok = w
    ? await run(
        'Merge',
        () => api.merge(w.path, source, noFf),
        t('Merged {source} into {target}', { source, target: target.name }),
      )
    : await run(
        'Merge',
        async (p) => {
          await api.checkout(p, target.name, 'branch');
          await api.merge(p, source, noFf);
        },
        t('Merged {source} into {target}', { source, target: target.name }),
      );
  if (ok) await showMergeResult(target.name);
}

export async function rebaseOnto(target: string) {
  const cur = currentBranch() ?? 'HEAD';
  const ok = await confirm(
    t('Rebase'),
    t('Rebase {branch} onto {target}? Commits of {branch} are rewritten.', { branch: cur, target }),
    t('Rebase'),
  );
  if (ok)
    await run('Rebase', (p) => api.rebase(p, target), t('Rebased onto {name}', { name: target }));
}

export async function cherryPick(c: Commit) {
  await run(
    'Cherry-pick',
    (p) => api.cherryPick(p, c.hash, c.parents.length > 1),
    t('Cherry-picked {hash}', { hash: short(c.hash) }),
  );
}

/** Cherry-pick a commit known only by its hash (e.g. one from the reflog, not in the graph). */
export async function cherryPickHash(hash: string) {
  const path = repo().path;
  if (!path) return;
  const c =
    repo().commits.find((x) => x.hash === hash) ??
    (await api.commit(path, hash).catch((e: Error) => {
      toast('error', t('Could not load commit'), e.message);
      return null;
    }));
  if (c) await cherryPick(c);
}

export async function revertCommit(c: Commit) {
  await run(
    'Revert',
    (p) => api.revert(p, c.hash, c.parents.length > 1),
    t('Reverted {hash}', { hash: short(c.hash) }),
  );
}

export async function resetTo(hash: string, label?: string) {
  const v = await ask({
    title: t('Reset {branch} to {ref}', {
      branch: currentBranch() ?? 'HEAD',
      ref: label ?? short(hash),
    }),
    fields: [
      {
        name: 'mode',
        label: t('Mode'),
        type: 'select',
        initial: 'mixed',
        options: [
          { value: 'soft', label: t('Soft — keep changes staged') },
          { value: 'mixed', label: t('Mixed — keep changes in working tree') },
          { value: 'hard', label: t('Hard — discard all changes') },
        ],
      },
    ],
    confirmLabel: t('Reset'),
    danger: true,
  });
  if (!v) return;
  await resetWithMode(hash, v.mode as ResetMode);
}

export type ResetMode = 'soft' | 'mixed' | 'hard';

/** Reset the current branch to `hash` with a known mode (hard asks first). Undoable. */
export async function resetWithMode(hash: string, mode: ResetMode) {
  if (
    mode === 'hard' &&
    !(await confirm(
      t('Hard reset'),
      t('Uncommitted changes will be lost. Continue?'),
      t('Hard reset'),
      true,
    ))
  )
    return;
  await journaled(
    'Reset',
    (p) => api.reset(p, hash, mode),
    (b, a) =>
      b.head && a.head
        ? {
            // Moving back with --soft keeps whatever the reset left in the working tree.
            undo: (p) => api.reset(p, b.head!, mode === 'hard' ? 'hard' : 'soft'),
            redo: (p) => api.reset(p, a.head!, mode),
          }
        : null,
  );
}

/** Create a tag at `target`; `annotated` makes the message required. */
export async function createTag(target: string, label?: string, annotated = false) {
  const v = await ask({
    title: annotated ? t('Create annotated tag') : t('Create tag'),
    description: t('At {ref}', { ref: label ?? short(target) }),
    fields: [
      { name: 'name', label: t('Tag name'), placeholder: 'v1.0.0', required: true },
      annotated
        ? { name: 'message', label: t('Message'), type: 'textarea', required: true }
        : { name: 'message', label: t('Message (makes an annotated tag)'), type: 'textarea' },
      { name: 'push', label: t('Push to origin'), type: 'checkbox', initial: false },
    ],
    confirmLabel: t('Create'),
  });
  if (!v) return;
  const name = (v.name as string).trim();
  const ok = await run(
    'Create tag',
    (p) => api.createTag(p, name, target, v.message as string),
    t('Tagged {name}', { name }),
  );
  if (ok && v.push)
    await run('Push tag', (p) => api.push(p, { tag: name }), t('Pushed {name}', { name }));
}

export async function deleteTag(ref: GitRef) {
  const remote = repo().refs?.remotes[0]?.name;
  const v = await ask({
    title: t('Delete tag {name}', { name: ref.name }),
    fields: remote
      ? [
          {
            name: 'remote',
            label: t('Also delete on {remote}', { remote }),
            type: 'checkbox',
            initial: false,
          },
        ]
      : [],
    confirmLabel: t('Delete'),
    danger: true,
  });
  if (!v) return;
  await run(
    'Delete tag',
    (p) => api.deleteTag(p, ref.name),
    t('Deleted {name}', { name: ref.name }),
  );
  if (v.remote && remote)
    await run('Delete remote tag', (p) =>
      api.deleteRemoteBranch(p, remote, `refs/tags/${ref.name}`),
    );
}

export async function pushTag(ref: GitRef) {
  await run(
    'Push tag',
    (p) => api.push(p, { tag: ref.name }),
    t('Pushed {name}', { name: ref.name }),
  );
}

export async function stash() {
  const v = await ask({
    title: t('Stash changes'),
    fields: [
      { name: 'message', label: t('Message (optional)') },
      { name: 'untracked', label: t('Include untracked files'), type: 'checkbox', initial: true },
    ],
    confirmLabel: t('Stash'),
  });
  if (v)
    await run(
      'Stash',
      (p) => api.stashSave(p, v.message as string, v.untracked as boolean),
      t('Changes stashed'),
    );
}

export async function stashOp(s: Stash, op: 'apply' | 'pop' | 'drop') {
  if (
    op === 'drop' &&
    !(await confirm(
      t('Drop stash'),
      t('Delete {name} ({message})?', { name: s.name, message: s.message }),
      t('Drop'),
      true,
    ))
  )
    return;
  const label = op === 'apply' ? 'Apply stash' : op === 'pop' ? 'Pop stash' : 'Drop stash';
  await run(label, (p) => api.stashOp(p, op, s.index));
}

/** Stash the staged files with a title and description (the WIP panel's Stash tab). */
export async function stashStaged(title: string, description: string) {
  const message = [title.trim(), description.trim()].filter(Boolean).join('\n\n');
  return run(
    'Stash',
    (p) => api.stashSave(p, message || undefined, false, true),
    t('Staged changes stashed'),
  );
}

/** Edit a stash's message (its place in the list is kept). */
export async function editStashMessage(s: Stash) {
  const current = s.message.replace(/^(?:WIP on|On) [^:]+: /, '');
  const v = await ask({
    title: t('Edit stash message'),
    fields: [{ name: 'message', label: t('Message'), initial: current, required: true }],
    confirmLabel: t('Save'),
  });
  if (!v || (v.message as string).trim() === current) return;
  await run('Edit stash message', (p) => api.stashRename(p, s.index, (v.message as string).trim()));
}

/** Hide a stash from the graph (it stays in the sidebar list). */
export function hideStash(s: Stash) {
  const v = repo().view;
  void repo().setView({ ...v, hiddenStashes: [...v.hiddenStashes, s.hash] });
}

export async function popLatest() {
  const s = repo().refs?.stashes[0];
  if (!s) {
    toast('info', t('No stashes'));
    return;
  }
  await stashOp(s, 'pop');
}

/** Open the Add Remote panel (URL / GitHub / GitLab). */
export function addRemote(source: 'url' | 'github' | 'gitlab' = 'url') {
  useRemotePanel.getState().openAdd(source);
}

/** Open the remote panel to rename it or change its fetch / push URLs. */
export function editRemote(name: string) {
  useRemotePanel.getState().openEdit(name);
}

/** Add `name` → `url` (and a separate push URL when given), then fetch it. */
export async function createRemote(name: string, url: string, pushUrl = '') {
  const ok = await run(
    'Add remote',
    async (p) => {
      await api.addRemote(p, name, url);
      if (pushUrl && pushUrl !== url) await api.setRemoteUrl(p, name, pushUrl, true);
    },
    t('Added {name}', { name }),
  );
  if (ok) await run('Fetch', (p) => api.fetch(p, name));
  return ok;
}

/** Apply edits from the remote panel: rename, fetch URL, push URL (empty = same as fetch). */
export async function updateRemote(
  r: Remote,
  next: { name: string; url: string; pushUrl: string },
) {
  const pushUrl = next.pushUrl || next.url;
  const oldPush = r.pushUrl || r.url;
  if (next.name === r.name && next.url === r.url && pushUrl === oldPush) return true;
  return run(
    'Edit remote',
    async (p) => {
      if (next.name !== r.name) await api.renameRemote(p, r.name, next.name);
      if (next.url !== r.url) await api.setRemoteUrl(p, next.name, next.url);
      // `set-url` leaves an explicit pushurl alone; keep it in step with what was asked.
      if (pushUrl !== oldPush || next.url !== r.url)
        await api.setRemoteUrl(p, next.name, pushUrl, true);
    },
    t('Remote {name} updated', { name: next.name }),
  );
}

export async function removeRemote(name: string) {
  if (
    await confirm(
      t('Remove remote'),
      t('Remove remote {name} and its remote-tracking branches?', { name }),
      t('Remove'),
      true,
    )
  )
    await run('Remove remote', (p) => api.removeRemote(p, name));
}

export async function abortOp() {
  if (
    await confirm(
      t('Abort'),
      t('Abort the operation in progress and return to the previous state?'),
      t('Abort'),
      true,
    )
  )
    await run('Abort', (p) => api.abort(p));
}

export async function continueOp() {
  await run('Continue', (p) => api.continueOp(p));
}

/** Open a GitHub pull request from `branch` (default: current) to the default branch. */
export async function createPullRequest(branch?: string) {
  const r = repo();
  const head = branch ?? currentBranch();
  const remote =
    r.refs?.remotes.find((x) => x.name === 'origin' && x.github) ??
    r.refs?.remotes.find((x) => x.github);
  if (!remote?.github) {
    toast('info', t('This repository has no GitHub remote'));
    return;
  }
  if (!useGitHub.getState().user) {
    toast('info', t('Sign in to GitHub first'));
    return;
  }
  if (!head) return;
  const local = r.refs?.refs.find((x) => x.kind === 'local' && x.name === head);
  if (local && !local.upstream) {
    if (
      !(await confirm(
        t('Push branch first'),
        t('{branch} is not on GitHub yet. Push it to {remote} now?', {
          branch: head,
          remote: remote.name,
        }),
        t('Push'),
      ))
    )
      return;
    await push({ branch: head, remote: remote.name });
  }
  const remoteBranches = (r.refs?.refs ?? [])
    .filter((x) => x.kind === 'remote' && x.remote === remote.name && !x.name.endsWith('/HEAD'))
    .map((x) => x.name.slice(remote.name.length + 1))
    .filter((n) => n !== head);
  const base =
    ['main', 'master', 'develop'].find((b) => remoteBranches.includes(b)) ??
    remoteBranches[0] ??
    'main';
  const subject = r.commits.find((c) => c.hash === local?.target)?.subject ?? head;
  const v = await ask({
    title: t('Create pull request'),
    description: t('{repo}: {head} → base', {
      repo: `${remote.github.owner}/${remote.github.repo}`,
      head,
    }),
    fields: [
      {
        name: 'base',
        label: t('Base branch'),
        type: 'select',
        initial: base,
        options: (remoteBranches.length ? remoteBranches : [base]).map((b) => ({
          value: b,
          label: b,
        })),
      },
      { name: 'title', label: t('Title'), initial: subject, required: true },
      { name: 'body', label: t('Description'), type: 'textarea' },
      { name: 'draft', label: t('Create as draft'), type: 'checkbox', initial: false },
    ],
    confirmLabel: t('Create pull request'),
  });
  if (!v) return;
  try {
    const pr = await api.ghCreatePull({
      owner: remote.github.owner,
      repo: remote.github.repo,
      title: v.title as string,
      body: v.body as string,
      head,
      base: v.base as string,
      draft: v.draft as boolean,
    });
    toast('success', t('Opened pull request #{n}', { n: pr.number }), pr.htmlUrl);
    void useGitHub.getState().loadPulls(remote.github);
  } catch (e) {
    toast('error', t('Could not create pull request'), (e as Error).message);
  }
}

// ---- GitHub remotes -----------------------------------------------------------------------------

const preferSsh = () => repo().settings?.preferSsh ?? false;

/** Add a remote pointing at one of your GitHub repositories (e.g. a fork or upstream). */
export function addRemoteFromGitHub() {
  addRemote('github');
}

/** Create a repository on GitHub, add it as `origin` and push the current branch. */
export async function publishToGitHub() {
  const gh = useGitHub.getState();
  if (!gh.user) {
    toast('info', t('Connect GitHub first (Preferences → Integrations)'));
    return;
  }
  const info = repo().info;
  if (!info) return;
  if (repo().refs?.remotes.some((r) => r.name === 'origin')) {
    toast('info', t('This repository already has an origin remote'));
    return;
  }
  const v = await ask({
    title: t('Publish to GitHub'),
    description: t('Creates a repository under @{login}, adds it as origin and pushes {branch}.', {
      login: gh.user.login,
      branch: info.status.branch ?? 'HEAD',
    }),
    fields: [
      { name: 'name', label: t('Repository name'), initial: info.name, required: true },
      { name: 'description', label: t('Description (optional)') },
      { name: 'private', label: t('Private repository'), type: 'checkbox', initial: true },
      {
        name: 'ssh',
        label: t('Use SSH URL for the remote'),
        type: 'checkbox',
        initial: preferSsh(),
      },
    ],
    confirmLabel: t('Publish'),
  });
  if (!v) return;
  try {
    useRepo.setState({ busy: 'Publish' });
    const created = await api.ghCreateRepo(
      (v.name as string).trim(),
      v.description as string,
      v.private as boolean,
    );
    const path = repo().path!;
    await api.addRemote(path, 'origin', v.ssh ? created.sshUrl : created.cloneUrl);
    useRepo.setState({ busy: null });
    if (info.status.head) await push({ remote: 'origin' });
    toast('success', t('Published to {name}', { name: created.fullName }), created.htmlUrl);
  } catch (e) {
    toast('error', t('Publish failed'), (e as Error).message);
  } finally {
    useRepo.setState({ busy: null });
    await repo().refresh();
  }
}

/** Switch a GitHub remote between its HTTPS and SSH URL. */
export async function switchRemoteProtocol(name: string) {
  const r = repo().refs?.remotes.find((x) => x.name === name);
  if (!r?.github) return;
  const { owner, repo: rn } = r.github;
  const toSsh = r.url.startsWith('http');
  const url = toSsh ? `git@github.com:${owner}/${rn}.git` : `https://github.com/${owner}/${rn}.git`;
  await run(
    'Change remote URL',
    (p) => api.setRemoteUrl(p, name, url),
    t('{name} now uses {protocol}', { name, protocol: toSsh ? 'SSH' : 'HTTPS' }),
  );
}

// ---- commit history -----------------------------------------------------------------------------

/** Change the message of `hash` (rewrites it and every commit after it on the current branch). */
export async function editCommitMessage(hash: string) {
  const path = repo().path;
  if (!path) return;
  let message: string;
  try {
    message = (await api.commit(path, hash)).body;
  } catch (e) {
    toast('error', t('Could not load commit'), (e as Error).message);
    return;
  }
  const v = await ask({
    title: t('Edit commit message'),
    description: t(
      'Rewrites {hash} and the commits after it. Avoid this on commits you already pushed.',
      { hash: short(hash) },
    ),
    fields: [
      { name: 'message', label: t('Message'), type: 'textarea', initial: message, required: true },
    ],
    confirmLabel: t('Save'),
  });
  if (!v) return;
  const next = (v.message as string).trim();
  if (next === message.trim()) return;
  await run('Edit commit message', (p) => api.reword(p, hash, next), t('Commit message updated'));
}

/**
 * Whether the commit panel lets `hash` be edited in place: it is the tip of the checked-out
 * branch and no merge/rebase is in progress.
 */
export function canAmendMessage(hash: string): boolean {
  const info = repo().info;
  return (
    !!info &&
    info.state === 'clean' &&
    !!info.status.branch &&
    !!info.status.head &&
    info.status.head === hash
  );
}

/** HEAD is already on its upstream (nothing ahead), so amending it rewrites pushed history. */
export function headIsPushed(): boolean {
  const st = repo().info?.status;
  return !!st?.upstream && !!st.head && st.ahead === 0;
}

/**
 * Replace the message of HEAD (`hash`) only — staged and working-tree changes stay out — then
 * select the rewritten commit. Asks first when HEAD was already pushed. Returns whether the
 * message was changed.
 */
export async function amendHeadMessage(hash: string, message: string): Promise<boolean> {
  const next = message.trim();
  if (!next) return false;
  // The upstream check covers the usual case; a branch pushed without tracking (or HEAD already
  // on another remote branch) only shows up by asking which remote branches contain it.
  let upstream = headIsPushed() ? (repo().info?.status.upstream ?? '') : '';
  const path = repo().path;
  if (!upstream && path) {
    try {
      upstream = (await api.remotesContaining(path, hash))[0] ?? '';
    } catch {
      /* can't tell: fall through without the warning, as before */
    }
  }
  if (upstream) {
    const ok = await confirm(
      t('Amend a pushed commit?'),
      t(
        '{hash} is already on {upstream}. Amending rewrites it, so the branch will need a force push afterwards.',
        { hash: short(hash), upstream },
      ),
      t('Update Message'),
      true,
    );
    if (!ok) return false;
  }
  let created: string | null = null;
  const ok = await journaled(
    'Edit commit message',
    async (p) => {
      created = await api.amendMessage(p, hash, next);
    },
    // Moving the branch with a soft reset leaves staged and working-tree changes untouched.
    (b, a) =>
      b.head && a.head
        ? {
            undo: (p) => api.reset(p, b.head!, 'soft'),
            redo: (p) => api.reset(p, a.head!, 'soft'),
          }
        : null,
    t('Commit message updated'),
  );
  if (ok && created) await repo().reveal(created);
  return ok;
}

export async function dropCommit(c: Commit) {
  const ok = await confirm(
    t('Drop commit'),
    t(
      'Remove {hash} "{subject}" from the branch? This rewrites history: the commits after it are recreated and the changes it made are discarded from the branch.',
      { hash: short(c.hash), subject: c.subject },
    ),
    t('Drop commit'),
    true,
  );
  if (ok)
    await run(
      'Drop commit',
      (p) => api.dropCommit(p, c.hash),
      t('Dropped {hash}', { hash: short(c.hash) }),
    );
}

/** Swap a commit with the one before it (`down`) or after it on the current branch. */
export async function moveCommit(c: Commit, down: boolean) {
  await journaled(
    down ? 'Move commit down' : 'Move commit up',
    (p) => api.moveCommit(p, c.hash, down),
    // Undo/redo move the branch between the two histories (changes are autostashed).
    (b, a) =>
      b.head && a.head
        ? {
            undo: (p) => api.reset(p, b.head!, 'keep'),
            redo: (p) => api.reset(p, a.head!, 'keep'),
          }
        : null,
    down
      ? t('Moved {hash} down', { hash: short(c.hash) })
      : t('Moved {hash} up', { hash: short(c.hash) }),
  );
}

// ---- graph view: solo / hide / pin to left --------------------------------------------------------

const view = () => repo().view;
const without = (list: string[], x: string) => list.filter((y) => y !== x);

/** Show only this ref's history (toggles; several refs can be soloed together). */
export function soloRef(ref: GitRef) {
  const v = view();
  const solo = v.solo.includes(ref.fullName)
    ? without(v.solo, ref.fullName)
    : [...v.solo, ref.fullName];
  void repo().setView({ ...v, solo, hidden: [] });
}

/** Hide this ref from the graph (toggles). */
export function hideRef(ref: GitRef) {
  const v = view();
  const hidden = v.hidden.includes(ref.fullName)
    ? without(v.hidden, ref.fullName)
    : [...v.hidden, ref.fullName];
  void repo().setView({ ...v, hidden, solo: [] });
}

/** Keep this branch in the leftmost lanes of the graph (toggles). */
export function pinRef(ref: GitRef) {
  const v = view();
  const pinned = v.pinned.includes(ref.fullName)
    ? without(v.pinned, ref.fullName)
    : [...v.pinned, ref.fullName];
  void repo().setView({ ...v, pinned });
}

export function showAllRefs() {
  void repo().setView({ ...view(), solo: [], hidden: [], hiddenStashes: [] });
}

export function unpinAll() {
  void repo().setView({ ...view(), pinned: [] });
}

/** Delete a local branch and its remote branch in one go. */
export async function deleteBranchAndRemote(local: GitRef, remote: GitRef) {
  const remoteName = remote.remote!;
  const remoteBranch = remote.name.slice(remoteName.length + 1);
  const ok = await confirm(
    t('Delete branch'),
    t('Delete local branch {name} and {remote}? This affects everyone using the remote.', {
      name: local.name,
      remote: remote.name,
    }),
    t('Delete'),
    true,
  );
  if (!ok) return;
  const path = repo().path!;
  try {
    await api.deleteBranch(path, local.name, false);
  } catch (e) {
    const msg = (e as Error).message;
    if (!/not fully merged/i.test(msg)) {
      toast('error', t('Delete branch failed'), msg);
      await repo().refresh();
      return;
    }
    const force = await confirm(
      t('Branch not merged'),
      t(
        '{name} has commits that are not merged anywhere. Delete it anyway? Those commits may be lost.',
        { name: local.name },
      ),
      t('Force delete'),
      true,
    );
    if (!force || !(await run('Delete branch', (p) => api.deleteBranch(p, local.name, true))))
      return;
  }
  await run(
    'Delete remote branch',
    (p) => api.deleteRemoteBranch(p, remoteName, remoteBranch),
    t('Deleted {name} and {remote}', { name: local.name, remote: remote.name }),
  );
}

export async function createAnnotatedTag(target: string, label?: string) {
  await createTag(target, label, true);
}

// ---- patches ------------------------------------------------------------------------------------

const sepOf = (p: string) => (p.includes('\\') ? '\\' : '/');
const joinPath = (dir: string, name: string) =>
  dir.replace(/[\\/]+$/, '') + sepOf(dir) + name.replace(/^[\\/]+/, '');
const parentDir = (p: string) => p.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '');
export const baseName = (p: string) => p.replace(/[\\/]+$/, '').replace(/^.*[\\/]/, '');

export async function applyPatchFile() {
  const file = await pickFile(t('Choose a patch file'), repo().path ?? undefined);
  if (!file) return;
  await run('Apply patch', (p) => api.applyPatchFile(p, file), t('Patch applied'));
}

export async function createPatch(hash: string) {
  const path = repo().path;
  if (!path) return;
  const v = await ask({
    title: t('Create patch from commit'),
    description: t('Saves {hash} as a patch file (git format-patch).', { hash: short(hash) }),
    fields: [
      {
        name: 'dest',
        label: t('Save to'),
        initial: joinPath(path, `${short(hash)}.patch`),
        required: true,
      },
    ],
    confirmLabel: t('Save'),
  });
  if (!v) return;
  const dest = (v.dest as string).trim();
  if (await run('Create patch', (p) => api.createPatch(p, hash, dest)))
    toast('success', t('Patch saved'), dest);
}

// ---- links to the remote's web page -------------------------------------------------------------

interface WebRepo {
  host: 'github' | 'gitlab';
  base: string;
}

/** `https://gitlab.com/group/repo` from an https, ssh:// or scp-style gitlab.com remote URL. */
function gitlabBase(url: string): string | null {
  const m =
    /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/]+@)gitlab\.com(?::\d+)?[:/](.+?)(?:\.git)?\/?$/i.exec(
      url.trim(),
    );
  return m ? `https://gitlab.com/${m[1]}` : null;
}

function webRepo(r: Remote | undefined): WebRepo | null {
  if (!r) return null;
  if (r.github)
    return { host: 'github', base: `https://github.com/${r.github.owner}/${r.github.repo}` };
  const gl = gitlabBase(r.url);
  return gl ? { host: 'gitlab', base: gl } : null;
}

/** The web page of `remote` (default: origin, then the first remote on GitHub or GitLab). */
function remoteWeb(remote?: string | null): WebRepo | null {
  const remotes = repo().refs?.remotes ?? [];
  if (remote) return webRepo(remotes.find((r) => r.name === remote));
  return (
    webRepo(remotes.find((r) => r.name === 'origin')) ??
    remotes.map(webRepo).find((w) => w !== null) ??
    null
  );
}

export const hasWebRemote = () => remoteWeb() !== null;

/** Name of the remote used for web links (origin, else the first GitHub / GitLab remote). */
export function webRemoteName(): string | null {
  const remotes = repo().refs?.remotes ?? [];
  const origin = remotes.find((r) => r.name === 'origin');
  if (webRepo(origin)) return 'origin';
  return remotes.find((r) => webRepo(r) !== null)?.name ?? null;
}

/** Remote that pull requests are opened on (origin on GitHub, else any GitHub remote). */
export function prRemoteName(): string | null {
  const remotes = repo().refs?.remotes ?? [];
  return (
    remotes.find((x) => x.name === 'origin' && x.github)?.name ??
    remotes.find((x) => x.github)?.name ??
    null
  );
}

export function commitUrl(hash: string): string | null {
  const w = remoteWeb();
  if (!w) return null;
  return w.host === 'github' ? `${w.base}/commit/${hash}` : `${w.base}/-/commit/${hash}`;
}

/** Web URL of a branch: a remote branch on its remote, a local one on its upstream's remote. */
export function branchUrl(ref: GitRef): string | null {
  let remote: string | null = null;
  let name = ref.name;
  if (ref.kind === 'remote' && ref.remote) {
    remote = ref.remote;
    name = ref.name.slice(ref.remote.length + 1);
  } else if (ref.upstream) {
    const up = repo().refs?.refs.find((r) => r.kind === 'remote' && r.name === ref.upstream);
    if (up?.remote) {
      remote = up.remote;
      name = up.name.slice(up.remote.length + 1);
    }
  }
  const w = remote ? remoteWeb(remote) : remoteWeb();
  if (!w) return null;
  const path = name.split('/').map(encodeURIComponent).join('/');
  return w.host === 'github' ? `${w.base}/tree/${path}` : `${w.base}/-/tree/${path}`;
}

async function copyLink(url: string | null) {
  if (!url) {
    toast('info', t('No GitHub or GitLab remote to link to'));
    return;
  }
  await copyText(url);
  toast('success', t('Link copied'), url);
}

export const copyCommitLink = (hash: string) => copyLink(commitUrl(hash));
export const copyBranchLink = (ref: GitRef) => copyLink(branchUrl(ref));

// ---- compare ------------------------------------------------------------------------------------

/** Select `hash` and list how the working directory differs from it. */
export async function compareWithWorkingDirectory(hash: string) {
  await repo().select({ type: 'commit', hash });
  await useCompare.getState().start(hash);
}

/** A commit as one end of a comparison. */
export const commitSide = (hash: string): CompareSide => ({ rev: hash, label: short(hash), hash });

/** A branch or tag as one end of a comparison (compared by name, so it follows the ref). */
export const refSide = (ref: GitRef): CompareSide => ({
  rev: ref.fullName,
  label: ref.name,
  hash: ref.target,
});

/** HEAD as one end: the current branch by name, or the detached commit. */
export function headSide(): CompareSide | null {
  const st = repo().info?.status;
  if (!st?.head) return null;
  return st.branch ? { rev: 'HEAD', label: st.branch, hash: st.head } : commitSide(st.head);
}

/** Show what changes from `base` to `target` in the right panel. */
export async function compareCommits(base: CompareSide, target: CompareSide) {
  await repo().select({ type: 'compare', base, target });
}

/** Remember `side` as the start of the next "Compare … with this" from a commit or ref menu. */
export function markCompareBase(side: CompareSide) {
  useCompare.getState().markBase(side);
  toast(
    'info',
    t('{name} marked as compare base', { name: side.label }),
    t('Right-click another commit or branch and choose Compare.'),
  );
}

/** Compare entries for a commit or ref menu: with HEAD, with the marked base, mark as base. */
export function compareMenu(side: CompareSide): MenuItem[] {
  const head = headSide();
  const base = useCompare.getState().base;
  return [
    ...(head && head.hash !== side.hash
      ? [
          {
            label: t('Compare {base} → {target}', { base: head.label, target: side.label }),
            onSelect: () => compareCommits(head, side),
          },
        ]
      : []),
    ...(base && base.rev !== side.rev
      ? [
          {
            label: t('Compare {base} → {target}', { base: base.label, target: side.label }),
            onSelect: () => compareCommits(base, side),
          },
        ]
      : []),
    { label: t('Mark as compare base'), onSelect: () => markCompareBase(side) },
  ];
}

// ---- worktrees ----------------------------------------------------------------------------------

/** `<parent of repo>/<repo>-<branch>`: the usual sibling folder for a new worktree. */
function defaultWorktreePath(branch: string) {
  const path = repo().path ?? '';
  const slug = branch.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'worktree';
  return joinPath(parentDir(path), `${baseName(path)}-${slug}`);
}

const NEW_BRANCH = '\u0000new';

/**
 * Add a worktree. With `branch` it checks out that existing branch; with `start` it creates a
 * new branch at that commit; with neither it asks which branch to use.
 */
export async function addWorktree(opts: { branch?: string; start?: string } = {}) {
  const r = repo();
  if (!r.path) return;
  const locals = (r.refs?.refs ?? []).filter((x) => x.kind === 'local');
  const pathField: Field = {
    name: 'path',
    label: t('Folder'),
    initial: opts.branch ? defaultWorktreePath(opts.branch) : '',
    placeholder: opts.branch ? undefined : defaultWorktreePath('<branch>'),
    help: t('A new folder; leave empty to use the suggested one.'),
  };
  const browseField: Field = {
    name: 'browse',
    label: t('Choose the parent folder in a dialog'),
    type: 'checkbox',
    initial: false,
    help: t('The worktree folder is created inside the folder you pick.'),
  };
  const newBranchField: Field = {
    name: 'newBranch',
    label: t('New branch name'),
    placeholder: 'feature/my-change',
    required: !!opts.start,
    help: opts.start ? undefined : t('Only used for a new branch.'),
  };
  const fields: Field[] = opts.branch
    ? [pathField, browseField]
    : opts.start
      ? [newBranchField, pathField, browseField]
      : [
          {
            name: 'base',
            label: t('Branch'),
            type: 'select',
            initial: NEW_BRANCH,
            options: [
              { value: NEW_BRANCH, label: t('New branch from HEAD') },
              ...locals.filter((x) => !x.isHead).map((x) => ({ value: x.name, label: x.name })),
            ],
          },
          newBranchField,
          pathField,
          browseField,
        ];
  const v = await ask({
    title: t('Create worktree'),
    description: opts.branch
      ? t('Checks out {name} in a separate folder.', { name: opts.branch })
      : opts.start
        ? t('Creates a new branch at {ref} and checks it out in a separate folder.', {
            ref: short(opts.start),
          })
        : t('Checks out a branch in a separate folder, so you can work on two branches at once.'),
    fields,
    confirmLabel: t('Create worktree'),
  });
  if (!v) return;
  let branch = opts.branch;
  let newBranch: string | undefined;
  if (!opts.branch) {
    if (opts.start || v.base === NEW_BRANCH) {
      newBranch = ((v.newBranch as string) ?? '').trim();
      if (!newBranch) {
        toast('error', t('Enter a name for the new branch'));
        return;
      }
      // Start point of the new branch (HEAD when undefined).
      branch = opts.start;
    } else branch = v.base as string;
  }
  let path = ((v.path as string) ?? '').trim() || defaultWorktreePath(newBranch ?? branch ?? '');
  if (v.browse) {
    const dir = await pickFolder(t('Choose the parent folder for the worktree'), parentDir(path));
    if (!dir) return;
    path = joinPath(dir, baseName(path));
  }
  const ok = await run(
    'Create worktree',
    (p) => api.addWorktree(p, { path, branch, newBranch }),
    t('Created worktree {path}', { path }),
  );
  if (
    ok &&
    (await confirm(
      t('Open worktree'),
      t('Open {path} in a new tab?', { path }),
      t('Open in new tab'),
    ))
  )
    await useRepo.getState().open(path);
}

export async function openWorktree(w: Worktree) {
  await useRepo.getState().open(w.path);
}

/** Remove a worktree (asking first); true when it is gone. */
export async function removeWorktree(w: Worktree, confirmFirst = true): Promise<boolean> {
  const ok =
    !confirmFirst ||
    (await confirm(
      t('Remove worktree'),
      t('Remove the worktree at {path}? Its folder is deleted; the branch is kept.', {
        path: w.path,
      }),
      t('Remove'),
      true,
    ));
  const path = repo().path;
  if (!ok || !path) return false;
  let removed = false;
  useRepo.setState({ busy: 'Remove worktree' });
  try {
    await api.removeWorktree(path, w.path, false);
    removed = true;
    toast('success', t('Removed worktree {path}', { path: w.path }));
  } catch (e) {
    useRepo.setState({ busy: null });
    const msg = (e as Error).message;
    if (/modified|untracked|changes|dirty|--force|locked/i.test(msg)) {
      const force = await confirm(
        t('Worktree has changes'),
        t(
          '{path} has uncommitted changes or is locked. Remove it anyway? Those changes are lost.',
          { path: w.path },
        ),
        t('Force remove'),
        true,
      );
      if (force)
        removed = await run(
          'Remove worktree',
          (p) => api.removeWorktree(p, w.path, true),
          t('Removed worktree {path}', { path: w.path }),
        );
    } else toast('error', t('{label} failed', { label: t('Remove worktree') }), msg);
  } finally {
    useRepo.setState({ busy: null });
    await repo().refresh();
  }
  return removed;
}

/** Remove the worktree that has `ref` checked out, then delete the branch. */
export async function removeWorktreeAndBranch(w: Worktree, ref: GitRef) {
  const ok = await confirm(
    t('Remove worktree and delete branch'),
    t('Remove the worktree at {path} (its folder is deleted) and delete the branch {name}?', {
      path: w.path,
      name: ref.name,
    }),
    t('Remove'),
    true,
  );
  if (!ok || !(await removeWorktree(w, false))) return;
  await deleteBranch(ref, false);
}

export async function lockWorktree(w: Worktree, lock: boolean) {
  await run(lock ? 'Lock worktree' : 'Unlock worktree', (p) => api.lockWorktree(p, w.path, lock));
}

export async function pruneWorktrees() {
  await run('Prune worktrees', (p) => api.pruneWorktrees(p), t('Pruned stale worktrees'));
}

export async function openTerminalAt(path: string) {
  try {
    await api.openTerminal(path);
  } catch (e) {
    toast('error', t('Could not open a terminal'), (e as Error).message);
  }
}

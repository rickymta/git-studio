// User-level Git actions shared by the toolbar, sidebar, graph and panels.

import { short } from '@/lib/format';
import { api } from '@/lib/ipc';
import type { Commit, GitRef, Stash } from '@/lib/types';
import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';
import { ask, confirm, toast } from '@/stores/ui';

const repo = () => useRepo.getState();
const run = (...a: Parameters<ReturnType<typeof repo>['run']>) => repo().run(...a);

export const currentBranch = () => repo().info?.status.branch ?? null;

export async function fetchAll() {
  await run('Fetch', (p) => api.fetch(p), 'Fetched all remotes');
}

export async function pull() {
  const mode = repo().settings?.pullMode ?? 'merge';
  await run('Pull', (p) => api.pull(p, mode), 'Pulled');
}

export async function push(opts: { branch?: string; remote?: string } = {}) {
  const r = repo();
  const path = r.path;
  if (!path) return;
  useRepo.setState({ busy: 'Push' });
  try {
    await api.push(path, opts);
    toast('success', 'Pushed');
  } catch (e) {
    const msg = (e as Error).message;
    if (/rejected|non-fast-forward|fetch first/i.test(msg)) {
      useRepo.setState({ busy: null });
      const force = await confirm(
        'Push rejected',
        'The remote has commits you do not have. Pull first, or force push (with lease) to overwrite the remote branch.',
        'Force push',
        true,
      );
      if (force)
        await run('Force push', (p) => api.push(p, { ...opts, force: true }), 'Force pushed');
      return;
    }
    toast('error', 'Push failed', msg);
  } finally {
    useRepo.setState({ busy: null });
    await repo().refresh();
  }
}

export async function newBranch(start?: string, startLabel?: string) {
  const v = await ask({
    title: 'Create branch',
    description: start ? `Starting at ${startLabel ?? short(start)}` : 'Starting at HEAD',
    fields: [
      { name: 'name', label: 'Branch name', placeholder: 'feature/my-change', required: true },
      { name: 'checkout', label: 'Check out after creating', type: 'checkbox', initial: true },
    ],
    confirmLabel: 'Create',
  });
  if (!v) return;
  const name = (v.name as string).trim();
  await run(
    'Create branch',
    (p) => api.createBranch(p, name, start, v.checkout as boolean),
    `Created ${name}`,
  );
}

export async function checkoutRef(ref: GitRef) {
  if (ref.kind === 'local') {
    if (ref.isHead) return;
    await run('Checkout', (p) => api.checkout(p, ref.name, 'branch'), `Switched to ${ref.name}`);
  } else if (ref.kind === 'remote') {
    await run('Checkout', (p) => api.checkout(p, ref.name, 'remote'));
  } else {
    await checkoutCommit(ref.target, ref.name);
  }
}

export async function checkoutCommit(hash: string, label?: string) {
  const ok = await confirm(
    'Check out commit',
    `This puts the repository in "detached HEAD" at ${label ?? short(hash)}. Create a branch if you want to keep new commits.`,
    'Check out',
  );
  if (ok) await run('Checkout', (p) => api.checkout(p, hash, 'detached'));
}

export async function deleteBranch(ref: GitRef) {
  if (ref.kind === 'remote') {
    const remote = ref.remote!;
    const name = ref.name.slice(remote.length + 1);
    const ok = await confirm(
      'Delete remote branch',
      `Delete ${name} on ${remote}? This affects everyone using the remote.`,
      'Delete',
      true,
    );
    if (ok)
      await run(
        'Delete remote branch',
        (p) => api.deleteRemoteBranch(p, remote, name),
        `Deleted ${ref.name}`,
      );
    return;
  }
  const ok = await confirm('Delete branch', `Delete local branch ${ref.name}?`, 'Delete', true);
  if (!ok) return;
  const path = repo().path!;
  try {
    await api.deleteBranch(path, ref.name, false);
    toast('success', `Deleted ${ref.name}`);
  } catch (e) {
    const msg = (e as Error).message;
    if (/not fully merged/i.test(msg)) {
      const force = await confirm(
        'Branch not merged',
        `${ref.name} has commits that are not merged anywhere. Delete it anyway? Those commits may be lost.`,
        'Force delete',
        true,
      );
      if (force)
        await run(
          'Delete branch',
          (p) => api.deleteBranch(p, ref.name, true),
          `Deleted ${ref.name}`,
        );
    } else toast('error', 'Delete branch failed', msg);
  }
  await repo().refresh();
}

export async function renameBranch(ref: GitRef) {
  const v = await ask({
    title: 'Rename branch',
    fields: [{ name: 'name', label: 'New name', initial: ref.name, required: true }],
    confirmLabel: 'Rename',
  });
  if (v)
    await run('Rename branch', (p) => api.renameBranch(p, ref.name, (v.name as string).trim()));
}

export async function setUpstream(ref: GitRef) {
  const remotes = (repo().refs?.refs ?? []).filter((r) => r.kind === 'remote');
  if (remotes.length === 0) {
    toast('info', 'No remote branches to track. Push the branch first.');
    return;
  }
  const v = await ask({
    title: `Set upstream for ${ref.name}`,
    fields: [
      {
        name: 'up',
        label: 'Upstream branch',
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
    title: 'Merge',
    description: `Merge ${target} into ${cur}.`,
    fields: [
      {
        name: 'noFf',
        label: 'Always create a merge commit (--no-ff)',
        type: 'checkbox',
        initial: false,
      },
    ],
    confirmLabel: 'Merge',
  });
  if (v) await run('Merge', (p) => api.merge(p, target, v.noFf as boolean), `Merged ${target}`);
}

export async function rebaseOnto(target: string) {
  const cur = currentBranch() ?? 'HEAD';
  const ok = await confirm(
    'Rebase',
    `Rebase ${cur} onto ${target}? Commits of ${cur} are rewritten.`,
    'Rebase',
  );
  if (ok) await run('Rebase', (p) => api.rebase(p, target), `Rebased onto ${target}`);
}

export async function cherryPick(c: Commit) {
  await run(
    'Cherry-pick',
    (p) => api.cherryPick(p, c.hash, c.parents.length > 1),
    `Cherry-picked ${short(c.hash)}`,
  );
}

export async function revertCommit(c: Commit) {
  await run(
    'Revert',
    (p) => api.revert(p, c.hash, c.parents.length > 1),
    `Reverted ${short(c.hash)}`,
  );
}

export async function resetTo(hash: string, label?: string) {
  const v = await ask({
    title: `Reset ${currentBranch() ?? 'HEAD'} to ${label ?? short(hash)}`,
    fields: [
      {
        name: 'mode',
        label: 'Mode',
        type: 'select',
        initial: 'mixed',
        options: [
          { value: 'soft', label: 'Soft — keep changes staged' },
          { value: 'mixed', label: 'Mixed — keep changes in working tree' },
          { value: 'hard', label: 'Hard — discard all changes' },
        ],
      },
    ],
    confirmLabel: 'Reset',
    danger: true,
  });
  if (!v) return;
  const mode = v.mode as 'soft' | 'mixed' | 'hard';
  if (
    mode === 'hard' &&
    !(await confirm(
      'Hard reset',
      'Uncommitted changes will be lost. Continue?',
      'Hard reset',
      true,
    ))
  )
    return;
  await run('Reset', (p) => api.reset(p, hash, mode));
}

export async function createTag(target: string, label?: string) {
  const v = await ask({
    title: 'Create tag',
    description: `At ${label ?? short(target)}`,
    fields: [
      { name: 'name', label: 'Tag name', placeholder: 'v1.0.0', required: true },
      { name: 'message', label: 'Message (makes an annotated tag)', type: 'textarea' },
      { name: 'push', label: 'Push to origin', type: 'checkbox', initial: false },
    ],
    confirmLabel: 'Create',
  });
  if (!v) return;
  const name = (v.name as string).trim();
  const ok = await run(
    'Create tag',
    (p) => api.createTag(p, name, target, v.message as string),
    `Tagged ${name}`,
  );
  if (ok && v.push) await run('Push tag', (p) => api.push(p, { tag: name }), `Pushed ${name}`);
}

export async function deleteTag(ref: GitRef) {
  const remote = repo().refs?.remotes[0]?.name;
  const v = await ask({
    title: `Delete tag ${ref.name}`,
    fields: remote
      ? [{ name: 'remote', label: `Also delete on ${remote}`, type: 'checkbox', initial: false }]
      : [],
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!v) return;
  await run('Delete tag', (p) => api.deleteTag(p, ref.name), `Deleted ${ref.name}`);
  if (v.remote && remote)
    await run('Delete remote tag', (p) =>
      api.deleteRemoteBranch(p, remote, `refs/tags/${ref.name}`),
    );
}

export async function pushTag(ref: GitRef) {
  await run('Push tag', (p) => api.push(p, { tag: ref.name }), `Pushed ${ref.name}`);
}

export async function stash() {
  const v = await ask({
    title: 'Stash changes',
    fields: [
      { name: 'message', label: 'Message (optional)' },
      { name: 'untracked', label: 'Include untracked files', type: 'checkbox', initial: true },
    ],
    confirmLabel: 'Stash',
  });
  if (v)
    await run(
      'Stash',
      (p) => api.stashSave(p, v.message as string, v.untracked as boolean),
      'Changes stashed',
    );
}

export async function stashOp(s: Stash, op: 'apply' | 'pop' | 'drop') {
  if (
    op === 'drop' &&
    !(await confirm('Drop stash', `Delete ${s.name} (${s.message})?`, 'Drop', true))
  )
    return;
  const label = op === 'apply' ? 'Apply stash' : op === 'pop' ? 'Pop stash' : 'Drop stash';
  await run(label, (p) => api.stashOp(p, op, s.index));
}

export async function popLatest() {
  const s = repo().refs?.stashes[0];
  if (!s) {
    toast('info', 'No stashes');
    return;
  }
  await stashOp(s, 'pop');
}

export async function addRemote() {
  const v = await ask({
    title: 'Add remote',
    fields: [
      {
        name: 'name',
        label: 'Name',
        initial: repo().refs?.remotes.length ? '' : 'origin',
        required: true,
      },
      {
        name: 'url',
        label: 'URL',
        placeholder: 'https://github.com/owner/repo.git',
        required: true,
      },
    ],
    confirmLabel: 'Add',
  });
  if (v) {
    const ok = await run('Add remote', (p) =>
      api.addRemote(p, (v.name as string).trim(), (v.url as string).trim()),
    );
    if (ok) await fetchAll();
  }
}

export async function removeRemote(name: string) {
  if (
    await confirm(
      'Remove remote',
      `Remove remote ${name} and its remote-tracking branches?`,
      'Remove',
      true,
    )
  )
    await run('Remove remote', (p) => api.removeRemote(p, name));
}

export async function abortOp() {
  if (
    await confirm(
      'Abort',
      'Abort the operation in progress and return to the previous state?',
      'Abort',
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
    toast('info', 'This repository has no GitHub remote');
    return;
  }
  if (!useGitHub.getState().user) {
    toast('info', 'Sign in to GitHub first');
    return;
  }
  if (!head) return;
  const local = r.refs?.refs.find((x) => x.kind === 'local' && x.name === head);
  if (local && !local.upstream) {
    if (
      !(await confirm(
        'Push branch first',
        `${head} is not on GitHub yet. Push it to ${remote.name} now?`,
        'Push',
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
    title: 'Create pull request',
    description: `${remote.github.owner}/${remote.github.repo}: ${head} → base`,
    fields: [
      {
        name: 'base',
        label: 'Base branch',
        type: 'select',
        initial: base,
        options: (remoteBranches.length ? remoteBranches : [base]).map((b) => ({
          value: b,
          label: b,
        })),
      },
      { name: 'title', label: 'Title', initial: subject, required: true },
      { name: 'body', label: 'Description', type: 'textarea' },
      { name: 'draft', label: 'Create as draft', type: 'checkbox', initial: false },
    ],
    confirmLabel: 'Create pull request',
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
    toast('success', `Opened pull request #${pr.number}`, pr.htmlUrl);
    void useGitHub.getState().loadPulls(remote.github);
  } catch (e) {
    toast('error', 'Could not create pull request', (e as Error).message);
  }
}

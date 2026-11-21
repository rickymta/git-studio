// Where the shown repository is hosted (GitHub or GitLab) and its pull / merge requests, so the
// sidebar, toolbar, status bar and the create action treat both hosts alike.

import { useEffect } from 'react';

import { t } from '@/lib/i18n';
import type { PullRequest, Remote } from '@/lib/types';
import { useGitHub } from '@/stores/github';
import { ensureGitLabChecked, useGitLab } from '@/stores/gitlab';
import { useRepo } from '@/stores/repo';

export type HostKind = 'github' | 'gitlab';

export interface Hosting {
  kind: HostKind;
  remote: Remote;
  /** `owner/repo` on GitHub, `group/sub/name` on GitLab. */
  project: string;
}

/** The remote whose host lists the pull requests: origin first, then any GitHub, then GitLab. */
export function hostingOf(remotes: Remote[] | undefined): Hosting | null {
  const list = remotes ?? [];
  const pick =
    list.find((r) => r.name === 'origin' && (r.github || r.gitlab)) ??
    list.find((r) => r.github) ??
    list.find((r) => r.gitlab);
  if (pick?.github)
    return { kind: 'github', remote: pick, project: `${pick.github.owner}/${pick.github.repo}` };
  if (pick?.gitlab) return { kind: 'gitlab', remote: pick, project: pick.gitlab.path };
  return null;
}

/** Wording for each host: GitHub says "pull request #1", GitLab "merge request !1". */
export function hostWords(kind: HostKind) {
  return kind === 'github'
    ? {
        host: 'GitHub',
        section: t('Pull requests'),
        create: t('Create pull request'),
        none: t('No open pull requests'),
        connect: t('Connect GitHub to see pull requests.'),
        open: t('Open on GitHub'),
        openOne: t('Open pull request'),
        ref: (n: number) => `#${n}`,
      }
    : {
        host: 'GitLab',
        section: t('Merge requests'),
        create: t('Create merge request'),
        none: t('No open merge requests'),
        connect: t('Connect GitLab to see merge requests.'),
        open: t('Open on GitLab'),
        openOne: t('Open merge request'),
        ref: (n: number) => `!${n}`,
      };
}

/** The shown repository's host and its open pull / merge requests as loaded so far (no loading). */
export function useRepoHost() {
  const remotes = useRepo((s) => s.refs?.remotes);
  const host = hostingOf(remotes);
  const gh = useGitHub();
  const gl = useGitLab();
  const isGitLab = host?.kind === 'gitlab';
  const project = host?.project ?? null;
  const store = isGitLab ? gl : gh;
  // Only what was loaded for this project: the store may still hold another repository's list.
  const current = project !== null && store.pullsFor === project;
  const reload = () => {
    if (!host) return Promise.resolve();
    return host.kind === 'github' ? gh.loadPulls(host.remote.github) : gl.loadPulls(project);
  };
  return {
    host,
    account: (isGitLab ? gl.user?.login : gh.user?.login) ?? null,
    signedIn: !!(isGitLab ? gl.user : gh.user),
    pulls: current ? store.pulls : null,
    error: current ? store.pullsError : null,
    reload,
  };
}

/** Like `useRepoHost`, and loads the list when the repository or the account changes (one
 *  component does this: the sidebar). */
export function useRepoPulls() {
  const state = useRepoHost();
  const { host, account } = state;
  const isGitLab = host?.kind === 'gitlab';

  useEffect(() => {
    if (isGitLab) ensureGitLabChecked();
  }, [isGitLab]);

  useEffect(() => {
    void state.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host?.project, host?.kind, account]);

  return state;
}

/** Outside React (menus): the host requests can be created on now, i.e. signed in to it. */
export function requestHost(remotes: Remote[] | undefined): HostKind | null {
  const host = hostingOf(remotes);
  if (!host) return null;
  const signedIn = host.kind === 'github' ? useGitHub.getState().user : useGitLab.getState().user;
  return signedIn ? host.kind : null;
}

/** An open request whose source branch is `branch`, if the list has one. */
export function openRequestFor(pulls: PullRequest[] | null, branch: string) {
  return pulls?.find((p) => p.headRef === branch) ?? null;
}

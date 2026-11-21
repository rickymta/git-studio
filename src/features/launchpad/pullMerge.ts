// "Merge…" from the Launchpad hands the request to the app's pull / merge request merge dialog.
// The dialog registers itself here (see setPullMergeOpener), so Launchpad does not depend on it;
// until one is registered, Merge… opens the request on its host, where it can be merged.

import { openUrl } from '@/lib/native';

export interface PullMergeTarget {
  kind: 'github' | 'gitlab';
  /** GitHub `owner/repo` or GitLab project path. */
  project: string;
  number: number;
  /** Local repository whose remote points at the project, when one is cloned. */
  repo: string | null;
  /** That repository's remote for the project. */
  remote: string | null;
  url: string;
}

type Opener = (target: PullMergeTarget) => void | Promise<void>;

let opener: Opener | null = null;

/** Register the merge dialog; returns a function that unregisters it. */
export function setPullMergeOpener(fn: Opener): () => void {
  opener = fn;
  return () => {
    if (opener === fn) opener = null;
  };
}

export function hasPullMergeDialog(): boolean {
  return opener !== null;
}

export async function openPullMerge(target: PullMergeTarget): Promise<void> {
  if (opener) await opener(target);
  else await openUrl(target.url);
}

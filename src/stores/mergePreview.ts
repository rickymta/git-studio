import { create } from 'zustand';

import type { HostKind } from '@/features/pulls/hosting';

/** What the merge preview shows: merging `theirs` into the checked-out branch. */
export interface MergePreviewSpec {
  /** Ref to merge in (branch, remote branch or commit). */
  theirs: string;
  /** Name shown for the incoming side. */
  label: string;
  /** Run once the merge is complete with no conflict left (pull request flow). */
  after?: () => Promise<void>;
  /** Label of the merge button when `after` does more than merging. */
  actionLabel?: string;
}

interface MergePreviewState {
  spec: MergePreviewSpec | null;
  show: (spec: MergePreviewSpec) => void;
  close: () => void;
}

export const useMergePreview = create<MergePreviewState>((set) => ({
  spec: null,
  show: (spec) => set({ spec }),
  close: () => set({ spec: null }),
}));

/** A pull / merge request to merge, from the sidebar. */
export interface PullMergeSpec {
  kind: HostKind;
  /** GitHub `owner/repo` or GitLab project path. */
  project: string;
  number: number;
  /** Remote that points at the project. */
  remote: string;
}

interface PullMergeState {
  spec: PullMergeSpec | null;
  show: (spec: PullMergeSpec) => void;
  close: () => void;
}

export const usePullMerge = create<PullMergeState>((set) => ({
  spec: null,
  show: (spec) => set({ spec }),
  close: () => set({ spec: null }),
}));

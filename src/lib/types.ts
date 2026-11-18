// Mirrors gitstudio-core's JSON shapes (camelCase).

export interface Commit {
  hash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorTime: number;
  committerName: string;
  commitTime: number;
  subject: string;
  /** First lines of the body, flattened (log only). */
  body?: string;
}

export type FileStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '?';

export interface FileChange {
  path: string;
  origPath: string | null;
  status: FileStatus;
}

export interface CommitDetail extends Commit {
  committerEmail: string;
  body: string;
  files: FileChange[];
}

export type RefKind = 'local' | 'remote' | 'tag';

export interface GitRef {
  fullName: string;
  name: string;
  kind: RefKind;
  target: string;
  isHead: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  upstreamGone: boolean;
  remote: string | null;
}

export interface Stash {
  index: number;
  name: string;
  hash: string;
  message: string;
  time: number;
}

export interface GitHubSlug {
  owner: string;
  repo: string;
}

export interface Remote {
  name: string;
  url: string;
  pushUrl: string;
  github: GitHubSlug | null;
}

export interface Refs {
  refs: GitRef[];
  stashes: Stash[];
  remotes: Remote[];
}

export interface Status {
  branch: string | null;
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: FileChange[];
  unstaged: FileChange[];
  conflicted: FileChange[];
}

export type RepoState = 'clean' | 'merging' | 'rebasing' | 'cherryPicking' | 'reverting';

export interface RepoInfo {
  path: string;
  name: string;
  gitDir: string;
  state: RepoState;
  status: Status;
}

export interface Identity {
  name: string;
  email: string;
}

export interface RecentRepo {
  path: string;
  name: string;
  openedAt: number;
}

export interface Settings {
  recent: RecentRepo[];
  githubClientId: string;
  cloneDir: string;
  pullMode: 'merge' | 'rebase' | 'ff-only';
}

export type DiffSource = 'unstaged' | 'staged' | 'commit';

export interface DiffRequest {
  source: DiffSource;
  path: string;
  origPath?: string | null;
  untracked?: boolean;
  commit?: string;
  parent?: string | null;
}

export interface PushRequest {
  remote?: string;
  branch?: string;
  tag?: string;
  force?: boolean;
}

export interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
}

export interface GitHubRepo {
  fullName: string;
  name: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  cloneUrl: string;
  sshUrl: string;
  htmlUrl: string;
  defaultBranch: string | null;
  updatedAt: string | null;
  stargazersCount: number;
}

export interface PullRequest {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  htmlUrl: string;
  author: string;
  authorAvatar: string;
  headRef: string;
  headRepo: string | null;
  baseRef: string;
  updatedAt: string;
}

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type DevicePoll =
  | { status: 'pending' }
  | { status: 'slowDown'; interval: number }
  | { status: 'done'; user: GitHubUser };

export interface AppError {
  kind: string;
  message: string;
}

export interface Workspace {
  id: string;
  name: string;
  color: string;
  repos: string[];
}

export interface Workspaces {
  items: Workspace[];
  active: string;
}

export interface RepoSummary {
  path: string;
  name: string;
  error: string | null;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: number;
  conflicts: number;
  state: RepoState | null;
  lastCommit: { hash: string; subject: string; author: string; time: number } | null;
  github: GitHubSlug | null;
}

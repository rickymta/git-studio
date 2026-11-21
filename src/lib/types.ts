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
  /** Set on the pseudo-rows the graph shows for stashes (not real history). */
  stash?: Stash;
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

/** `history.search`: every non-empty field has to match (literal text, any case). */
export interface CommitSearch {
  message?: string;
  author?: string;
  /** Text added or removed by the commit (`git log -S`). */
  content?: string;
  /** File or folder the commit touches. */
  path?: string;
}

/** Squash keeps both messages; fixup keeps the earlier commit's message only. */
export type RebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop';

export interface RebaseStep {
  action: RebaseAction;
  /** Full hash, as listed by the rebase plan. */
  hash: string;
  /** New message, for `reword`. */
  message?: string;
}

/** What changes from one commit (or branch, tag) to another. */
export interface Comparison {
  files: FileChange[];
  /** Commits on the target that the base does not have. */
  ahead: number;
  /** Commits on the base that the target does not have. */
  behind: number;
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
  /** Commit the stash was made on. */
  base: string | null;
}

/** One move of HEAD, newest first (`git log -g HEAD`). */
export interface ReflogEntry {
  /** `HEAD@{n}`. */
  selector: string;
  hash: string;
  /** What moved HEAD: `checkout: moving from a to b`, `commit: …`, `reset: …`. */
  action: string;
  /** Subject of the commit HEAD moved to. */
  subject: string;
  time: number;
  /** No branch, tag or remote branch contains the commit any more. */
  unreferenced: boolean;
}

export interface GitHubSlug {
  owner: string;
  repo: string;
}

/** A gitlab.com project, groups included (`group/sub/name`). */
export interface GitLabSlug {
  path: string;
}

export interface Remote {
  name: string;
  url: string;
  pushUrl: string;
  github: GitHubSlug | null;
  gitlab: GitLabSlug | null;
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

/** The first screen of a repository kept on disk (see `api.savePage`). */
export interface SavedPage {
  /** Commits of the first page, without stash rows. */
  commits: Commit[];
  refs: Refs;
  worktrees: Worktree[];
  /** When it was saved (ms). */
  at: number;
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

export interface SshSettings {
  /** `system`: ssh's own config/agent; `key`: always use privateKey. */
  mode: 'system' | 'key';
  privateKey: string;
  publicKey: string;
}

export interface Settings {
  recent: RecentRepo[];
  githubClientId: string;
  cloneDir: string;
  pullMode: 'merge' | 'rebase' | 'ff-only';
  ssh: SshSettings;
  preferSsh: boolean;
  autoFetchMinutes: number;
  autoPrune: boolean;
  defaultBranch: string;
  initialCommits: number;
  rememberTabs: boolean;
  /** Show commit authors' Gravatar pictures. */
  gravatar: boolean;
  externalEditor: string;
  terminal: 'auto' | 'wt' | 'powershell' | 'cmd' | 'gitbash';
  /** Days of activity history kept; 0 keeps everything. */
  historyRetentionDays: number;
  historyWarnMb: number;
  historyMaxMb: number;
  historyLoadLimit: number;
  overlayIcons: boolean;
  contextMenu: boolean;
}

export interface HistoryStats {
  path: string;
  bytes: number;
  entries: number;
  level: 'ok' | 'warn' | 'full';
  warnBytes: number;
  maxBytes: number;
  retentionDays: number;
}

/** What a context-menu launch asked for (see launch.rs). */
export type LaunchAction = { kind: 'open'; path: string };

export interface QuickCommand {
  label: string;
  command: string;
  sudo: boolean;
}

/** File-manager status icons (Explorer / Finder / Nautilus…). */
export interface OverlayInfo {
  platform: 'windows' | 'macos' | 'linux';
  enabled: boolean;
  installed: boolean;
  repos: number;
  updated: number;
  statusFile: string;
  notes: string[];
  commands: QuickCommand[];
  home: string;
}

export interface HistoryLoaded {
  entries: unknown[];
  pruned: number;
  stats: HistoryStats;
}

export interface LocalKey {
  name: string;
  privatePath: string | null;
  publicPath: string;
  keyType: string;
  comment: string;
  fingerprint: string | null;
  publicKey: string;
}

export interface SshInfo {
  settings: SshSettings;
  sshDir: string;
  sshVersion: string | null;
  keys: LocalKey[];
  current: LocalKey | null;
}

export interface SshTestResult {
  ok: boolean;
  user: string | null;
  message: string;
}

export interface GitHubSshKey {
  id: number;
  key: string;
  title: string;
  createdAt: string | null;
}

export interface ImportedRepo {
  path: string;
  name: string;
}

export interface GitKrakenData {
  repos: ImportedRepo[];
  tabs: ImportedRepo[];
  selectedTab: string | null;
  sshPrivateKey: string | null;
  sshPublicKey: string | null;
  sshUseAgent: boolean | null;
  theme: string | null;
  fileView: string | null;
  maxCommits: number | null;
}

export interface GitKrakenImport {
  data: GitKrakenData;
  addedRepos: number;
  sshImported: boolean;
}

export type DiffSource = 'unstaged' | 'staged' | 'commit' | 'worktree';

export interface DiffRequest {
  source: DiffSource;
  path: string;
  origPath?: string | null;
  untracked?: boolean;
  commit?: string;
  parent?: string | null;
  /** Ignore leading/trailing whitespace and amount-of-whitespace changes. */
  ignoreWhitespace?: boolean;
  /** Context lines; a large number shows the whole file. */
  context?: number;
  /** File encoding used to decode the diff. */
  encoding?: string;
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
  /** OAuth scopes; null for fine-grained tokens. */
  scopes?: string[] | null;
  token?: TokenInfo;
}

export type TokenKind = 'pat' | 'fineGrained' | 'oauth' | 'unknown';

/** Kind and expiry of the stored token (never the token itself). */
export interface TokenInfo {
  kind: TokenKind;
  /** RFC 3339; null when the token has no expiry date. */
  expiresAt: string | null;
  /** The host could not be asked; `expiresAt` says nothing (keep the known date). */
  expiryUnknown?: boolean;
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

export type SupportTopic = 'bug' | 'feature' | 'question' | 'other';

/** The Help form, sent as an email by the backend (`support.send`). */
export interface SupportRequest {
  name: string;
  email: string;
  topic: SupportTopic;
  subject: string;
  message: string;
  /** Attach the app version and OS. */
  includeSystem: boolean;
  appVersion?: string;
}

export interface SystemInfo {
  os: string;
  arch: string;
}

export interface AppError {
  kind: string;
  message: string;
}

export interface WorkspaceFolder {
  id: string;
  name: string;
  /** Parent folder id; '' for the workspace's root. */
  parent: string;
  collapsed: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  color: string;
  repos: string[];
  /** Folders grouping the repositories, at most three levels deep. */
  folders?: WorkspaceFolder[];
  /** Normalised repository path → folder id; a repository not listed sits at the root. */
  placement?: Record<string, string>;
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
  gitlab: { path: string } | null;
  /** Uncommitted files by kind (each path once). */
  wip: WipCounts;
}

export interface WipCounts {
  modified: number;
  added: number;
  deleted: number;
  renamed: number;
}

export interface LaunchPerson {
  login: string;
  avatarUrl: string;
}

export type LaunchReason = 'authored' | 'assigned' | 'reviewRequested' | 'mentioned';

/** A pull / merge request or issue in the Launchpad (see crates/gitstudio-core/src/launchpad.rs). */
export interface LaunchItem {
  id: string;
  host: 'github' | 'gitlab';
  kind: 'pr' | 'issue';
  project: string;
  number: number;
  title: string;
  url: string;
  author: LaunchPerson | null;
  assignees: LaunchPerson[];
  labels: { name: string; color: string | null }[];
  reasons: LaunchReason[];
  comments: number;
  reactions: number;
  createdAt: string;
  updatedAt: string;
  draft: boolean;
  headRef: string | null;
  baseRef: string | null;
  ci: 'success' | 'failure' | 'pending' | null;
  mergeable: 'clean' | 'conflicts' | 'blocked' | 'unknown' | null;
  review: 'approved' | 'changesRequested' | 'reviewRequired' | null;
}

export interface TextFormat {
  encoding: string;
  bom: boolean;
  eol: 'lf' | 'crlf' | 'mixed';
}

/** One file that would conflict in a merge preview (blob ids of its three versions). */
export interface PreviewConflict {
  path: string;
  base: string | null;
  ours: string | null;
  theirs: string | null;
  /** git's kind: "contents", "modify/delete", "add/add", … */
  kind: string;
}

/** What merging a branch would do, computed without touching the working tree. */
export interface MergePreview {
  ours: string;
  theirs: string;
  upToDate: boolean;
  fastForward: boolean;
  tree: string | null;
  files: FileChange[];
  conflicts: PreviewConflict[];
  messages: string[];
}

export interface PreviewFile {
  merged: string | null;
  format: TextFormat | null;
}

/** Whether a pull / merge request can be merged now (GitHub or GitLab). */
export interface MergeInfo {
  number: number;
  title: string;
  htmlUrl: string;
  state: string;
  draft: boolean;
  headRef: string;
  headSha: string;
  headRepo: string | null;
  baseRef: string;
  /** null while the host is still checking. */
  mergeable: boolean | null;
  mergeState: string;
  conflicts: boolean;
}

export interface MergeOutcome {
  merged: boolean;
  sha: string | null;
  message: string;
}

/** A conflicted file's versions for the merge tool (see `conflict.versions`). */
export interface ConflictVersions {
  /** The file merged again with the base shown (`|||||||`), or null when a side is missing. */
  merged: string | null;
  format: TextFormat | null;
  oursLabel: string;
  theirsLabel: string;
  oursCommit: string | null;
  theirsCommit: string | null;
}

export interface DecodedText {
  text: string;
  format: TextFormat;
  binary: boolean;
  lossy: boolean;
  size: number;
}

export interface BlameCommit {
  hash: string;
  author: string;
  authorEmail: string;
  time: number;
  summary: string;
}

export interface Blame {
  lines: string[];
  commits: BlameCommit[];
}

export interface FileHistoryEntry extends Commit {
  change: FileChange;
}

export interface Worktree {
  path: string;
  head: string | null;
  branch: string | null;
  isMain: boolean;
  isCurrent: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

export interface CloneOptions {
  shallow?: boolean;
  sparse?: boolean;
}

export interface GitLabUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
  token?: TokenInfo;
}

export interface TerminalOpened {
  id: number;
  shell: string;
}

/** Font of the user's own terminal (Windows Terminal); only values they set are present. */
export interface TerminalFont {
  face?: string | null;
  /** Points. */
  size?: number | null;
  /** CSS weight. */
  weight?: number | null;
  source?: string | null;
}

export interface TerminalOutput {
  /** base64 bytes */
  data: string;
  exited: boolean;
}

export interface CredentialAccount {
  username: string;
  /** The open repository is set to use this account. */
  forRepo: boolean;
  /** Chosen for every repository (global git config). */
  globalDefault: boolean;
  /** What git uses in a repository without its own choice. */
  helperDefault: boolean;
}

export interface HostCredential {
  host: string;
  remotes: string[];
  /** Something is stored for the account git uses here. */
  stored: boolean;
  /** The account git uses for this host in the open repository. */
  username: string | null;
  /** Every account with a stored password or token for this host. */
  accounts: CredentialAccount[];
  repoChoice: string | null;
  globalChoice: string | null;
}

export type SubmoduleState = 'clean' | 'uninitialized' | 'modified' | 'conflict';

export interface Submodule {
  name: string;
  /** Relative to the repository root. */
  path: string;
  url: string;
  branch: string | null;
  /** Commit the repository records for it. */
  recorded: string | null;
  /** Commit checked out in it (null until initialised). */
  current: string | null;
  state: SubmoduleState;
}

export interface LfsFile {
  path: string;
  oid: string;
  /** The real content is in the working tree, not just the LFS pointer. */
  downloaded: boolean;
}

export interface LfsInfo {
  /** git-lfs is installed. */
  available: boolean;
  version: string | null;
  /** Patterns stored with LFS (top-level .gitattributes). */
  patterns: string[];
  files: LfsFile[];
}

export type SignatureStatus =
  'good' | 'untrusted' | 'expired' | 'revoked' | 'bad' | 'unverifiable' | 'none';

export interface CommitSignature {
  status: SignatureStatus;
  signer: string;
  key: string;
  fingerprint: string;
}

/** git's signing settings in one config scope. */
export interface SigningConfig {
  signCommits: boolean;
  signTags: boolean;
  /** `openpgp`, `ssh`, `x509`; empty = git's default. */
  format: string;
  key: string;
}

export interface BisectState {
  active: boolean;
  bad: string | null;
  good: string[];
  skipped: string[];
  /** Commit checked out for testing. */
  current: string | null;
  /** Revisions still to look through. */
  remaining: number | null;
  steps: number | null;
  /** The commit that introduced the change, once found. */
  firstBad: string | null;
}

export interface MergeTools {
  /** `merge.tool` (global); empty = not set. */
  mergeTool: string;
  diffTool: string;
  /** Tools git found on this computer. */
  available: string[];
  /** Tools git supports but did not find. */
  other: string[];
}

/** A file's raw bytes at a revision, the index or the working tree. */
export interface FileBlob {
  size: number;
  /** Base64; `null` when over the size limit. */
  data: string | null;
}

/** `git count-objects -v`, sizes in bytes. */
export interface RepoStats {
  looseObjects: number;
  looseSize: number;
  packedObjects: number;
  packs: number;
  packSize: number;
  prunePackable: number;
  garbage: number;
  garbageSize: number;
}

export type MaintenanceTask =
  'gc' | 'gc-aggressive' | 'prune' | 'repack' | 'commit-graph' | 'pack-refs' | 'fsck';

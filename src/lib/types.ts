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
  externalEditor: string;
  terminal: 'auto' | 'wt' | 'powershell' | 'cmd' | 'gitbash';
  /** Days of activity history kept; 0 keeps everything. */
  historyRetentionDays: number;
  historyWarnMb: number;
  historyMaxMb: number;
  historyLoadLimit: number;
  overlayIcons: boolean;
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

export interface TextFormat {
  encoding: string;
  bom: boolean;
  eol: 'lf' | 'crlf' | 'mixed';
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

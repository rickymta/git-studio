import { invoke } from '@tauri-apps/api/core';

import type * as T from './types';

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const BRIDGE = 'http://127.0.0.1:1421/call';

export class IpcError extends Error {
  kind: string;
  constructor(e: T.AppError) {
    super(e.message);
    this.kind = e.kind;
  }
}

function toError(e: unknown): IpcError {
  if (e instanceof IpcError) return e;
  if (e && typeof e === 'object' && 'message' in e) {
    const o = e as { kind?: string; message: string };
    return new IpcError({ kind: o.kind ?? 'unknown', message: o.message });
  }
  return new IpcError({ kind: 'unknown', message: String(e) });
}

/** Call one backend command (Tauri in the app, the dev HTTP bridge in a plain browser). */
export async function call<R>(cmd: string, args: Record<string, unknown> = {}): Promise<R> {
  try {
    if (inTauri) {
      return await invoke<R>('call', { cmd, args });
    }
    const res = await fetch(BRIDGE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd, args }),
    });
    const body = await res.json();
    if (!res.ok) throw body;
    return body as R;
  } catch (e) {
    throw toError(e);
  }
}

export const isTauri = inTauri;

/** Typed wrappers. Every repo-scoped call takes the repo path first. */
export const api = {
  gitVersion: () => call<string>('app.gitVersion'),
  /** Apply GitStudio's global git defaults (core.longpaths on Windows); returns changed keys. */
  ensureGitDefaults: () => call<string[]>('app.ensureGitDefaults'),
  openTerminal: (path: string) => call<null>('app.openTerminal', { path }),
  openEditor: (path: string) => call<null>('app.openEditor', { path }),
  // files, blame, history
  readFile: (repo: string, path: string, rev?: string, encoding?: string) =>
    call<T.DecodedText>('file.read', { repo, path, rev, encoding }),
  repoStats: (repo: string) => call<T.RepoStats>('maintenance.stats', { repo }),
  /** Run a housekeeping task; `ok: false` with git's output when it reports a problem. */
  maintenance: (repo: string, task: T.MaintenanceTask) =>
    call<{ ok: boolean; output: string }>('maintenance.run', { repo, task }),
  /** Raw bytes of `path` in `rev` (`':'` = the index, none = working tree); `null` if absent. */
  fileBlob: (repo: string, path: string, rev: string | null, max?: number) =>
    call<T.FileBlob | null>('file.blob', { repo, path, rev, max }),
  writeFile: (repo: string, path: string, content: string, format: T.TextFormat) =>
    call<null>('file.write', { repo, path, content, format }),
  encodings: () => call<string[]>('file.encodings'),
  blame: (repo: string, path: string, rev?: string) =>
    call<T.Blame>('repo.blame', { repo, path, rev }),
  fileHistory: (repo: string, path: string, limit = 500) =>
    call<T.FileHistoryEntry[]>('repo.fileHistory', { repo, path, limit }),
  listFiles: (repo: string, rev: string) => call<string[]>('repo.listFiles', { repo, rev }),
  // durable app data (activity.jsonl, ui-state.json)
  historyLoad: () => call<T.HistoryLoaded>('history.load'),
  historyAppend: (entries: unknown[]) => call<T.HistoryStats>('history.append', { entries }),
  historyClear: (repo?: string | null) => call<T.HistoryStats>('history.clear', { repo }),
  stateLoad: () => call<Record<string, unknown>>('state.load'),
  // file-manager context menu
  takeLaunchActions: () => call<T.LaunchAction[]>('app.takeLaunchActions'),
  shellMenuInfo: () => call<{ installed: boolean }>('shellMenu.info'),
  shellMenuSet: (enabled: boolean) => call<{ installed: boolean }>('shellMenu.set', { enabled }),
  // file-manager status icons
  overlayInfo: (resourceDir: string | null) => call<T.OverlayInfo>('overlay.info', { resourceDir }),
  overlayEnable: (resourceDir: string | null) =>
    call<T.OverlayInfo>('overlay.enable', { resourceDir }),
  overlayDisable: (resourceDir: string | null) =>
    call<T.OverlayInfo>('overlay.disable', { resourceDir }),
  overlayRefresh: () => call<{ repos: number }>('overlay.refresh'),
  overlayRestartFileManager: () => call<null>('overlay.restartFileManager'),
  stateSet: (changes: Record<string, string | null>) => call<null>('state.set', { changes }),
  compareWithWorktree: (repo: string, hash: string) =>
    call<T.FileChange[]>('repo.compare', { repo, hash }),
  /** Files and commit counts from `base` to `target` (commits, branches or tags). */
  compareCommits: (repo: string, base: string, target: string) =>
    call<T.Comparison>('repo.compareCommits', { repo, base, target }),
  reword: (repo: string, hash: string, message: string) =>
    call<null>('history.reword', { repo, hash, message }),
  /** Replace the message of HEAD (which must still be `hash`); returns the new HEAD. */
  amendMessage: (repo: string, hash: string, message: string) =>
    call<string>('history.amendMessage', { repo, hash, message }),
  remotesContaining: (repo: string, hash: string) =>
    call<string[]>('history.remotesContaining', { repo, hash }),
  dropCommit: (repo: string, hash: string) => call<null>('history.drop', { repo, hash }),
  /** Commits of every ref matching `query`, found by git (not only the loaded ones). */
  mergeTools: () => call<T.MergeTools>('tools.list', {}),
  /** Set (empty: unset) the global merge.tool / diff.tool. */
  setTool: (kind: 'merge' | 'diff', name: string) => call<null>('tools.set', { kind, name }),
  /** Open a conflicted file in the merge tool; resolves when the tool closes. */
  mergeTool: (repo: string, path: string) => call<null>('tools.merge', { repo, path }),
  /** Show a file's unstaged, `staged` or `commit` changes in the diff tool. */
  diffTool: (repo: string, path: string, staged = false, commit?: string) =>
    call<null>('tools.diff', { repo, path, staged, commit }),
  bisectState: (repo: string) => call<T.BisectState>('bisect.state', { repo }),
  bisectStart: (repo: string, bad?: string, good?: string) =>
    call<T.BisectState>('bisect.start', { repo, bad, good }),
  /** Mark `rev` (HEAD when omitted); git checks out the next commit to test. */
  bisectMark: (repo: string, mark: 'good' | 'bad' | 'skip', rev?: string) =>
    call<T.BisectState>('bisect.mark', { repo, mark, rev }),
  bisectReset: (repo: string) => call<null>('bisect.reset', { repo }),
  commitSignature: (repo: string, hash: string) =>
    call<T.CommitSignature>('signing.commit', { repo, hash }),
  signingConfig: (repo: string, scope: 'effective' | 'local' | 'global' = 'effective') =>
    call<T.SigningConfig>('signing.get', { repo, scope }),
  setSigning: (repo: string, config: T.SigningConfig, scope: 'local' | 'global') =>
    call<null>('signing.set', { repo, config, scope }),
  lfsInfo: (repo: string) => call<T.LfsInfo>('lfs.info', { repo }),
  lfsTrack: (repo: string, pattern: string) => call<null>('lfs.track', { repo, pattern }),
  lfsUntrack: (repo: string, pattern: string) => call<null>('lfs.untrack', { repo, pattern }),
  lfsInstall: (repo: string) => call<null>('lfs.install', { repo }),
  lfsOp: (repo: string, op: 'pull' | 'fetch' | 'prune') => call<string>('lfs.op', { repo, op }),
  submodules: (repo: string) => call<T.Submodule[]>('submodule.list', { repo }),
  /** `git submodule update --init` for `paths` (all when empty). */
  submoduleUpdate: (repo: string, paths: string[] = [], recursive = true) =>
    call<null>('submodule.update', { repo, paths, recursive }),
  submoduleSync: (repo: string) => call<null>('submodule.sync', { repo }),
  submoduleAdd: (repo: string, url: string, path: string, branch?: string) =>
    call<null>('submodule.add', { repo, url, path, branch }),
  submoduleDeinit: (repo: string, path: string, force = false) =>
    call<null>('submodule.deinit', { repo, path, force }),
  searchCommits: (repo: string, query: T.CommitSearch, limit = 200) =>
    call<T.Commit[]>('history.search', { repo, query, limit }),
  /** Commits an interactive rebase from `from` rewrites: `from` up to HEAD, oldest first. */
  rebasePlan: (repo: string, from: string) =>
    call<T.Commit[]>('history.rebasePlan', { repo, from }),
  /** Interactive rebase from `from`: every commit of the plan once, in the order given. */
  rebaseSteps: (repo: string, from: string, steps: T.RebaseStep[]) =>
    call<null>('history.rebaseSteps', { repo, from, steps }),
  moveCommit: (repo: string, hash: string, down: boolean) =>
    call<null>('history.move', { repo, hash, down }),
  createPatch: (repo: string, hash: string, dest: string) =>
    call<null>('patch.create', { repo, hash, dest }),
  /** One patch file of several commits, in the order given (oldest first for `git am`). */
  createPatches: (repo: string, hashes: string[], dest: string) =>
    call<null>('patch.create', { repo, hashes, dest }),
  applyPatchFile: (repo: string, file: string) => call<null>('patch.apply', { repo, file }),
  // worktrees
  worktrees: (repo: string) => call<T.Worktree[]>('worktree.list', { repo }),
  addWorktree: (repo: string, request: { path: string; branch?: string; newBranch?: string }) =>
    call<null>('worktree.add', { repo, request }),
  removeWorktree: (repo: string, path: string, force = false) =>
    call<null>('worktree.remove', { repo, path, force }),
  lockWorktree: (repo: string, path: string, lock: boolean) =>
    call<null>('worktree.lock', { repo, path, lock }),
  pruneWorktrees: (repo: string) => call<null>('worktree.prune', { repo }),
  // in-app terminal
  terminalOpen: (cwd: string, cols: number, rows: number) =>
    call<T.TerminalOpened>('terminal.open', { cwd, cols, rows }),
  terminalFont: () => call<T.TerminalFont>('terminal.font'),
  terminalRead: (id: number) => call<T.TerminalOutput>('terminal.read', { id }),
  terminalWrite: (id: number, data: string) => call<null>('terminal.write', { id, data }),
  terminalResize: (id: number, cols: number, rows: number) =>
    call<null>('terminal.resize', { id, cols, rows }),
  terminalClose: (id: number) => call<null>('terminal.close', { id }),
  // Help / support form
  supportSystemInfo: () => call<T.SystemInfo>('support.systemInfo'),
  sendSupport: (request: T.SupportRequest) => call<null>('support.send', { request }),
  // GitLab
  /** Whether a GitHub / GitLab token is stored (no network call). */
  storedTokens: () => call<{ github: boolean; gitlab: boolean }>('auth.storedTokens'),
  glAccount: () => call<T.GitLabUser | null>('gitlab.account'),
  glSignInToken: (token: string) => call<T.GitLabUser>('gitlab.signInToken', { token }),
  glImportToken: () => call<T.GitLabUser>('gitlab.importToken'),
  glSignOut: () => call<null>('gitlab.signOut'),
  glRepos: (page = 1) => call<T.GitHubRepo[]>('gitlab.repos', { page }),
  /** Open merge requests, shaped like GitHub pull requests (`number` is the MR's iid). */
  glMergeRequests: (path: string) => call<T.PullRequest[]>('gitlab.mergeRequests', { path }),
  glCreateMergeRequest: (mr: {
    path: string;
    title: string;
    description: string;
    source: string;
    target: string;
    draft: boolean;
  }) => call<T.PullRequest>('gitlab.createMergeRequest', { mr }),
  /** Global git config, or the repository's own config when `repo` is given. */
  gitConfig: (keys: string[], repo?: string) =>
    call<Record<string, string>>('gitconfig.get', { keys, repo }),
  setGitConfig: (key: string, value: string | null, repo?: string) =>
    call<null>('gitconfig.set', { key, value, repo }),
  credentials: (repo?: string) => call<T.HostCredential[]>('credentials.list', { repo }),
  saveCredential: (host: string, username: string, password: string) =>
    call<null>('credentials.save', { host, username, password }),
  eraseCredential: (host: string, username?: string) =>
    call<null>('credentials.erase', { host, username }),
  /** Account git uses for `host` in `repo` (or every repository without `repo`); null clears. */
  chooseCredential: (host: string, username: string | null, repo?: string) =>
    call<null>('credentials.choose', { host, username, repo }),
  gitkrakenDetect: () =>
    call<{ repos: number; tabs: number; ssh: boolean } | null>('gitkraken.detect'),
  gitkrakenImport: (ssh: boolean) => call<T.GitKrakenImport>('gitkraken.import', { ssh }),
  sshInfo: () => call<T.SshInfo>('ssh.info'),
  saveSsh: (ssh: T.SshSettings) => call<T.SshInfo>('ssh.save', { ssh }),
  sshGenerate: (name: string, comment: string, passphrase: string) =>
    call<T.LocalKey>('ssh.generate', { name, comment, passphrase }),
  sshTest: (host = 'github.com') => call<T.SshTestResult>('ssh.test', { host }),
  setRemoteUrl: (repo: string, name: string, url: string, push = false) =>
    call<null>('remote.setUrl', { repo, name, url, push }),
  renameRemote: (repo: string, from: string, to: string) =>
    call<null>('remote.rename', { repo, from, to }),
  ghImportToken: (source: 'gh' | 'git') => call<T.GitHubUser>('github.importToken', { source }),
  ghKeys: () => call<T.GitHubSshKey[]>('github.keys'),
  ghAddKey: (title: string, key: string) => call<T.GitHubSshKey>('github.addKey', { title, key }),
  ghDeleteKey: (id: number) => call<null>('github.deleteKey', { id }),
  workspaces: () => call<T.Workspaces>('workspace.list'),
  saveWorkspaces: (workspaces: T.Workspaces) =>
    call<T.Workspaces>('workspace.save', { workspaces }),
  scanRepos: (root: string, depth = 3) => call<string[]>('workspace.scan', { root, depth }),
  workspaceStatus: (repos: string[]) => call<T.RepoSummary[]>('workspace.status', { repos }),
  settings: () => call<T.Settings>('settings.get'),
  saveSettings: (settings: T.Settings) => call<T.Settings>('settings.set', { settings }),
  forgetRecent: (path: string) => call<T.Settings>('settings.forgetRecent', { path }),

  open: (repo: string) => call<T.RepoInfo>('repo.open', { repo }),
  init: (path: string, branch = 'main') => call<T.RepoInfo>('repo.init', { path, branch }),
  clone: (url: string, dest: string, options: T.CloneOptions = {}) =>
    call<T.RepoInfo>('repo.clone', { url, dest, options }),
  info: (repo: string) => call<T.RepoInfo>('repo.info', { repo }),
  log: (repo: string, limit: number, skip = 0, view?: { solo: string[]; hidden: string[] }) =>
    call<T.Commit[]>('repo.log', { repo, limit, skip, view }),
  refs: (repo: string) => call<T.Refs>('repo.refs', { repo }),
  /** Where HEAD has been, newest first. */
  reflog: (repo: string, limit = 100, skip = 0) =>
    call<T.ReflogEntry[]>('repo.reflog', { repo, limit, skip }),
  commit: (repo: string, hash: string) => call<T.CommitDetail>('repo.commit', { repo, hash }),
  diff: (repo: string, request: T.DiffRequest) => call<string>('repo.diff', { repo, request }),
  identity: (repo: string) => call<T.Identity>('repo.identity', { repo }),
  setIdentity: (repo: string, name: string, email: string, global: boolean) =>
    call<null>('repo.setIdentity', { repo, name, email, global }),
  headMessage: (repo: string) => call<string>('repo.headMessage', { repo }),

  stage: (repo: string, paths: string[]) => call<null>('index.stage', { repo, paths }),
  unstage: (repo: string, paths: string[]) => call<null>('index.unstage', { repo, paths }),
  discard: (repo: string, tracked: string[], untracked: string[]) =>
    call<null>('index.discard', { repo, tracked, untracked }),
  applyPatch: (repo: string, patch: string, cached: boolean, reverse: boolean, encoding?: string) =>
    call<null>('index.applyPatch', { repo, patch, cached, reverse, encoding }),
  commitChanges: (repo: string, message: string, amend: boolean) =>
    call<null>('index.commit', { repo, message, amend }),
  resolve: (repo: string, paths: string[], side: 'ours' | 'theirs') =>
    call<null>('index.resolve', { repo, paths, side }),
  abort: (repo: string) => call<null>('op.abort', { repo }),
  continueOp: (repo: string) => call<null>('op.continue', { repo }),

  /** `remoteReset`: check out a remote branch, moving its local namesake onto it first. */
  checkout: (
    repo: string,
    target: string,
    kind: 'branch' | 'remote' | 'remoteReset' | 'detached',
  ) => call<null>('branch.checkout', { repo, target, kind }),
  /** How many commits reachable from `rev` no branch, tag or remote branch contains. */
  unreferenced: (repo: string, rev: string) => call<number>('branch.unreferenced', { repo, rev }),
  createBranch: (repo: string, name: string, start?: string, checkout = true) =>
    call<null>('branch.create', { repo, name, start, checkout }),
  deleteBranch: (repo: string, name: string, force = false) =>
    call<null>('branch.delete', { repo, name, force }),
  renameBranch: (repo: string, old: string, name: string) =>
    call<null>('branch.rename', { repo, old, new: name }),
  setUpstream: (repo: string, branch: string, upstream: string | null) =>
    call<null>('branch.setUpstream', { repo, branch, upstream }),
  deleteRemoteBranch: (repo: string, remote: string, name: string) =>
    call<null>('branch.deleteRemote', { repo, remote, name }),

  /** Move `branch` forward to `target` without checking it out (fast-forward only). */
  fastForward: (repo: string, branch: string, target: string) =>
    call<null>('branch.fastForward', { repo, branch, target }),
  merge: (repo: string, target: string, noFf = false) =>
    call<null>('history.merge', { repo, target, noFf }),
  /** `git merge --squash`: the changes are staged, nothing is committed. */
  mergeSquash: (repo: string, target: string) =>
    call<null>('history.mergeSquash', { repo, target }),
  /** Append `pattern` to the top-level .gitignore; false when it is already there. */
  ignore: (repo: string, pattern: string) => call<boolean>('files.ignore', { repo, pattern }),
  /** Untracked files and folders `git clean` would delete (folders end with `/`). */
  cleanPreview: (repo: string, ignored = false) =>
    call<string[]>('files.cleanPreview', { repo, ignored }),
  clean: (repo: string, paths: string[], ignored = false) =>
    call<null>('files.clean', { repo, paths, ignored }),
  rebase: (repo: string, onto: string) => call<null>('history.rebase', { repo, onto }),
  cherryPick: (repo: string, hash: string, isMerge: boolean) =>
    call<null>('history.cherryPick', { repo, hash, isMerge }),
  revert: (repo: string, hash: string, isMerge: boolean) =>
    call<null>('history.revert', { repo, hash, isMerge }),
  reset: (repo: string, target: string, mode: 'soft' | 'mixed' | 'hard' | 'keep') =>
    call<null>('history.reset', { repo, target, mode }),

  createTag: (repo: string, name: string, target: string, message?: string) =>
    call<null>('tag.create', { repo, name, target, message }),
  deleteTag: (repo: string, name: string) => call<null>('tag.delete', { repo, name }),
  stashSave: (repo: string, message?: string, includeUntracked = true, stagedOnly = false) =>
    call<null>('stash.save', { repo, message, includeUntracked, stagedOnly }),
  /** `git stash push` with options: only `paths`, keep the staged changes (`keepIndex`). */
  stashPush: (
    repo: string,
    o: {
      message?: string;
      includeUntracked?: boolean;
      keepIndex?: boolean;
      paths?: string[];
    },
  ) => call<null>('stash.save', { repo, ...o }),
  /** New branch at the stash's base commit with the stash applied (`git stash branch`). */
  stashBranch: (repo: string, name: string, index: number) =>
    call<null>('stash.branch', { repo, name, index }),
  stashRename: (repo: string, index: number, message: string) =>
    call<null>('stash.rename', { repo, index, message }),
  stashOp: (repo: string, op: 'apply' | 'pop' | 'drop', index: number) =>
    call<null>('stash.op', { repo, op, index }),

  fetch: (repo: string, remote?: string) => call<null>('remote.fetch', { repo, remote }),
  pull: (repo: string, mode?: string, remote?: string) =>
    call<null>('remote.pull', { repo, mode, remote }),
  push: (repo: string, request: T.PushRequest = {}) => call<null>('remote.push', { repo, request }),
  addRemote: (repo: string, name: string, url: string) =>
    call<null>('remote.add', { repo, name, url }),
  removeRemote: (repo: string, name: string) => call<null>('remote.remove', { repo, name }),

  ghAccount: () => call<T.GitHubUser | null>('github.account'),
  ghSignInToken: (token: string) => call<T.GitHubUser>('github.signInToken', { token }),
  ghDeviceStart: (clientId?: string) => call<T.DeviceCode>('github.deviceStart', { clientId }),
  ghDevicePoll: (deviceCode: string, clientId?: string) =>
    call<T.DevicePoll>('github.devicePoll', { deviceCode, clientId }),
  ghSignOut: () => call<null>('github.signOut'),
  ghRepos: (page = 1) => call<T.GitHubRepo[]>('github.repos', { page }),
  ghPulls: (owner: string, repo: string) => call<T.PullRequest[]>('github.pulls', { owner, repo }),
  ghCreatePull: (pr: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
    draft: boolean;
  }) => call<T.PullRequest>('github.createPull', { pr }),
  ghCreateRepo: (name: string, description: string, isPrivate: boolean) =>
    call<T.GitHubRepo>('github.createRepo', { name, description, private: isPrivate }),
};

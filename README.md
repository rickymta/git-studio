# GitStudio

A visual Git client inspired by GitKraken, with GitHub built in. Tauri 2 + React 19 front end, Rust
core that drives the `git` CLI (so hooks, credential helpers, LFS and config behave exactly as in a
terminal).

## Features (v0.1)

- **Repositories**: open, clone (URL or pick from your GitHub repos), init; recent list.
- **Commit graph**: lanes with branch colours, merges, branch/tag badges (local + remote merged),
  WIP row, search by message/author/SHA (Ctrl+F), keyboard navigation, paging for big histories.
- **Working tree**: stage/unstage/discard per file or all, **stage/unstage/discard per hunk**,
  unified or split diff, commit with summary + description, amend, Ctrl+Enter.
- **Branches**: create, checkout (local, remote → tracking branch, detached), rename, delete
  (local and remote), set upstream, ahead/behind counts, folder grouping (`feature/…`).
- **History**: merge (optional `--no-ff`), rebase, cherry-pick, revert, reset soft/mixed/hard.
- **Conflicts**: banner for merge/rebase/cherry-pick/revert in progress, take ours/theirs,
  mark resolved, continue/abort.
- **Remotes**: fetch (prune), pull (merge / rebase / ff-only), push (sets upstream on first push,
  offers force-with-lease when rejected), add/remove remotes, push/delete tags.
- **Stashes**: save (with untracked), apply, pop, drop.
- **GitHub**: sign in with a personal access token or the OAuth device flow; token stored in the OS
  credential store and used automatically for HTTPS git operations against github.com; browse and
  clone your repos; list, open and check out pull requests; create pull requests.

## Development

Requirements: Git, Node 22 + pnpm 9, Rust (stable).

```bash
pnpm install
pnpm tauri dev          # desktop app
```

Browser-only UI against the real backend (handy for UI work):

```bash
pnpm bridge             # HTTP bridge on 127.0.0.1:1421 (debug only)
pnpm dev                # http://localhost:1420
```

Tests:

```bash
cargo test -p gitstudio-core   # integration tests against real temp repositories
pnpm test                      # graph layout and diff parsing
```

Release build: `pnpm tauri build`.

## GitHub sign-in

- **Personal access token** works out of the box (classic: `repo`, `read:org`, `user:email`,
  `workflow`; or fine-grained with Contents + Pull requests read/write).
- **Sign in with browser** uses the OAuth device flow and needs the client ID of a GitHub OAuth App
  with _Enable Device Flow_ ticked. Put it in Settings, or set `GITSTUDIO_GITHUB_CLIENT_ID`.

## Layout

```
crates/gitstudio-core   git + GitHub operations, one `dispatch(cmd, args)` entry point
src-tauri               Tauri shell (one `call` command) and the dev HTTP bridge
src                     React UI (features/, stores/, lib/)
```

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

Local release build: `pnpm tauri build`.

## Releases (GitHub Actions)

- **CI** (`.github/workflows/ci.yml`) does not run on pushes or pull requests; the Release
  workflow runs it on the tagged commit (or start it by hand from the Actions tab):
  version files in sync, `pnpm lint` / `pnpm test` / `pnpm build`, `cargo fmt --check`,
  `cargo clippy -D warnings` and `cargo test` on Windows, macOS and Linux.
- **Release** (`.github/workflows/release.yml`) runs when a `vX.Y.Z` tag on `main` is pushed:
  it re-runs CI on the tagged commit, creates a draft GitHub release (notes from `CHANGELOG.md`),
  builds the installers — Windows `.msi` + `-setup.exe`, macOS `.dmg` (Apple Silicon and Intel),
  Linux `.deb` / `.rpm` / `.AppImage` — uploads them with `SHA256SUMS.txt` and publishes.
  Code signing is optional (`WINDOWS_CERTIFICATE*`, `APPLE_*` secrets); without them the
  installers are unsigned.

Cutting a release:

```bash
pnpm release patch        # or minor | major | x.y.z — bumps the 3 version files, CHANGELOG, commits, tags
git push origin main
git push origin vX.Y.Z    # starts the Release workflow
```

`pnpm release --check` verifies that `package.json`, `src-tauri/tauri.conf.json` and `Cargo.toml`
carry the same version. For the very first release (already at 0.1.0) just tag it:
`git tag -a v0.1.0 -m "GitStudio v0.1.0"`.

## File manager status icons

Like TortoiseGit, GitStudio can badge repository folders in the file manager: green (clean),
orange (changes or commits to push / pull), red (conflicts, unfinished merge / rebase, upstream
deleted). Turn it on in Preferences → File manager icons.

- GitStudio (or `GitStudio --overlay-serve`, started at sign-in) writes `overlay-status.json` in
  the config folder every 5 s; the file-manager extensions only read it, they never run git.
- **Windows**: Explorer overlay DLL (`crates/gitstudio-overlay-win`), registered with an
  administrator prompt. Explorer shows only 15 overlay handlers in total; GitStudio's sort first.
- **macOS**: Finder Sync extension (`macos/finder-sync`), bundled in `GitStudio.app/Contents/PlugIns`.
- **Linux**: extension for Nautilus / Nemo / Caja (`src-tauri/overlay/gitstudio_overlay.py`); the
  python bindings come from the distribution (Preferences offers the command, run with sudo).
- `node scripts/build-overlay.mjs` builds the native piece for the current platform (it also runs
  before `tauri build`); `python scripts/overlay-icons.py` redraws the badges.

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

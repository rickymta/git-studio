# GitStudio

A visual Git client inspired by GitKraken, for Windows, macOS and Linux. Tauri 2 + React 19 front
end, Rust core that drives the `git` CLI, so hooks, credential helpers, LFS and your config behave
exactly as in a terminal. English and Vietnamese interface.

## Install

Download the installer for your platform from the
[Releases](https://github.com/rickymta/git-studio/releases) page:

| Platform | Files                                                                            |
| -------- | -------------------------------------------------------------------------------- |
| Windows  | `GitStudio_x.y.z_windows-x64-setup.exe` or `…_windows-x64.msi`                   |
| macOS    | `GitStudio_x.y.z_macos-aarch64.dmg` (Apple Silicon) or `…_macos-x64.dmg` (Intel) |
| Linux    | `GitStudio_x.y.z_linux-x64.deb`, `.rpm` or `.AppImage`                           |

Git must be installed and on `PATH`. Builds are not code-signed yet: Windows SmartScreen and macOS
Gatekeeper may ask you to confirm the first launch (on macOS: right-click the app → Open, or
`xattr -dr com.apple.quarantine /Applications/GitStudio.app`). `SHA256SUMS.txt` in each release lets
you verify the downloads.

## Features

- **Repositories and workspaces**: open, clone (URL, GitHub or GitLab), init; repository tabs;
  named workspaces that group repositories with an overview of their state.
- **Commit graph**: coloured lanes, merges, branch / tag badges, stashes drawn on the graph, WIP
  row, search (Ctrl+F), keyboard navigation, paging for large histories, resizable columns; Solo,
  Hide and Pin to Left for branches.
- **Commit menu** (like GitKraken): checkout, create branch / worktree / tag, reset
  soft / mixed / hard, revert, cherry-pick, edit message, drop or move a commit up / down,
  merge / rebase, compare with the working directory, create / apply patches, copy links.
- **Working tree**: stage, unstage and discard per file, per hunk or all; commit with summary and
  description, amend, push after committing; stash staged files with a title and description.
- **Diff viewer**: hunk, inline and split views, whitespace options, word wrap, previous / next
  change, blame, file history, and in-place editing that keeps the file's encoding and line endings.
- **Conflicts**: merge / rebase / cherry-pick / revert in progress, take ours or theirs per file,
  conflict editor, continue or abort.
- **Branches and remotes**: tracking branches, ahead / behind counts, fetch (prune), pull
  (merge / rebase / ff-only) and push per remote, force-with-lease when rejected, add / edit remotes
  from a URL, GitHub or GitLab.
- **GitHub and GitLab**: sign in (token or browser), tokens kept in the OS credential store and used
  for HTTPS git; browse and clone your repositories; pull requests; SSH keys; token expiry warnings.
- **Credentials and SSH**: global and per-repository credentials, SSH key management.
- **Built-in terminal**, Activity Logs, keyboard shortcuts, Undo / Redo of git operations.
- **File manager integration**: git status badges on repository folders (green / orange / red, like
  TortoiseGit) and "Open with GitStudio" in the right-click menu, in Explorer, Finder and
  Nautilus / Nemo / Caja.
- **Data and history**: activity history, settings and UI state kept in light files in the config
  folder, with size limits and automatic clean-up (30 days by default).

## File manager integration

Preferences → **File manager icons** turns both on or off (on by default).

- **Status badges**: GitStudio (or `GitStudio --overlay-serve`, started at sign-in) writes
  `overlay-status.json` in the config folder every 5 seconds; the file-manager extensions only read
  it, they never run git. Covered: recent repositories, workspace members and the other
  repositories in the same folders.
  - **Windows**: Explorer overlay handler (`crates/gitstudio-overlay-win`), installed after one
    administrator prompt. Explorer shows only 15 overlay handlers in total; GitStudio's sort first.
  - **macOS**: Finder Sync extension (`macos/finder-sync`), in `GitStudio.app/Contents/PlugIns`;
    enable it in System Settings → Login Items & Extensions if needed.
  - **Linux**: extension for Nautilus / Nemo / Caja (`src-tauri/overlay/gitstudio_overlay.py`). The
    python bindings come from your distribution; Preferences offers the command to install them.
- **"Open with GitStudio"**: right-click a folder (or the empty space inside one). On Windows it is a
  per-user registry entry (on Windows 11, under _Show more options_); on macOS and Linux the
  extensions above add it.

## Development

Requirements: Git, Node 22 + pnpm 9, Rust (stable, edition 2024).

```bash
pnpm install
pnpm tauri dev          # desktop app
```

Browser-only UI against the real backend (handy for UI work):

```bash
pnpm bridge             # HTTP bridge on 127.0.0.1:1421 (debug builds only)
pnpm dev                # http://localhost:1420
```

Checks (the same as CI):

```bash
pnpm lint && pnpm test && pnpm build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace          # integration tests against real temporary repositories
```

`node scripts/build-overlay.mjs` builds the file-manager piece for the current platform (it also
runs before `tauri build`); `python scripts/overlay-icons.py` redraws the status badges.

Local release build: `pnpm tauri build`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions, translations and pull requests.

## Releases (GitHub Actions)

- **Release** (`.github/workflows/release.yml`) runs when a `vX.Y.Z` tag on `main` is pushed: it
  runs CI on the tagged commit, creates a draft GitHub release (notes from `CHANGELOG.md`), builds
  the installers — Windows `.msi` + `-setup.exe`, macOS `.dmg` (Apple Silicon and Intel), Linux
  `.deb` / `.rpm` / `.AppImage` — uploads them with `SHA256SUMS.txt` and publishes. Code signing is
  optional (`WINDOWS_CERTIFICATE*`, `APPLE_*` secrets).
- **CI** (`.github/workflows/ci.yml`) is called by the release (or started by hand from the Actions
  tab): version files in sync, lint / test / build, `cargo fmt`, `cargo clippy -D warnings` and
  `cargo test` on Windows, macOS and Linux, plus the file-manager extension for each platform.

Cutting a release:

```bash
pnpm release patch        # or minor | major | x.y.z: bumps the 3 version files, CHANGELOG, commits, tags
git push origin main
git push origin vX.Y.Z    # starts the Release workflow
```

`pnpm release --check` verifies that `package.json`, `src-tauri/tauri.conf.json` and `Cargo.toml`
carry the same version.

## GitHub sign-in

- **Personal access token** works out of the box (classic: `repo`, `read:org`, `user:email`,
  `workflow`; or fine-grained with Contents + Pull requests read/write).
- **Sign in with browser** uses the OAuth device flow and needs the client ID of a GitHub OAuth App
  with _Enable Device Flow_ ticked. Put it in Preferences, or set `GITSTUDIO_GITHUB_CLIENT_ID`.

## Layout

```
crates/gitstudio-core         git, GitHub / GitLab and app data; one `dispatch(cmd, args)` entry point
crates/gitstudio-overlay-win  Explorer icon-overlay DLL (Windows)
macos/finder-sync             Finder Sync extension (macOS)
src-tauri                     Tauri shell (one `call` command), dev HTTP bridge, bundled resources
src                           React UI (features/, stores/, lib/, locales/)
scripts                       release, overlay build and icon scripts
```

## License

[MIT](LICENSE)

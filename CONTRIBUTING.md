# Contributing to GitStudio

Thanks for helping! Bug reports, ideas and pull requests are all welcome.

## Reporting a problem

Open an issue with:

- GitStudio version (status bar, or Help) and your OS;
- what you did, what you expected and what happened;
- anything useful from **Activity Logs** (status bar) — remove tokens, URLs with credentials and
  personal paths before pasting.

Security issues: please do not open a public issue; use the Help form in the app or contact the
maintainers privately.

## Development setup

Requirements: Git, Node 22 + pnpm 9, Rust stable (edition 2024).

```bash
pnpm install
pnpm tauri dev          # desktop app with hot reload
```

For UI work in a browser against the real backend:

```bash
pnpm bridge             # debug-only HTTP bridge on 127.0.0.1:1421
pnpm dev                # http://localhost:1420
```

Building the file-manager integration for your platform: `node scripts/build-overlay.mjs`
(Windows DLL / macOS Finder extension; Linux has nothing to build).

## Project layout

| Path                           | What lives there                                                   |
| ------------------------------ | ------------------------------------------------------------------ |
| `crates/gitstudio-core`        | All git / GitHub / GitLab / app-data logic; `dispatch(cmd, args)`  |
| `crates/gitstudio-overlay-win` | Explorer icon-overlay DLL                                          |
| `macos/finder-sync`            | Finder Sync extension (badges, "Open with GitStudio")              |
| `src-tauri`                    | Tauri shell (single `call` command), dev bridge, bundled resources |
| `src/features`                 | UI by feature (graph, panel, diff, preferences, …)                 |
| `src/stores`, `src/lib`        | zustand stores; IPC (`lib/ipc.ts`), types, helpers                 |
| `src/locales/vi`               | Vietnamese translations                                            |

The UI never runs git itself: it calls a command in `src/lib/ipc.ts`, which goes through the
Tauri `call` command (or the dev bridge) to `gitstudio_core::dispatch`. A new backend feature
usually means: a function in `crates/gitstudio-core`, a `dispatch` entry in `lib.rs`, a typed
wrapper in `src/lib/ipc.ts` and its types in `src/lib/types.ts`.

## Guidelines

- **Git through the CLI**: the core shells out to `git` so users' hooks, credential helpers and
  config apply. Validate anything that becomes a git argument (`check_rev`, `check_url`) so it
  cannot be read as an option.
- **Cross-platform**: code for one OS goes behind `#[cfg(...)]` and must still compile (and pass
  clippy) on the others. No console windows on Windows (`CREATE_NO_WINDOW`).
- **UI text**: write it in English inside `t('…')`; add the Vietnamese string to the matching file
  in `src/locales/vi/`. Keep labels short and use the same words as Git / GitKraken where possible.
- **Style**: Prettier and ESLint for TypeScript, `rustfmt` (`rustfmt.toml`, width 100) and clippy
  for Rust. Comments explain _why_, not _what_.
- **Tests**: add a core integration test (`crates/gitstudio-core/tests`, real temporary
  repositories) for new git operations, and a vitest test for non-trivial UI logic
  (graph layout, diff parsing, …).

## Before opening a pull request

Run the same checks as CI:

```bash
pnpm lint && pnpm test && pnpm build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
```

- One topic per pull request; describe what changed and how you tested it (screenshots for UI).
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
  `feat(graph): …`, `fix(diff): …`, `docs: …`, `refactor: …`. They become the release notes.
- Do not bump versions or edit `CHANGELOG.md`: `pnpm release` does both when a release is cut.

## Releases (maintainers)

```bash
pnpm release patch        # or minor | major | x.y.z — bumps versions, writes CHANGELOG, commits, tags
git push origin main
git push origin vX.Y.Z    # the Release workflow tests, builds and publishes the installers
```

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).

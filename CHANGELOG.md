# Changelog

Các thay đổi đáng chú ý của GitStudio. File này do `pnpm release` cập nhật.

## v0.3.0 - 2026-11-20

Thay đổi từ v0.2.3.

- test(patch): order the commits by their subject lines, not any "c1" in the patch (4dba24b)
- fix(tabs): switch repository tabs at once and load them in steps (54f29ef)
- feat(graph): act on several picked commits from the right-click menu (8a34f61)

## v0.2.3 - 2026-11-20

Thay đổi từ v0.2.2.

- fix(workspace): a repository opened in a workspace joins it (43038fd)
- fix(graph): mark the checked-out branch with the tick only (ff72d85)

## v0.2.2 - 2026-11-20

Thay đổi từ v0.2.1.

- fix(head): show HEAD only when it is detached off a local branch tip (ce43b8c)

## v0.2.1 - 2026-11-20

Thay đổi từ v0.1.4. Bản v0.2.0 không được phát hành (test bisect lỗi trên CI), nên bản này gồm
toàn bộ thay đổi của v0.2.0 cùng bản sửa đó.

- fix(bisect): find the first bad commit when git does not log it (183e3d6)
- test: component tests for image diff, bisect, maintenance and merge tools (c45df6e)
- refactor: move non-component exports out of component files (10aa0be)
- feat: repository maintenance (4e5eb10)
- feat: image diff (7de57ae)
- feat: external merge and diff tools (d3a7caa)
- feat(bisect): bisect from the commit menu with a progress banner (4010fa5)
- feat(signing): show commit signatures, configure GPG/SSH signing (8eee39c)
- feat(lfs): Git LFS section: tracked patterns, pull/fetch/prune, track from files (3e87c06)
- feat(submodules): list, add, update, sync and deinit submodules (8c1b52c)
- chore(test): keep vitest out of .claude worktrees and target (46990bb)
- feat(git): squash merge, stash options, stash to branch, .gitignore, clean (217190c)
- chore: refresh app icon set from the new app-icon/app-mark artwork (c3e2850)
- feat(diff): stage, unstage and discard single lines (48f120e)
- feat(history): search the whole history with git (0dc0d99)
- feat(history): multi-select commits and interactive rebase (95f7e47)
- feat(compare): compare two commits, branches or tags (5207bd5)
- feat(reflog): HEAD history in the sidebar with lost-commit recovery (4cc7adb)
- feat(avatars): Gravatar pictures for commit authors (f0c1d08)
- feat(workspace): add or clone repositories into the active workspace from anywhere (fb150d6)
- feat(head): show and manage HEAD in the graph, sidebar and toolbar (8793194)
- feat(ui): tree icon for worktrees in the sidebar and branch badges (338d183)
- docs: refresh README; add MIT LICENSE and CONTRIBUTING (856d81f)

## v0.2.0 - 2026-11-20

Không phát hành (test lỗi trên CI); các thay đổi nằm trong v0.2.1.

## v0.1.4 - 2026-11-19

Thay đổi từ v0.1.3.

- feat: "Open with GitStudio" in the file manager's context menu (7c17ee2, 2da7f6f)
- fix(overlay): badges show in Explorer; bigger icons; on by default (d5487fa)
- feat: git status icons on folders in Explorer, Finder and Nautilus/Nemo/Caja (85a6b12)

## v0.1.3 - 2026-11-19

Thay đổi từ v0.1.2.

- fix: final-review fixes before v0.1.3 (e8c03bd)
- fix(graph): annotate branchFocus loop variables so `tsc -b` builds (99af583)
- fix(diff): show the hunk header when focusing a change; keep the current change in view when toggling wrap (3f6f2ec)
- fix(tokens): keep amber/red on hover of the token indicator (3a622d4)
- feat(diff): virtualised Inline/Split/Wrap diff with aligned split rows, auto-focus first change, toolbar tooltips (b22b28c)
- fix(graph): keep search and the column gear in view on a narrow pane (46af000)
- feat(graph): GitKraken-style branch badge hover (b191fc0)
- feat(graph): Column settings menu like GitKraken (f8104e3)
- feat: token expiry in the status bar, with warnings (f305e9a)
- feat(core): read GitHub/GitLab token kind and expiry (db668f6)
- fix(help): send _url and Referer so FormSubmit accepts requests from the app (58882a2)
- feat(help): Help button in the status bar opens a support form sent by email (7eb3f1b)
- feat(theme): softer, more colourful light mode (094c5fa)
- fix(ui): make submenu arrows in menus easy to see (33589e5)
- feat(app): allow only one running instance; a second launch focuses it (a7c3833)
- feat(panel): label the summary and description of the commit message (b2a2df9)
- feat(panel): edit the message of HEAD in place, like GitKraken (5e36ba9)
- fix(installer): refresh the cached app icon on upgrade; use the app icon for setup.exe (e0decd4)
- feat(sidebar): open only Local on launch, other sections start collapsed (f1cbb53)
- feat(core): amend only the message of HEAD (history.amendMessage) (26deeec)

## v0.1.2 - 2026-11-19

Thay đổi từ v0.1.1.

- feat(ui): new app icon and GitStudio mark in the status bar (95433b6)
- fix(terminal): build Windows Terminal font parsing only on Windows (97586ae)
- fix(ui): visible scrollbars, real app version, select the merge result (c128450)
- fix(terminal): use the font configured in Windows Terminal (1741940)

## v0.1.1 - 2026-11-19

Thay đổi từ v0.1.0.

- feat(prefs): core.longpaths on by default (Windows) (9e9cd3b)
- feat(credentials): several accounts per host; choose one per repository or as default (a6f8100)
- feat(prefs): per-user brightness slider for the dark and light themes (8ac3c4d)
- style(theme): dim dark-theme text, icons and borders a further 8% (2dc1ea1)
- feat(graph): GitKraken branch context menu (ccd072c)
- feat(ui): git state icons in sidebar and graph; dimmer dark theme (eb7b3f6)

## v0.1.0 - 2026-11-18

Phát hành đầu tiên.

- Đồ thị commit theo kiểu GitKraken, tab repository, workspace, Undo/Redo
- Stage/unstage theo file và hunk, commit, amend, push sau khi commit
- Trình xem diff (hunk / inline / split), blame, lịch sử file, sửa file giữ nguyên encoding
- Công cụ xử lý conflict, menu chuột phải cho commit, worktree, so sánh với working directory
- GitHub và GitLab.com (đăng nhập, clone, pull request, SSH key), quản lý credentials
- Quản lý remote (thêm từ URL / GitHub / GitLab, sửa tên, URL pull/push), pull/push theo remote
- Terminal trong app, Activity Logs, phím tắt, giao diện tiếng Việt

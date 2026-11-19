# Changelog

Các thay đổi đáng chú ý của GitStudio. File này do `pnpm release` cập nhật.

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

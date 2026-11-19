# Changelog

Các thay đổi đáng chú ý của GitStudio. File này do `pnpm release` cập nhật.

## v0.1.2 - 2026-11-19

Thay đổi từ v0.1.1.

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

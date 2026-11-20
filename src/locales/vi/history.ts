// Vietnamese strings for the "history" group. Keys are the exact English source strings passed to t().
export const history: Record<string, string> = {
  // Commit context menu
  'Pull (fast-forward if possible)': 'Pull (fast-forward nếu được)',
  'Set Upstream': 'Đặt upstream',
  'Checkout {name}': 'Checkout {name}',
  'Checkout this commit (detached)': 'Checkout commit này (detached)',
  'Create worktree from': 'Tạo worktree từ',
  'New branch here…': 'Nhánh mới tại đây…',
  'Start a pull request…': 'Tạo pull request…',
  'Apply patch…': 'Áp dụng patch…',
  'Rename {name}…': 'Đổi tên {name}…',
  'Delete {name} and {remote}': 'Xoá {name} và {remote}',
  'Copy link to this commit on remote': 'Sao chép liên kết tới commit này trên remote',
  'Copy link to branch': 'Sao chép liên kết tới nhánh',
  'Compare commit against working directory': 'So sánh commit với thư mục làm việc',
  'Create annotated tag here': 'Tạo annotated tag tại đây',
  'Create annotated tag': 'Tạo annotated tag',
  Message: 'Nội dung',
  Save: 'Lưu',

  // Edit message / drop commit
  'Edit commit message': 'Sửa nội dung commit',
  'Rewrites {hash} and the commits after it. Avoid this on commits you already pushed.':
    'Viết lại {hash} và các commit sau nó. Tránh làm vậy với commit bạn đã push.',
  'Commit message updated': 'Đã cập nhật nội dung commit',

  // Edit the message of HEAD in the commit panel
  Summary: 'Tiêu đề',
  'No description': 'Không có mô tả',
  'Click to edit the message of this commit': 'Bấm để sửa nội dung commit này',
  'Update Message': 'Cập nhật nội dung',
  'Cancel Amend': 'Huỷ sửa',
  'This commit is already pushed. Updating its message rewrites it; the branch will then need a force push.':
    'Commit này đã được push. Cập nhật nội dung sẽ viết lại commit; sau đó nhánh cần force push.',
  'Amend a pushed commit?': 'Sửa commit đã push?',
  '{hash} is already on {upstream}. Amending rewrites it, so the branch will need a force push afterwards.':
    '{hash} đã có trên {upstream}. Sửa sẽ viết lại commit, nên sau đó nhánh cần force push.',
  'Drop commit': 'Bỏ commit',
  'Remove {hash} "{subject}" from the branch? This rewrites history: the commits after it are recreated and the changes it made are discarded from the branch.':
    'Gỡ {hash} "{subject}" khỏi nhánh? Thao tác này viết lại lịch sử: các commit sau nó được tạo lại và những thay đổi của nó bị loại khỏi nhánh.',
  'Dropped {hash}': 'Đã bỏ {hash}',
  'Delete local branch {name} and {remote}? This affects everyone using the remote.':
    'Xoá nhánh local {name} và {remote}? Việc này ảnh hưởng tới mọi người dùng remote.',
  'Deleted {name} and {remote}': 'Đã xoá {name} và {remote}',

  // Patches
  'Choose a patch file': 'Chọn tệp patch',
  'Apply patch': 'Áp dụng patch',
  'Patch applied': 'Đã áp dụng patch',
  'Create patch from commit': 'Tạo patch từ commit',
  'Create patch': 'Tạo patch',
  'Saves {hash} as a patch file (git format-patch).':
    'Lưu {hash} thành tệp patch (git format-patch).',
  'Save to': 'Lưu vào',
  'Patch saved': 'Đã lưu patch',

  // Links
  'No GitHub or GitLab remote to link to': 'Không có remote GitHub hay GitLab để tạo liên kết',
  'Link copied': 'Đã sao chép liên kết',

  // Compare
  'Comparing {hash} ↔ working directory': 'Đang so sánh {hash} ↔ thư mục làm việc',
  'Stop comparing': 'Dừng so sánh',
  'Changes since this commit': 'Thay đổi kể từ commit này',
  'The working directory matches this commit.': 'Thư mục làm việc giống hệt commit này.',
  'Could not compare with the working directory': 'Không thể so sánh với thư mục làm việc',

  // Worktrees
  Worktrees: 'Worktree',
  'Worktree actions': 'Thao tác worktree',
  'New worktree…': 'Worktree mới…',
  'Prune stale worktrees': 'Dọn worktree cũ',
  'Prune worktrees': 'Dọn worktree',
  'Pruned stale worktrees': 'Đã dọn các worktree cũ',
  'Create worktree': 'Tạo worktree',
  Folder: 'Thư mục',
  'A new folder; leave empty to use the suggested one.':
    'Một thư mục mới; để trống để dùng thư mục được gợi ý.',
  'Choose the parent folder in a dialog': 'Chọn thư mục cha bằng hộp thoại',
  'The worktree folder is created inside the folder you pick.':
    'Thư mục worktree sẽ được tạo bên trong thư mục bạn chọn.',
  'Choose the parent folder for the worktree': 'Chọn thư mục cha cho worktree',
  'New branch name': 'Tên nhánh mới',
  'Only used for a new branch.': 'Chỉ dùng khi tạo nhánh mới.',
  'New branch from HEAD': 'Nhánh mới từ HEAD',
  'Checks out {name} in a separate folder.': 'Checkout {name} trong một thư mục riêng.',
  'Creates a new branch at {ref} and checks it out in a separate folder.':
    'Tạo nhánh mới tại {ref} và checkout nó trong một thư mục riêng.',
  'Checks out a branch in a separate folder, so you can work on two branches at once.':
    'Checkout một nhánh trong thư mục riêng để bạn làm việc trên hai nhánh cùng lúc.',
  'Enter a name for the new branch': 'Hãy nhập tên cho nhánh mới',
  'Created worktree {path}': 'Đã tạo worktree {path}',
  'Open worktree': 'Mở worktree',
  'Open {path} in a new tab?': 'Mở {path} trong tab mới?',
  'Open in new tab': 'Mở trong tab mới',
  'Remove worktree': 'Gỡ worktree',
  'Remove the worktree at {path}? Its folder is deleted; the branch is kept.':
    'Gỡ worktree tại {path}? Thư mục của nó sẽ bị xoá; nhánh vẫn được giữ.',
  'Removed worktree {path}': 'Đã gỡ worktree {path}',
  'Worktree has changes': 'Worktree có thay đổi',
  '{path} has uncommitted changes or is locked. Remove it anyway? Those changes are lost.':
    '{path} có thay đổi chưa commit hoặc đang bị khoá. Vẫn gỡ? Các thay đổi đó sẽ mất.',
  'Force remove': 'Buộc gỡ',
  'Lock worktree': 'Khoá worktree',
  'Unlock worktree': 'Mở khoá worktree',
  Lock: 'Khoá',
  Unlock: 'Mở khoá',
  'Copy path': 'Sao chép đường dẫn',
  'Could not open a terminal': 'Không thể mở terminal',
  bare: 'bare',
  current: 'hiện tại',
  main: 'chính',
  locked: 'đã khoá',
  prunable: 'có thể dọn',

  // Credentials (global)
  Credentials: 'Thông tin đăng nhập',
  'Credential Helper': 'Credential helper',
  'credential.helper in your global Git config: where git keeps usernames and passwords for HTTPS remotes.':
    'credential.helper trong cấu hình Git toàn cục: nơi git lưu tên người dùng và mật khẩu cho các remote HTTPS.',
  'Git Credential Manager': 'Git Credential Manager',
  'Windows Credential Store': 'Kho thông tin đăng nhập Windows',
  'Plain-text store (~/.git-credentials)': 'Lưu dạng văn bản thường (~/.git-credentials)',
  'Not set': 'Chưa đặt',
  'The plain-text store saves passwords unencrypted in your home folder.':
    'Kiểu lưu văn bản thường giữ mật khẩu không mã hoá trong thư mục người dùng của bạn.',
  'Stored Credentials': 'Thông tin đăng nhập đã lưu',
  'Hosts of the open repository’s HTTPS remotes plus GitHub and GitLab. Passwords are never shown.':
    'Các host của remote HTTPS trong repository đang mở, cùng GitHub và GitLab. Mật khẩu không bao giờ được hiển thị.',
  'No HTTPS hosts found.': 'Không tìm thấy host HTTPS nào.',
  'Used by {remotes}': 'Dùng bởi {remotes}',
  Stored: 'Đã lưu',
  'Not stored': 'Chưa lưu',
  Username: 'Tên người dùng',
  'Password or token': 'Mật khẩu hoặc token',
  'Could not save credentials': 'Không thể lưu thông tin đăng nhập',
  'Remove credentials': 'Gỡ thông tin đăng nhập',
  'Could not remove credentials': 'Không thể gỡ thông tin đăng nhập',
  // Several accounts per host
  '{n} stored accounts': '{n} tài khoản đã lưu',
  'Add account…': 'Thêm tài khoản…',
  'Add an account for {host}': 'Thêm tài khoản cho {host}',
  'Update the token of {username} on {host}': 'Cập nhật token của {username} trên {host}',
  'Saved through the credential helper selected above. Several accounts can be stored for one host; choose below which one each repository uses. For GitHub and GitLab use a personal access token as the password.':
    'Được lưu qua credential helper đã chọn ở trên. Một host có thể lưu nhiều tài khoản; chọn bên dưới tài khoản mà từng repository sẽ dùng. Với GitHub và GitLab, hãy dùng personal access token làm mật khẩu.',
  'Saved {username} for {host}': 'Đã lưu {username} cho {host}',
  'Remove the stored password or token of {username} on {host}? Git asks for it again the next time it needs it.':
    'Gỡ mật khẩu/token đã lưu của {username} trên {host}? Git sẽ hỏi lại vào lần tới cần dùng.',
  'Removed {username} from {host}': 'Đã gỡ {username} khỏi {host}',
  'This repository': 'Repository này',
  '{repo} now uses {username} on {host}': '{repo} giờ dùng {username} trên {host}',
  '{username} is now the default account on {host}':
    '{username} giờ là tài khoản mặc định trên {host}',
  'Could not change the account': 'Không thể đổi tài khoản',
  'used by {repo}': '{repo} đang dùng',
  default: 'mặc định',
  'default for all repositories': 'mặc định cho mọi repository',
  'Use for {repo}': 'Dùng cho {repo}',
  'Make default': 'Đặt làm mặc định',
  'Replace the stored password or token': 'Thay mật khẩu/token đã lưu',
  'Update token…': 'Cập nhật token…',
  '{repo} is set to {username}.': '{repo} được đặt dùng {username}.',
  'Use the default account instead': 'Dùng tài khoản mặc định',
  'Every repository without its own choice uses {username}.':
    'Mọi repository chưa chọn riêng sẽ dùng {username}.',
  'Clear the default': 'Bỏ mặc định',
  'Fetch, pull and push here go through the chosen account, not your GitHub sign-in (@{login}).':
    'Fetch, pull và push ở đây dùng tài khoản đã chọn, không dùng tài khoản GitHub đã đăng nhập (@{login}).',
  'Without a chosen account, fetch, pull and push use your GitHub sign-in (@{login}).':
    'Khi chưa chọn tài khoản, fetch, pull và push dùng tài khoản GitHub đã đăng nhập (@{login}).',
  'Could not read stored credentials': 'Không thể đọc thông tin đăng nhập đã lưu',

  // Repository-specific preferences
  'Repository Preferences': 'Tuỳ chọn repository',
  'Settings for {name} only, saved in its .git/config.':
    'Thiết lập chỉ cho {name}, lưu trong .git/config của nó.',
  'Could not read the repository config': 'Không thể đọc cấu hình của repository',
  'Commit Identity': 'Danh tính commit',
  'Global identity: {name} <{email}>': 'Danh tính toàn cục: {name} <{email}>',
  '(no name)': '(chưa có tên)',
  'no email': 'chưa có email',
  'Use a different identity for this repository': 'Dùng danh tính khác cho repository này',
  'user.name for this repository.': 'user.name cho repository này.',
  'user.email for this repository.': 'user.email cho repository này.',
  'Credential Helper (this repository)': 'Credential helper (repository này)',
  'credential.helper for this repository only.': 'credential.helper chỉ cho repository này.',
  'Line Endings (this repository)': 'Ký tự xuống dòng (repository này)',
  'core.autocrlf for this repository only.': 'core.autocrlf chỉ cho repository này.',
  'commit.gpgsign for this repository only. Requires a signing key already configured for git.':
    'commit.gpgsign chỉ cho repository này. Cần có sẵn khoá ký đã cấu hình cho git.',
  'Inherit global ({value})': 'Theo cấu hình toàn cục ({value})',
  'Inherit global (not set)': 'Theo cấu hình toàn cục (chưa đặt)',
  on: 'bật',
  off: 'tắt',
  On: 'Bật',
  Off: 'Tắt',
  'Hard - discard all changes': 'Hard - bỏ toàn bộ thay đổi',
  'Mixed - keep working copy but reset index': 'Mixed - giữ working copy, reset index',
  'Soft - keep all changes': 'Soft - giữ toàn bộ thay đổi',
  'Merge into {branch}': 'Merge vào {branch}',
  'Rebase {branch} onto': 'Rebase {branch} lên',
  'Move commit up': 'Di chuyển commit lên',
  'Move commit down': 'Di chuyển commit xuống',
  'Moved {hash} up': 'Đã di chuyển {hash} lên',
  'Moved {hash} down': 'Đã di chuyển {hash} xuống',
  'Start a pull request from…': 'Tạo pull request từ…',
  'this commit': 'commit này',
  'Pin to Left': 'Ghim sang trái',
  'Unpin from left': 'Bỏ ghim bên trái',
  'Unpin all': 'Bỏ ghim tất cả',
  Solo: 'Chỉ xem nhánh này',
  'Stop solo': 'Bỏ chế độ chỉ xem',
  Hide: 'Ẩn',
  Show: 'Hiện lại',
  'Show all branches': 'Hiện tất cả nhánh',
  'Solo: {names}': 'Chỉ xem: {names}',
  'Hidden: {names}': 'Đang ẩn: {names}',
  'Pinned: {names}': 'Đã ghim: {names}',
  'Copy link to branch: {name}': 'Sao chép link nhánh: {name}',
  'Copy link to this commit on remote: {remote}': 'Sao chép link commit này trên remote: {remote}',
  'Copy stash message': 'Sao chép nội dung stash',
  'Start a pull request to {remote} from {branch}': 'Tạo pull request lên {remote} từ {branch}',
  'Pop stash onto the current checkout': 'Pop stash vào nhánh đang checkout',
  'Pop stash onto {branch}': 'Pop stash vào {branch}',
  'Apply Stash': 'Áp dụng stash',
  'Pop Stash': 'Pop stash',
  'Delete Stash': 'Xoá stash',
  'Edit stash message': 'Sửa nội dung stash',
  'Stage Changes to Stash': 'Stage thay đổi để stash',
  'Staged changes stashed': 'Đã stash các thay đổi đã stage',
  'Stash 1 Staged File': 'Stash 1 file đã stage',
  'Stash {n} Staged Files': 'Stash {n} file đã stage',
  'Stash title': 'Tiêu đề stash',
  '{n} hidden stashes': '{n} stash đang ẩn',

  // Branch context menu (GitKraken layout)
  'Fast-forward {branch} to {target}': 'Fast-forward {branch} tới {target}',
  'Fast-forward': 'Fast-forward',
  'Fast-forwarded {branch} to {target}': 'Đã fast-forward {branch} tới {target}',
  'Open worktree from {name}': 'Mở worktree của {name}',
  'Create worktree from {name}': 'Tạo worktree từ {name}',
  'Create worktree from this commit': 'Tạo worktree từ commit này',
  'Remove this worktree': 'Gỡ worktree này',
  'Remove worktree and delete branch': 'Gỡ worktree và xoá nhánh',
  'Remove the worktree at {path} (its folder is deleted) and delete the branch {name}?':
    'Gỡ worktree tại {path} (thư mục bị xoá) và xoá nhánh {name}?',
  'Pulled {name}': 'Đã pull {name}',
  '{name} has no upstream. Set one first.': '{name} chưa có upstream. Hãy đặt upstream trước.',
  'Merge {source} into {target} (in the worktree {path}).':
    'Merge {source} vào {target} (trong worktree {path}).',
  'Check out {target}, then merge {source} into it.':
    'Checkout {target}, rồi merge {source} vào nhánh đó.',
  'Merged {source} into {target}': 'Đã merge {source} vào {target}',

  // HEAD
  'HEAD (detached) at {hash}': 'HEAD (detached) tại {hash}',
  'Checked out (HEAD)': 'Đang checkout (HEAD)',
  'Go to HEAD (Ctrl+Shift+H)': 'Đi tới HEAD (Ctrl+Shift+H)',
  'Commits not on any branch': 'Có commit không thuộc nhánh nào',
  'HEAD is detached at {hash} and {n} commit(s) there are on no branch or tag. Once you switch away they can only be found in the reflog.':
    'HEAD đang detached tại {hash} và có {n} commit không thuộc nhánh hay tag nào. Sau khi chuyển đi, chỉ còn tìm lại được chúng qua reflog.',
  'Before switching': 'Trước khi chuyển',
  'Create a branch at HEAD to keep them': 'Tạo nhánh tại HEAD để giữ lại',
  'Switch anyway': 'Vẫn chuyển',
  '{local} has commits that {remote} does not have yet': '{local} có commit mà {remote} chưa có',
  'The local branch {local} is behind {remote}.': 'Nhánh local {local} đang đi sau {remote}.',
  'The local branch {local} and {remote} have diverged.':
    'Nhánh local {local} và {remote} đã rẽ hướng khác nhau.',
  'The local branch {local} points to a different commit than {remote}.':
    'Nhánh local {local} trỏ tới commit khác với {remote}.',
  'Local branch {local}': 'Nhánh local {local}',
  'Fast-forward {local} to {remote}': 'Fast-forward {local} tới {remote}',
  'Check out {local} as it is': 'Checkout {local} như hiện tại',
  'Reset {local} to {remote} (drops its own commits)':
    'Reset {local} về {remote} (bỏ các commit riêng của nó)',
  'Reset {local} to {remote}': 'Reset {local} về {remote}',
  'Commits on {local} that are not on {remote} will be left only in the reflog. Uncommitted changes are kept.':
    'Các commit của {local} không có trên {remote} sẽ chỉ còn trong reflog. Thay đổi chưa commit được giữ nguyên.',
  'Reset and check out': 'Reset và checkout',

  // Compare two commits / branches
  Compare: 'So sánh',
  'Compare {base} → {target}': 'So sánh {base} → {target}',
  'Mark as compare base': 'Đánh dấu làm mốc so sánh',
  '{name} marked as compare base': 'Đã đánh dấu {name} làm mốc so sánh',
  'Right-click another commit or branch and choose Compare.':
    'Nhấn chuột phải vào commit hoặc nhánh khác rồi chọn So sánh.',
  'Swap sides': 'Đổi chiều',
  '{ahead} commit(s) only on {target}, {behind} only on {base}':
    '{ahead} commit chỉ có ở {target}, {behind} chỉ có ở {base}',
  '{n} files changed': '{n} file thay đổi',
  'Both sides have the same files.': 'Hai bên có nội dung file giống nhau.',
};

// Submodules, LFS, signatures, bisect, merge tools, image diff, maintenance.
export const tools: Record<string, string> = {
  // Submodules
  Submodules: 'Submodule',
  'Submodule actions': 'Thao tác submodule',
  'No submodules.': 'Không có submodule.',
  'Add submodule': 'Thêm submodule',
  'Add submodule…': 'Thêm submodule…',
  'Update all submodules': 'Cập nhật tất cả submodule',
  'Sync URLs from .gitmodules': 'Đồng bộ URL từ .gitmodules',
  'Update {n} out-of-date submodule(s)': 'Cập nhật {n} submodule chưa khớp',
  'Up to date': 'Đã khớp',
  'Not initialised': 'Chưa khởi tạo',
  'Checked out at another commit than recorded': 'Đang checkout commit khác commit đã ghi nhận',
  'Merge conflict': 'Xung đột merge',
  'Open submodule': 'Mở submodule',
  'Initialise and update': 'Khởi tạo và cập nhật',
  'Update to recorded commit': 'Cập nhật về commit đã ghi nhận',
  'Copy path': 'Sao chép đường dẫn',
  'Copy URL': 'Sao chép URL',
  'Show in file manager': 'Mở trong trình quản lý file',
  'Deinitialise…': 'Huỷ khởi tạo…',
  'Deinitialise submodule': 'Huỷ khởi tạo submodule',
  Deinitialise: 'Huỷ khởi tạo',
  'Empty the folder {path} and stop checking it out? Local changes in it are lost; Update brings it back.':
    'Làm trống thư mục {path} và ngừng checkout nó? Thay đổi chưa commit trong đó sẽ mất; dùng Cập nhật để lấy lại.',
  'Deinitialised {name}': 'Đã huỷ khởi tạo {name}',
  'Updated {name}': 'Đã cập nhật {name}',
  'Submodules updated': 'Đã cập nhật các submodule',
  'Submodule URLs synced': 'Đã đồng bộ URL submodule',
  'Clones the repository into a folder of this one; commit to record it.':
    'Clone repository vào một thư mục của repo này; commit để ghi nhận.',
  'Repository URL': 'URL repository',
  'Folder (relative to the repository)': 'Thư mục (tương đối so với repository)',
  'Branch to follow (optional)': 'Nhánh theo dõi (không bắt buộc)',
  'Added submodule {name}': 'Đã thêm submodule {name}',

  // Git LFS
  'Git LFS': 'Git LFS',
  'LFS actions': 'Thao tác LFS',
  'Track pattern…': 'Theo dõi mẫu…',
  'Track with LFS': 'Lưu bằng LFS',
  'Track with LFS…': 'Lưu bằng LFS…',
  'Files matching the pattern are stored with Git LFS from now on. The pattern goes into .gitattributes; commit it.':
    'Từ giờ các file khớp mẫu được lưu bằng Git LFS. Mẫu được ghi vào .gitattributes; hãy commit file đó.',
  Pattern: 'Mẫu',
  Track: 'Theo dõi',
  '{pattern} is tracked with LFS': '{pattern} đã được lưu bằng LFS',
  '{pattern} is no longer tracked with LFS': '{pattern} không còn được lưu bằng LFS',
  'Git LFS is set up for this repository': 'Đã thiết lập Git LFS cho repository này',
  'LFS files downloaded': 'Đã tải các file LFS',
  'LFS objects fetched': 'Đã fetch các object LFS',
  'Old LFS objects pruned': 'Đã dọn các object LFS cũ',
  'Download LFS files (pull)': 'Tải file LFS (pull)',
  'Fetch LFS objects': 'Fetch object LFS',
  'Prune old LFS objects': 'Dọn object LFS cũ',
  'Set up LFS for this repository': 'Thiết lập LFS cho repository này',
  'No patterns tracked with LFS.': 'Chưa có mẫu nào lưu bằng LFS.',
  'Tracked patterns': 'Các mẫu được theo dõi',
  'Stop tracking with LFS': 'Ngừng lưu bằng LFS',
  'Copy pattern': 'Sao chép mẫu',
  '{n} file(s) are only pointers: download them': '{n} file mới chỉ là con trỏ: tải về',

  // Commit signing
  'Commit signing': 'Ký commit',
  Verified: 'Đã xác minh',
  'Signed with a trusted key.': 'Được ký bằng khoá tin cậy.',
  Signed: 'Đã ký',
  'Valid signature, but the key is not marked as trusted.':
    'Chữ ký hợp lệ nhưng khoá chưa được đánh dấu tin cậy.',
  'Expired signature': 'Chữ ký hết hạn',
  'The signature or its key has expired.': 'Chữ ký hoặc khoá ký đã hết hạn.',
  'Revoked key': 'Khoá đã bị thu hồi',
  'Signed with a key that has been revoked.': 'Được ký bằng khoá đã bị thu hồi.',
  'Bad signature': 'Chữ ký sai',
  'The signature does not match this commit.': 'Chữ ký không khớp với commit này.',
  'Signed (unverified)': 'Đã ký (chưa xác minh)',
  'Signed, but it could not be checked here: the key is missing, or for SSH signatures gpg.ssh.allowedSignersFile is not set.':
    'Đã ký nhưng không kiểm tra được ở đây: thiếu khoá, hoặc với chữ ký SSH thì chưa đặt gpg.ssh.allowedSignersFile.',
  Signer: 'Người ký',
  Key: 'Khoá',
  'Could not read signing settings': 'Không đọc được cài đặt ký',
  'Open a repository to change signing settings.': 'Mở một repository để đổi cài đặt ký.',
  'Signing settings saved': 'Đã lưu cài đặt ký',
  'Could not save signing settings': 'Không lưu được cài đặt ký',
  'Settings for': 'Áp dụng cho',
  'This repository': 'Repository này',
  'All repositories': 'Mọi repository',
  'Saved in this repository; it overrides the settings for all repositories.':
    'Lưu trong repository này; ghi đè cài đặt chung cho mọi repository.',
  'Saved in your global git config.': 'Lưu trong cấu hình git toàn cục của bạn.',
  Sign: 'Ký',
  'Sign every commit': 'Ký mọi commit',
  'Sign annotated tags': 'Ký annotated tag',
  'Signature type': 'Kiểu chữ ký',
  'Not set (GPG)': 'Chưa đặt (GPG)',
  'SSH key': 'Khoá SSH',
  'Signing key': 'Khoá ký',
  'Key ID, e.g. 3AA5C34371567BD2': 'Key ID, vd 3AA5C34371567BD2',
  'Path to your public key (or the key itself). To verify SSH signatures, git also needs gpg.ssh.allowedSignersFile.':
    'Đường dẫn tới public key (hoặc chính key). Để xác minh chữ ký SSH, git còn cần gpg.ssh.allowedSignersFile.',
  'Empty: GPG picks the key matching your commit email.':
    'Để trống: GPG tự chọn khoá khớp email commit của bạn.',

  // Bisect
  Bisect: 'Bisect',
  'Start bisect: this commit is bad': 'Bắt đầu bisect: commit này lỗi',
  'Start bisect: this commit is good': 'Bắt đầu bisect: commit này tốt',
  'Mark as good': 'Đánh dấu tốt',
  'Mark as bad': 'Đánh dấu lỗi',
  'Skip this commit': 'Bỏ qua commit này',
  'End bisect': 'Kết thúc bisect',
  'Show commit': 'Xem commit',
  Good: 'Tốt',
  Bad: 'Lỗi',
  Skip: 'Bỏ qua',
  'Found it: {hash} "{subject}" is the first bad commit.':
    'Đã tìm thấy: {hash} "{subject}" là commit lỗi đầu tiên.',
  'Bisecting: mark a commit that works (good) to start the search.':
    'Đang bisect: đánh dấu một commit chạy đúng (tốt) để bắt đầu tìm.',
  'Bisecting: mark a commit that has the problem (bad) to start the search.':
    'Đang bisect: đánh dấu một commit bị lỗi để bắt đầu tìm.',
  'Bisecting: testing {hash}. About {n} revision(s) left (~{steps} step(s)).':
    'Đang bisect: kiểm tra {hash}. Còn khoảng {n} commit (~{steps} bước).',

  // Image diff
  'Side by side': 'Cạnh nhau',
  Swipe: 'Trượt',
  'Onion skin': 'Chồng lớp',
  'Swipe position': 'Vị trí trượt',
  Opacity: 'Độ mờ',
  Before: 'Trước',
  After: 'Sau',
  'No file before this change': 'Chưa có file trước thay đổi này',
  'The file was deleted': 'File đã bị xoá',
  'Too large to preview ({size})': 'Quá lớn để xem trước ({size})',
  Image: 'Ảnh',

  // Maintenance
  'Repository maintenance…': 'Bảo trì repository…',
  'Repository maintenance': 'Bảo trì repository',
  'Keep the object database small and fast, and check it for corruption.':
    'Giữ kho object gọn nhẹ, nhanh và kiểm tra lỗi hỏng dữ liệu.',
  Packed: 'Đã đóng gói',
  Loose: 'Rời',
  Garbage: 'Rác',
  '{n} object(s) in {packs} pack(s)': '{n} object trong {packs} pack',
  '{n} object(s)': '{n} object',
  '{n} file(s), {p} prunable': '{n} file, {p} có thể dọn',
  'Garbage collect': 'Thu gom rác',
  'Pack loose objects and remove old unreachable ones (git gc).':
    'Đóng gói object rời và xoá object cũ không còn tham chiếu (git gc).',
  'Aggressive GC': 'GC triệt để',
  'Recompress everything and drop all unreachable objects now. Slow on big repositories.':
    'Nén lại toàn bộ và xoá ngay mọi object không còn tham chiếu. Chậm với repository lớn.',
  Repack: 'Đóng gói lại',
  'Put all objects into a single pack (git repack -a -d).':
    'Gom mọi object vào một pack (git repack -a -d).',
  Prune: 'Dọn object',
  'Delete unreachable loose objects older than two weeks (git prune).':
    'Xoá object rời không còn tham chiếu cũ hơn hai tuần (git prune).',
  'Write commit-graph': 'Ghi commit-graph',
  'Speeds up history, graph and blame on large repositories.':
    'Tăng tốc lịch sử, đồ thị và blame với repository lớn.',
  'Pack refs': 'Đóng gói ref',
  'Store branch and tag refs in one file (git pack-refs --all).':
    'Lưu ref của branch và tag trong một file (git pack-refs --all).',
  'Check integrity': 'Kiểm tra toàn vẹn',
  'Verify every object and report corruption or missing objects (git fsck --full).':
    'Kiểm tra mọi object, báo object hỏng hoặc bị thiếu (git fsck --full).',
  Run: 'Chạy',
  '{task}: done': '{task}: xong',
  '{task}: failed': '{task}: lỗi',
  '(no output)': '(không có output)',

  // External merge / diff tools
  'Merge tool': 'Merge tool',
  'Diff tool': 'Diff tool',
  'Open in merge tool': 'Mở trong merge tool',
  'Open in diff tool': 'Mở trong diff tool',
  '{path} resolved': 'Đã giải quyết {path}',
  'Could not save the tool': 'Không lưu được tool',
  'Not set (git picks one)': 'Chưa đặt (git tự chọn)',
  'Found on this computer': 'Có trên máy này',
  'Other tools git supports': 'Các tool khác git hỗ trợ',
  'Opened by “Open in merge tool” on a conflicted file (git config merge.tool).':
    'Được mở bằng “Mở trong merge tool” trên file xung đột (git config merge.tool).',
  'Opened by “Open in diff tool” on a changed file (git config diff.tool).':
    'Được mở bằng “Mở trong diff tool” trên file thay đổi (git config diff.tool).',
};

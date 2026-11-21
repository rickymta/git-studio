// Vietnamese strings for the Launchpad. Keys are the exact English source strings passed to t().
export const launchpad: Record<string, string> = {
  Launchpad: 'Launchpad',
  'Launchpad (Ctrl+Shift+K)': 'Launchpad (Ctrl+Shift+K)',
  'Your pull requests, issues and uncommitted work in one place':
    'Pull request, issue và thay đổi chưa commit của bạn ở cùng một chỗ',
  '{n} waiting for you (review requests and assigned)':
    '{n} việc đang chờ bạn (nhờ review và được giao)',

  // Tabs
  'My pull requests': 'Pull request của tôi',
  'Review requests': 'Nhờ tôi review',
  'My issues': 'Issue của tôi',
  WIPs: 'WIP',
  Branches: 'Nhánh',
  Snoozed: 'Đã tạm ẩn',
  'Save a view': 'Lưu view',
  'Saves the current search and filters as a tab of its own.':
    'Lưu từ khoá tìm kiếm và bộ lọc hiện tại thành một tab riêng.',
  'Delete view': 'Xoá view',

  // Toolbar and filters
  'Collapse all': 'Thu gọn tất cả',
  'Expand all': 'Mở rộng tất cả',
  'Search (/)': 'Tìm kiếm (/)',
  'Refresh (R)': 'Làm mới (R)',
  'All hosts': 'Mọi host',
  'Involves me': 'Liên quan tới tôi',
  'Everything that involves me': 'Mọi thứ liên quan tới tôi',
  '{n} filters': '{n} bộ lọc',
  'Repositories that WIPs and Branches look at': 'Các repository mà WIP và Nhánh quét',
  'Workspace “{name}”': 'Workspace “{name}”',
  'Every workspace': 'Mọi workspace',
  'Open tabs': 'Các tab đang mở',
  'Could not load from {host}': 'Không tải được từ {host}.',
  'Keys: J/K move · Enter open · P pin · S snooze a day · M merge · B branch from issue · / search · R refresh':
    'Phím: J/K di chuyển · Enter mở · P ghim · S tạm ẩn một ngày · M merge · B tạo nhánh từ issue · / tìm · R làm mới',

  // Reasons
  Authored: 'Tôi tạo',
  Assigned: 'Giao cho tôi',
  'Review requested': 'Nhờ tôi review',
  Mentioned: 'Nhắc tới tôi',

  // Sections
  Pinned: 'Đã ghim',
  'Waiting for your review': 'Đang chờ bạn review',
  'Ready to merge': 'Sẵn sàng merge',
  'Waiting on others': 'Đang chờ người khác',
  Drafts: 'Bản nháp',
  Issues: 'Issue',

  // Table
  Age: 'Tuổi',
  Status: 'Trạng thái',
  Item: 'Mục',
  Collaborators: 'Cộng tác viên',
  'Repo / branch': 'Repo / nhánh',
  Action: 'Thao tác',
  'Open issue': 'Issue đang mở',
  'Checks passed': 'Kiểm tra đã qua',
  'Checks failed': 'Kiểm tra thất bại',
  'Checks running': 'Đang chạy kiểm tra',
  'Has conflicts': 'Có xung đột',
  'No conflicts': 'Không xung đột',
  'Merge blocked': 'Chưa thể merge',
  Approved: 'Đã duyệt',
  'Changes requested': 'Yêu cầu sửa',
  'Review required': 'Cần review',
  Comments: 'Bình luận',
  Reactions: 'Biểu cảm',
  'Opened {date}, updated {updated}': 'Mở lúc {date}, cập nhật {updated}',
  'More actions': 'Thao tác khác',

  // Actions
  'Merge…': 'Merge…',
  'Create a branch': 'Tạo nhánh',
  'Create a branch for {ref}': 'Tạo nhánh cho {ref}',
  'In {name}, from the checked-out branch ({branch}).':
    'Trong {name}, từ nhánh đang checkout ({branch}).',
  'Check it out': 'Checkout luôn',
  'Created branch {name}': 'Đã tạo nhánh {name}',
  'Could not create the branch': 'Không tạo được nhánh',
  'Open {name}': 'Mở {name}',
  'Not cloned in this scope': 'Chưa clone trong phạm vi này',
  '{project} is not cloned in this scope': '{project} chưa được clone trong phạm vi này',
  'Add its clone to the workspace, or switch the Launchpad to every workspace.':
    'Thêm bản clone của nó vào workspace, hoặc chuyển Launchpad sang mọi workspace.',
  Pin: 'Ghim',
  Unpin: 'Bỏ ghim',
  Snooze: 'Tạm ẩn',
  Unsnooze: 'Bỏ tạm ẩn',
  'For an hour': 'Trong một giờ',
  'Until tomorrow': 'Đến ngày mai',
  'For a week': 'Trong một tuần',
  'Until it changes': 'Đến khi có thay đổi',
  'Drafts cannot be merged': 'Không thể merge bản nháp',
  'Mark it ready for review first.': 'Hãy đánh dấu sẵn sàng review trước.',
  'Open in terminal': 'Mở trong terminal',
  'View repo': 'Xem repo',

  // Empty states
  'No pull requests': 'Không có pull request',
  'Connect a hosting service to see your pull requests and issues here.':
    'Kết nối một dịch vụ lưu trữ để xem pull request và issue của bạn tại đây.',
  'Coming later': 'Sắp có',
  'Nothing here. You are all caught up.': 'Không có gì. Bạn đã xử lý hết.',
  'Nothing is snoozed.': 'Không có mục nào đang tạm ẩn.',
  'No uncommitted work in these repositories.':
    'Không có thay đổi chưa commit trong các repository này.',
  'Every checked-out branch is in step with its upstream.':
    'Mọi nhánh đang checkout đều khớp với upstream.',

  // WIPs and branches
  'WIP on {name}': 'WIP trên {name}',
  '{n} conflicted': '{n} xung đột',
  '{n} behind': 'chậm {n}',
  '{n} unpushed': '{n} chưa push',
  'Never pushed (no upstream)': 'Chưa từng push (không có upstream)',
  'Fast-forward only: never creates a merge commit':
    'Chỉ fast-forward: không bao giờ tạo merge commit',
};

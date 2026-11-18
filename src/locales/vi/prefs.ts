// Vietnamese strings for the "prefs" group. Keys are the exact English source strings passed to t().
export const prefs: Record<string, string> = {
  // Shell and sections
  'Exit Preferences': 'Thoát Tuỳ chọn',
  Account: 'Tài khoản',
  'Connect GitHub': 'Kết nối GitHub',
  Preferences: 'Tuỳ chọn',
  General: 'Chung',
  Profile: 'Hồ sơ',
  SSH: 'SSH',
  Integrations: 'Tích hợp',
  'UI Customization': 'Giao diện',
  'External Tools': 'Công cụ ngoài',
  Import: 'Nhập dữ liệu',
  'GitKraken Desktop was not found on this computer.':
    'Không tìm thấy GitKraken Desktop trên máy này.',

  // Shared helpers
  'Could not save preferences': 'Không lưu được tuỳ chọn',
  'Could not set {key}': 'Không đặt được {key}',
  Browse: 'Chọn…',
  'Not set': 'Chưa đặt',

  // General
  'Git was not found on PATH': 'Không tìm thấy git trong PATH',
  'Auto-Fetch Interval': 'Chu kỳ tự động fetch',
  'In minutes, between 0 and 60 (0 disables auto-fetch). Fetches the remotes of the open repository in the background.':
    'Tính bằng phút, từ 0 đến 60 (0 để tắt tự động fetch). Fetch các remote của repository đang mở ở chế độ nền.',
  'Auto-Prune': 'Tự động prune',
  'Remove remote-tracking branches that were deleted on the remote when fetching.':
    'Khi fetch, xoá các nhánh remote-tracking đã bị xoá trên remote.',
  'Default Branch Name': 'Tên nhánh mặc định',
  'Initial branch name when creating new repositories.':
    'Tên nhánh đầu tiên khi tạo repository mới.',
  'Pull Strategy': 'Cách pull',
  'What the Pull button does when your branch and its upstream have both changed.':
    'Hành vi của nút Pull khi cả nhánh của bạn và upstream của nó đều có thay đổi.',
  'Merge (fast-forward if possible)': 'Merge (fast-forward nếu được)',
  Rebase: 'Rebase',
  'Fast-forward only': 'Chỉ fast-forward',
  'Initial Commits in Graph': 'Số commit ban đầu trong đồ thị',
  'Minimum 500. More commits load when you scroll to the end of the graph.':
    'Tối thiểu 500. Các commit tiếp theo được tải khi bạn cuộn tới cuối đồ thị.',
  'Increasing this value may slow down large repositories.':
    'Tăng giá trị này có thể làm chậm các repository lớn.',
  'Remember Tabs': 'Nhớ các tab',
  'Reopen the repository tabs of your last session.':
    'Mở lại các tab repository của phiên làm việc trước.',
  'Default Clone Folder': 'Thư mục clone mặc định',
  'Default clone folder': 'Thư mục clone mặc định',
  'Git Executable': 'Tệp thực thi Git',
  'GitStudio runs the git found on PATH, so hooks, credential helpers and LFS behave as in your terminal.':
    'GitStudio chạy git tìm thấy trong PATH, nên hook, credential helper và LFS hoạt động giống như trong terminal của bạn.',
  Longpaths: 'Đường dẫn dài',
  'Sets core.longpaths in your global Git config. Windows only supports paths under 260 characters without it.':
    'Đặt core.longpaths trong cấu hình Git toàn cục. Nếu không bật, Windows chỉ hỗ trợ đường dẫn dưới 260 ký tự.',
  'Line Endings': 'Ký tự xuống dòng',
  'core.autocrlf in your global Git config.': 'core.autocrlf trong cấu hình Git toàn cục.',
  'Not set (Git default)': 'Chưa đặt (mặc định của Git)',
  'true — CRLF in working tree, LF in repo': 'true — CRLF trong working tree, LF trong repo',
  'input — convert CRLF to LF on commit': 'input — chuyển CRLF thành LF khi commit',
  'false — never convert': 'false — không bao giờ chuyển đổi',

  // Profile
  'Author Name': 'Tên tác giả',
  'user.name in your global Git config; used for every commit.':
    'user.name trong cấu hình Git toàn cục; dùng cho mọi commit.',
  'Author Email': 'Email tác giả',
  'user.email in your global Git config. Use an email GitHub knows so commits link to your account.':
    'user.email trong cấu hình Git toàn cục. Hãy dùng email mà GitHub biết để commit được liên kết với tài khoản của bạn.',
  'Sign Commits': 'Ký commit',
  'commit.gpgsign in your global Git config. Requires a signing key already configured for git.':
    'commit.gpgsign trong cấu hình Git toàn cục. Cần có sẵn signing key đã cấu hình cho git.',

  // SSH
  'Could not read SSH settings': 'Không đọc được cấu hình SSH',
  'Could not save SSH settings': 'Không lưu được cấu hình SSH',
  'Generated {name}': 'Đã tạo {name}',
  'Could not generate key': 'Không tạo được key',
  Authentication: 'Xác thực',
  'Using {version}': 'Đang dùng {version}',
  'Use local SSH setup': 'Dùng cấu hình SSH của máy',
  '~/.ssh/config, default keys and ssh-agent — exactly what `git` in a terminal uses. Best for passphrase-protected keys loaded in an agent.':
    '~/.ssh/config, các key mặc định và ssh-agent — đúng như `git` trong terminal sử dụng. Phù hợp nhất với key có passphrase đã nạp vào agent.',
  'Use a specific key': 'Dùng một key cụ thể',
  'GitStudio passes this key to git for every SSH remote.':
    'GitStudio truyền key này cho git với mọi remote SSH.',
  'SSH Private Key': 'SSH private key',
  'SSH private key': 'SSH private key',
  'SSH Public Key': 'SSH public key',
  'SSH public key': 'SSH public key',
  'Public Key': 'Public key',
  'Test Connection': 'Kiểm tra kết nối',
  "Connects to git@github.com with the settings above. Accepts GitHub's host key on first use.":
    'Kết nối tới git@github.com với cấu hình ở trên. Tự chấp nhận host key của GitHub trong lần dùng đầu tiên.',
  'Test GitHub SSH': 'Kiểm tra SSH tới GitHub',
  'Authenticated as {user}': 'Đã xác thực với tên {user}',
  'Not authenticated': 'Chưa xác thực',
  'Remote URLs': 'URL remote',
  'Use SSH instead of HTTPS URLs when cloning or adding GitHub repositories.':
    'Dùng URL SSH thay cho HTTPS khi clone hoặc thêm repository GitHub.',
  'Keys in ~/.ssh': 'Key trong ~/.ssh',
  'No keys found.': 'Không tìm thấy key nào.',
  'Public key copied': 'Đã sao chép public key',
  Copy: 'Sao chép',
  'In use': 'Đang dùng',
  Use: 'Dùng',
  'Generate New Key': 'Tạo key mới',
  'Creates an ed25519 key pair in ~/.ssh and switches GitStudio to it. Then add the public key to GitHub (Integrations or the button on the key).':
    'Tạo cặp key ed25519 trong ~/.ssh và chuyển GitStudio sang dùng key đó. Sau đó hãy thêm public key lên GitHub (mục Tích hợp hoặc nút trên key).',
  'File name': 'Tên tệp',
  Comment: 'Ghi chú',
  Passphrase: 'Passphrase',
  Optional: 'Không bắt buộc',
  'GitStudio cannot type a passphrase for git. Load the key into ssh-agent and use the local SSH setup.':
    'GitStudio không thể nhập passphrase thay cho git. Hãy nạp key vào ssh-agent và dùng cấu hình SSH của máy.',
  'Generate key': 'Tạo key',
  'Copy public key': 'Sao chép public key',
  'Key added to GitHub': 'Đã thêm key lên GitHub',
  'Could not add the key to GitHub': 'Không thêm được key lên GitHub',
  'Add to GitHub': 'Thêm lên GitHub',

  // Integrations
  'Connected to GitHub as {login}': 'Đã kết nối GitHub với tài khoản {login}',
  'Could not reuse existing credentials': 'Không dùng lại được thông tin đăng nhập có sẵn',
  'Disconnect GitHub': 'Ngắt kết nối GitHub',
  'Remove the stored GitHub token from this computer?': 'Xoá token GitHub đã lưu khỏi máy này?',
  Disconnect: 'Ngắt kết nối',
  'Token Permissions': 'Quyền của token',
  'Fine-grained token: permissions are set per repository on GitHub.':
    'Fine-grained token: quyền được đặt theo từng repository trên GitHub.',
  'This token cannot manage SSH keys (admin:public_key). Reconnect with a token that has it to add keys from GitStudio.':
    'Token này không quản lý được SSH key (admin:public_key). Hãy kết nối lại bằng token có scope này để thêm key từ GitStudio.',
  Recheck: 'Kiểm tra lại',
  'SSH Keys on GitHub': 'SSH key trên GitHub',
  'Keys marked “this computer” match a key in your ~/.ssh folder.':
    'Các key được đánh dấu “máy này” trùng với một key trong thư mục ~/.ssh của bạn.',
  'No SSH keys on your account.': 'Tài khoản của bạn chưa có SSH key nào.',
  'added {date}': 'thêm ngày {date}',
  'this computer': 'máy này',
  'Delete {title}': 'Xoá {title}',
  'Delete SSH key': 'Xoá SSH key',
  'Delete “{title}” from your GitHub account? Machines using it will lose SSH access.':
    'Xoá “{title}” khỏi tài khoản GitHub của bạn? Các máy đang dùng key này sẽ mất quyền truy cập SSH.',
  Delete: 'Xoá',
  'Could not delete key': 'Không xoá được key',
  Connect: 'Kết nối',
  'The token is stored in the Windows Credential Manager and used for GitHub API calls and HTTPS git operations.':
    'Token được lưu trong Windows Credential Manager và dùng cho các lệnh gọi GitHub API cũng như thao tác git qua HTTPS.',
  'Sign in with browser or token…': 'Đăng nhập qua trình duyệt hoặc token…',
  'Use GitHub CLI login (gh)': 'Dùng đăng nhập của GitHub CLI (gh)',
  'Use Git Credential Manager login': 'Dùng đăng nhập của Git Credential Manager',
  'OAuth App Client ID': 'Client ID của OAuth App',
  'Needed only for “Sign in with browser”. Create an OAuth App on GitHub (Settings → Developer settings → OAuth Apps), tick “Enable Device Flow”, and paste its Client ID.':
    'Chỉ cần cho “Đăng nhập qua trình duyệt”. Hãy tạo một OAuth App trên GitHub (Settings → Developer settings → OAuth Apps), chọn “Enable Device Flow”, rồi dán Client ID của nó vào đây.',
  'Create one': 'Tạo mới',
  'Add a key from this computer:': 'Thêm key từ máy này:',
  'Added {name} to GitHub': 'Đã thêm {name} lên GitHub',

  // UI customization
  Language: 'Ngôn ngữ',
  Theme: 'Chủ đề',
  Dark: 'Tối',
  Light: 'Sáng',
  Zoom: 'Thu phóng',
  'Ctrl + / Ctrl − / Ctrl 0 anywhere in the app.':
    'Ctrl + / Ctrl − / Ctrl 0 ở bất kỳ đâu trong ứng dụng.',
  'File List': 'Danh sách tệp',
  'How changed files are listed in the right panel.':
    'Cách liệt kê các tệp thay đổi ở bảng bên phải.',
  'Path — full path on one line': 'Đường dẫn — đường dẫn đầy đủ trên một dòng',
  'Tree — grouped by folder': 'Cây — nhóm theo thư mục',

  // External tools
  'External Editor': 'Trình soạn thảo ngoài',
  'Command that opens a file or folder, e.g. code, cursor, subl, idea64. Used by “Open in editor”.':
    'Lệnh mở một tệp hoặc thư mục, ví dụ code, cursor, subl, idea64. Được dùng bởi “Mở trong trình soạn thảo”.',
  Terminal: 'Terminal',
  'Opened by the Terminal button in the toolbar and in workspaces.':
    'Được mở bởi nút Terminal trên thanh công cụ và trong workspace.',
  'Automatic (Windows Terminal, else Command Prompt)':
    'Tự động (Windows Terminal, nếu không có thì Command Prompt)',
  'Command Prompt': 'Command Prompt',

  // GitHub sign-in dialog
  'Signed in to GitHub as {login}': 'Đã đăng nhập GitHub với tài khoản {login}',
  'GitHub sign-in failed': 'Đăng nhập GitHub thất bại',
  'Token rejected': 'Token bị từ chối',
  'Could not reuse existing login': 'Không dùng lại được phiên đăng nhập có sẵn',
  'Connect to GitHub': 'Kết nối tới GitHub',
  'GitStudio uses your GitHub account to clone private repositories, push and pull over HTTPS, and work with pull requests. The token is kept in the OS credential store.':
    'GitStudio dùng tài khoản GitHub của bạn để clone repository riêng tư, push và pull qua HTTPS, và làm việc với pull request. Token được lưu trong kho thông tin đăng nhập của hệ điều hành.',
  'Sign in with browser': 'Đăng nhập qua trình duyệt',
  'Browser sign-in needs a GitHub OAuth App client ID (with device flow enabled) in Preferences → Integrations. Until then, use one of the options below.':
    'Đăng nhập qua trình duyệt cần Client ID của một GitHub OAuth App (đã bật Device Flow) trong Tuỳ chọn → Tích hợp. Trong lúc chưa có, bạn hãy dùng một trong các cách bên dưới.',
  'Already signed in elsewhere on this computer?': 'Đã đăng nhập ở nơi khác trên máy này?',
  'Use a personal access token': 'Dùng personal access token',
  'Enter this code on GitHub (it is already in your clipboard):':
    'Nhập mã này trên GitHub (mã đã có sẵn trong clipboard của bạn):',
  'Open {url}': 'Mở {url}',
  'Waiting for you to approve…': 'Đang chờ bạn phê duyệt…',
  'Create a token with the {scopes} scopes (classic), or a fine-grained token with Contents and Pull requests read/write.':
    'Tạo token (classic) với các scope {scopes}, hoặc fine-grained token có quyền đọc/ghi Contents và Pull requests.',
  'Create a token on GitHub': 'Tạo token trên GitHub',
  Back: 'Quay lại',
  'Activity history file': 'File lịch sử hoạt động',
  'Activity history is {size} MB': 'Lịch sử hoạt động đang là {size} MB',
  'At the size limit: the oldest entries are being dropped':
    'Đã chạm giới hạn: các mục cũ nhất đang bị xoá',
  'Clear history': 'Xoá lịch sử',
  'Data & History': 'Dữ liệu & lịch sử',
  'Delete all history': 'Xoá toàn bộ lịch sử',
  'Delete every entry of the activity history? This cannot be undone.':
    'Xoá toàn bộ lịch sử hoạt động? Không thể hoàn tác.',
  'Delete history after (days)': 'Tự xoá lịch sử sau (ngày)',
  'Entries loaded at startup': 'Số mục tải khi khởi động',
  'Every operation (pull, push, commit, …) is appended to this file and read back when GitStudio starts.':
    'Mọi thao tác (pull, push, commit, …) được ghi thêm vào file này và đọc lại khi GitStudio khởi động.',
  'Lower the retention period or clear it in Preferences → Data & History.':
    'Giảm thời gian lưu hoặc xoá bớt trong Tuỳ chọn → Dữ liệu & lịch sử.',
  'Maximum size (MB)': 'Dung lượng tối đa (MB)',
  'Older entries are removed when GitStudio starts. 0 keeps everything.':
    'Các mục cũ hơn sẽ bị xoá khi GitStudio khởi động. Đặt 0 để giữ tất cả.',
  'Only the most recent entries are loaded, so startup stays fast.':
    'Chỉ tải các mục gần nhất để khởi động vẫn nhanh.',
  'Over the warning size': 'Vượt ngưỡng cảnh báo',
  'Past this size the oldest entries are dropped automatically.':
    'Vượt quá dung lượng này, các mục cũ nhất sẽ tự động bị xoá.',
  'Warn when larger than (MB)': 'Cảnh báo khi lớn hơn (MB)',
  '{size} · {n} entries': '{size} · {n} mục',
};

// Vietnamese strings for the "integrations" group. Keys are the exact English source strings passed to t().
export const integrations: Record<string, string> = {
  // in-app terminal
  '[Process exited]': '[Tiến trình đã kết thúc]',
  'Could not start terminal': 'Không thể khởi động terminal',
  'Close terminal': 'Đóng terminal',
  'New terminal': 'Terminal mới',
  'Hide terminal': 'Ẩn terminal',
  'Kill All Terminals': 'Dừng tất cả terminal',
  'End every terminal session of this repository?':
    'Kết thúc mọi phiên terminal của repository này?',
  'Kill All': 'Dừng tất cả',
  'Close terminal panel': 'Đóng bảng terminal',
  'Toggle terminal (Ctrl+`)': 'Bật/tắt terminal (Ctrl+`)',
  'Open external terminal': 'Mở terminal bên ngoài',
  'Terminal options': 'Tuỳ chọn terminal',

  // GitLab
  'Connected to GitLab as {login}': 'Đã kết nối GitLab với tài khoản {login}',
  'Could not connect to GitLab': 'Không thể kết nối GitLab',
  'Create a token with the api, read_repository and write_repository scopes.':
    'Tạo một token có các quyền api, read_repository và write_repository.',
  'Create a token on GitLab.com': 'Tạo token trên GitLab.com',
  'Connect to GitLab.com': 'Kết nối GitLab.com',
  'The token is stored in the Windows Credential Manager.':
    'Token được lưu trong Windows Credential Manager.',
  'Disconnect GitLab': 'Ngắt kết nối GitLab',
  'Remove the stored GitLab token from this computer?':
    'Xoá token GitLab đã lưu khỏi máy tính này?',
  'Could not disconnect GitLab': 'Không thể ngắt kết nối GitLab',
  'Connect GitLab.com to browse and clone your projects. The token is stored in the Windows Credential Manager.':
    'Kết nối GitLab.com để duyệt và clone các project của bạn. Token được lưu trong Windows Credential Manager.',

  // Preferences → Integrations
  Connected: 'Đã kết nối',
  'SSH Key': 'SSH key',
  'Remove and Delete': 'Gỡ và xoá',

  // clone dialog
  'Clone a Repository': 'Clone một repository',
  'Clone with URL': 'Clone bằng URL',
  '{provider} is not connected': 'Chưa kết nối {provider}',
  'Connect to {provider}': 'Kết nối {provider}',
  'Clone a Repo': 'Clone repository',
  'Where to clone to': 'Clone vào thư mục',
  'Repository to clone': 'Repository cần clone',
  'Full path': 'Đường dẫn đầy đủ',
  'folder name': 'tên thư mục',
  Options: 'Tuỳ chọn',
  'Shallow Clone': 'Shallow clone',
  'Download only the latest commit of each branch.': 'Chỉ tải commit mới nhất của mỗi nhánh.',
  'Sparse Checkout': 'Sparse checkout',
  'Check out only the top-level files; add folders later.':
    'Chỉ checkout các tệp ở thư mục gốc; bạn có thể thêm thư mục sau.',
  'Clone the repo!': 'Clone repository!',
  'Search Remotes': 'Tìm repository',
};

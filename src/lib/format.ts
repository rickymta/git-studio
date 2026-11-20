export function relativeTime(unixSeconds: number, now = Date.now() / 1000): string {
  const d = Math.max(0, now - unixSeconds);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d ago`;
  if (d < 86400 * 365) return `${Math.floor(d / (86400 * 30))}mo ago`;
  return `${Math.floor(d / (86400 * 365))}y ago`;
}

export function fullDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}

export const short = (hash: string) => hash.slice(0, 7);

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Stable hue per author for avatar circles. */
export function hue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export const basename = (p: string) => p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p;

export function dirname(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  parts.pop();
  return parts.join('/');
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir.replace(/[\\/]+$/, '') + sep + name;
}

/** Repo folder name from a clone URL. */
export function repoNameFromUrl(url: string): string {
  const last = url.trim().replace(/\/+$/, '').split(/[/:]/).pop() ?? '';
  return last.replace(/\.git$/, '');
}

/** `1536` → `1.5 KB`. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

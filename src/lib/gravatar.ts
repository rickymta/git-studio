// Gravatar pictures for commit authors: https://gravatar.com/avatar/<sha256 of the email>.
// `d=404` makes unknown emails fail, so the caller keeps showing initials for them.

/** Email hashes already worked out, so remounted rows (the graph is virtualised) draw at once. */
const resolved = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();
/** Picture URLs that failed to load (no Gravatar, offline): not asked for again this session. */
const failed = new Set<string>();
/** Picture URLs that loaded, so a remounted avatar shows them without waiting. */
const loaded = new Set<string>();

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The hash Gravatar expects, or `null` when there is no usable email or no Web Crypto. */
export function gravatarHash(email: string): Promise<string | null> {
  const key = normalizeEmail(email);
  if (!key.includes('@') || typeof crypto === 'undefined' || !crypto.subtle)
    return Promise.resolve(null);
  const done = resolved.get(key);
  if (done) return Promise.resolve(done);
  let p = pending.get(key);
  if (!p) {
    p = sha256Hex(key).then(
      (h) => {
        resolved.set(key, h);
        return h;
      },
      () => null,
    );
    pending.set(key, p);
  }
  return p;
}

/** Hash already known for `email` (no waiting), if any. */
export const knownHash = (email: string) => resolved.get(normalizeEmail(email)) ?? null;

/** Picture URL for a hash, sized in a few steps (sharp on HiDPI, shared by nearby sizes). */
export function gravatarUrl(hash: string, size: number): string {
  const px = size <= 20 ? 40 : size <= 32 ? 64 : 96;
  return `https://www.gravatar.com/avatar/${hash}?s=${px}&d=404`;
}

export const markFailed = (url: string) => void failed.add(url);
export const markLoaded = (url: string) => void loaded.add(url);
export const hasFailed = (url: string) => failed.has(url);
export const hasLoaded = (url: string) => loaded.has(url);

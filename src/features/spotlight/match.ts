// Spotlight's matching and ranking: pure, so it can be tested without the UI.

import type { Commit, GitRef, Stash } from '@/lib/types';

/**
 * How well `text` matches `query` (higher is better), or null for no match. Case-insensitive.
 * Whole text > prefix > word start > substring > letters in order (fuzzy, "fbr" → "feature/bar").
 */
export function score(text: string, query: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const s = text.toLowerCase();
  if (s === q) return 1000;
  if (s.startsWith(q)) return 800 - Math.min(200, s.length - q.length);
  const at = s.indexOf(q);
  if (at > 0) {
    const wordStart = /[\s/_.\-:([]/.test(s[at - 1]!);
    return (wordStart ? 600 : 400) - Math.min(200, at);
  }
  // Letters in order; tighter runs score higher.
  let i = 0;
  let gaps = 0;
  let last = -1;
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (s[j] === q[i]) {
      if (last >= 0) gaps += j - last - 1;
      last = j;
      i++;
    }
  }
  if (i < q.length || q.length < 2) return null;
  return Math.max(1, 200 - gaps * 4);
}

/** A file path: the name counts more than the folders. */
export function scorePath(path: string, query: string): number | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const byName = score(name, query);
  const byPath = query.includes('/') ? score(path, query) : null;
  if (byName !== null) return byName + 100;
  if (byPath !== null) return byPath;
  // Words anywhere in the path ("hooks auth" → src/hooks/useAuth.ts).
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = path.toLowerCase();
  if (words.length > 1 && words.every((w) => lower.includes(w))) return 150;
  return lower.includes(query.trim().toLowerCase()) ? 120 : null;
}

export const looksLikeSha = (q: string) => /^[0-9a-f]{4,40}$/i.test(q.trim());

export type Hit =
  | { kind: 'action'; id: string; label: string; detail: string; score: number }
  | { kind: 'branch'; ref: GitRef; score: number }
  | { kind: 'tag'; ref: GitRef; score: number }
  | { kind: 'commit'; commit: Commit; score: number }
  | { kind: 'file'; path: string; score: number }
  | { kind: 'stash'; stash: Stash; score: number };

export type HitKind = Hit['kind'];

/** Key of a hit, unique within one result list. */
export function hitKey(h: Hit): string {
  switch (h.kind) {
    case 'action':
      return `a:${h.id}`;
    case 'branch':
    case 'tag':
      return `r:${h.ref.fullName}`;
    case 'commit':
      return `c:${h.commit.hash}`;
    case 'file':
      return `f:${h.path}`;
    case 'stash':
      return `s:${h.stash.hash}`;
  }
}

/** Matching loaded commits, newest first: message, author or SHA prefix. Stops at `max`. */
export function matchCommits(commits: Commit[], query: string, max: number): Hit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const sha = looksLikeSha(q);
  const out: Hit[] = [];
  for (const c of commits) {
    if (c.stash) continue;
    let s: number | null = null;
    if (sha && c.hash.startsWith(q)) s = 900;
    else {
      const subject = c.subject.toLowerCase();
      const at = subject.indexOf(q);
      if (at >= 0) s = at === 0 ? 500 : 350;
      else if (c.authorName.toLowerCase().includes(q)) s = 250;
      else if ((c.body ?? '').toLowerCase().includes(q)) s = 150;
    }
    if (s !== null) {
      out.push({ kind: 'commit', commit: c, score: s });
      if (out.length >= max) break;
    }
  }
  return out;
}

export function matchRefs(refs: GitRef[], query: string): Hit[] {
  const out: Hit[] = [];
  for (const ref of refs) {
    if (ref.kind === 'remote' && ref.name.endsWith('/HEAD')) continue;
    const s = score(ref.name, query);
    if (s === null) continue;
    // The checked-out branch and local branches first, then remote ones.
    const bonus = ref.isHead ? 60 : ref.kind === 'local' ? 30 : 0;
    out.push(
      ref.kind === 'tag'
        ? { kind: 'tag', ref, score: s }
        : { kind: 'branch', ref, score: s + bonus },
    );
  }
  return out.sort((a, b) => b.score - a.score);
}

export function matchFiles(files: string[], query: string, max: number): Hit[] {
  if (!query.trim()) return [];
  const out: Extract<Hit, { kind: 'file' }>[] = [];
  for (const path of files) {
    const s = scorePath(path, query);
    if (s !== null) out.push({ kind: 'file', path, score: s });
  }
  return out.sort((a, b) => b.score - a.score || a.path.length - b.path.length).slice(0, max);
}

export function matchStashes(stashes: Stash[], query: string): Hit[] {
  const out: Hit[] = [];
  for (const stash of stashes) {
    const s = score(stash.message, query) ?? score(stash.name, query);
    if (s !== null) out.push({ kind: 'stash', stash, score: s });
  }
  return out.sort((a, b) => b.score - a.score);
}

export interface Group {
  kind: HitKind | 'top';
  hits: Hit[];
}

/** Per-group caps, in the order groups are shown. */
export const GROUPS: { kind: HitKind; max: number }[] = [
  { kind: 'branch', max: 6 },
  { kind: 'commit', max: 8 },
  { kind: 'file', max: 8 },
  { kind: 'tag', max: 4 },
  { kind: 'stash', max: 4 },
  { kind: 'action', max: 7 },
];

/**
 * Groups of hits, Spotlight-style: the best hit overall first ("Top hit"), then each kind, capped,
 * best first, without repeating the top hit.
 */
export function group(hits: Hit[], withTop: boolean): Group[] {
  const groups: Group[] = [];
  let top: Hit | null = null;
  if (withTop && hits.length) {
    top = hits.reduce((a, b) => (b.score > a.score ? b : a));
    groups.push({ kind: 'top', hits: [top] });
  }
  for (const g of GROUPS) {
    const list = hits
      .filter((h) => h.kind === g.kind && h !== top)
      .sort((a, b) => b.score - a.score)
      .slice(0, g.max);
    if (list.length) groups.push({ kind: g.kind, hits: list });
  }
  return groups;
}

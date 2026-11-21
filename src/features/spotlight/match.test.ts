import { describe, expect, it } from 'vitest';

import type { Commit, GitRef } from '@/lib/types';
import { group, hitKey, matchCommits, matchFiles, matchRefs, score, scorePath } from './match';

const ref = (name: string, kind: GitRef['kind'] = 'local', isHead = false): GitRef => ({
  fullName: `refs/${kind}/${name}`,
  name,
  kind,
  target: 'abc',
  isHead,
  upstream: null,
  ahead: 0,
  behind: 0,
  upstreamGone: false,
  remote: null,
});

const commit = (hash: string, subject: string, author = 'An'): Commit => ({
  hash,
  parents: [],
  authorName: author,
  authorEmail: '',
  authorTime: 0,
  committerName: author,
  commitTime: 0,
  subject,
});

describe('spotlight matching', () => {
  it('ranks whole > prefix > word start > substring > fuzzy', () => {
    const q = 'auth';
    const s = (t: string) => score(t, q)!;
    expect(s('auth')).toBeGreaterThan(s('authority'));
    expect(s('authority')).toBeGreaterThan(s('feature/auth-login'));
    expect(s('feature/auth-login')).toBeGreaterThan(s('reauthorize'));
    expect(s('reauthorize')).toBeGreaterThan(score('a-u-t-h', q)!);
    expect(score('xyz', q)).toBeNull();
    expect(score('feature/bar', 'fbr')).not.toBeNull();
  });

  it('weighs a file name above its folders', () => {
    expect(scorePath('src/auth/index.ts', 'index')!).toBeGreaterThan(
      scorePath('src/index-helpers/a.ts', 'index')!,
    );
    expect(scorePath('src/hooks/useAuth.ts', 'hooks auth')).not.toBeNull();
    expect(
      matchFiles(['a/b/Login.tsx', 'login/x.ts', 'z.ts'], 'login', 5).map((h) => h.kind),
    ).toEqual(['file', 'file']);
  });

  it('finds loaded commits by SHA prefix, subject and author', () => {
    const list = [commit('abcdef1', 'Fix login'), commit('1234567', 'Add API', 'Binh')];
    expect(matchCommits(list, 'abcd', 10).map((h) => hitKey(h))).toEqual(['c:abcdef1']);
    expect(matchCommits(list, 'login', 10)).toHaveLength(1);
    expect(matchCommits(list, 'binh', 10)).toHaveLength(1);
    expect(matchCommits(list, 'x', 10)).toEqual([]);
  });

  it('puts the checked-out and local branches before remote ones, skipping remote HEAD', () => {
    const hits = matchRefs(
      [
        ref('origin/main', 'remote'),
        ref('origin/HEAD', 'remote'),
        ref('main', 'local', true),
        ref('v1', 'tag'),
      ],
      'main',
    );
    expect(hits.map((h) => hitKey(h))).toEqual(['r:refs/local/main', 'r:refs/remote/origin/main']);
  });

  it('groups with a top hit that is not repeated', () => {
    const hits = matchRefs([ref('main'), ref('maintenance')], 'main');
    const groups = group(hits, true);
    expect(groups.map((g) => g.kind)).toEqual(['top', 'branch']);
    expect(groups[0]!.hits[0]!).toBe(hits[0]);
    expect(groups[1]!.hits).toEqual([hits[1]]);
  });
});

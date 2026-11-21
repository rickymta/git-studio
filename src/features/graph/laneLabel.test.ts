import type { GitRef } from '@/lib/types';
import { laneBranch, mergedBranch } from './laneLabel';

const ref = (name: string, kind: GitRef['kind'], target = 't'): GitRef => ({
  fullName: name,
  name,
  kind,
  target,
  isHead: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  upstreamGone: false,
  remote: kind === 'remote' ? name.split('/')[0]! : null,
});

describe('mergedBranch', () => {
  it('reads the branch from default merge messages', () => {
    expect(mergedBranch("Merge branch 'feature/login' into develop")).toBe('feature/login');
    expect(mergedBranch("Merge branch 'fix' into 'main'")).toBe('fix');
    expect(mergedBranch('Merge pull request #172 from meddental/feature/no-xray')).toBe(
      'feature/no-xray',
    );
    expect(mergedBranch("Merge remote-tracking branch 'origin/develop'")).toBe('origin/develop');
    expect(mergedBranch('feat: add login')).toBeNull();
  });
});

describe('laneBranch', () => {
  const refs = new Map([['t', [ref('origin/develop', 'remote'), ref('develop', 'local')]]]);
  const subjects = new Map([['m', "Merge branch 'feature/x' into develop"]]);
  const at = (h: string) => refs.get(h);
  const subj = (h: string) => subjects.get(h);

  it('names the branch at the tip, local first', () => {
    expect(laneBranch({ hash: 't', merge: false }, at, subj)).toBe('develop');
    expect(laneBranch({ hash: 'none', merge: false }, at, subj)).toBeNull();
  });

  it('names the branch a merge brought in', () => {
    expect(laneBranch({ hash: 'm', merge: true }, at, subj)).toBe('feature/x');
    expect(laneBranch(null, at, subj)).toBeNull();
  });
});

import { gravatarHash, gravatarUrl, hasFailed, knownHash, markFailed } from './gravatar';

const HASH = '84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee';

describe('gravatar', () => {
  it('hashes the trimmed, lower-cased email with SHA-256', async () => {
    expect(await gravatarHash('  MyEmailAddress@Example.com ')).toBe(HASH);
    // Cached for remounted rows.
    expect(knownHash('myemailaddress@example.com')).toBe(HASH);
  });

  it('skips values that are not emails', async () => {
    expect(await gravatarHash('')).toBeNull();
    expect(await gravatarHash('not-an-email')).toBeNull();
  });

  it('asks for a 404 instead of a default picture, in a few sizes', () => {
    expect(gravatarUrl(HASH, 16)).toBe(`https://www.gravatar.com/avatar/${HASH}?s=40&d=404`);
    expect(gravatarUrl(HASH, 21)).toContain('s=64');
    expect(gravatarUrl(HASH, 40)).toContain('s=96');
  });

  it('remembers pictures that failed to load', () => {
    const url = gravatarUrl(HASH, 28);
    expect(hasFailed(url)).toBe(false);
    markFailed(url);
    expect(hasFailed(url)).toBe(true);
  });
});

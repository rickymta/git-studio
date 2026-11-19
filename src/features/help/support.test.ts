import { describe, expect, it } from 'vitest';

import { emptyForm, isValidEmail, LIMITS, toRequest, validate, type SupportForm } from './support';

const filled = (over: Partial<SupportForm> = {}): SupportForm => ({
  name: ' An ',
  email: ' an@example.com ',
  topic: 'bug',
  subject: 'Crash on open',
  message: 'Steps…',
  includeSystem: true,
  ...over,
});

describe('support form', () => {
  it('checks email format', () => {
    for (const ok of ['a@b.co', 'first.last+tag@sub.example.org', '  a@b.co  ']) {
      expect(isValidEmail(ok)).toBe(true);
    }
    // Same rule as the Rust check, so the server never rejects what the form accepted.
    for (const bad of ['', 'a', 'a@', '@b.co', 'a@b', 'a b@c.co', 'a@b@c.co', 'a@b.c.', 'a@.co']) {
      expect(isValidEmail(bad)).toBe(false);
    }
  });

  it('requires every field of an empty form', () => {
    expect(Object.keys(validate(emptyForm())).sort()).toEqual(
      ['email', 'message', 'name', 'subject', 'topic'].sort(),
    );
  });

  it('accepts a filled form and flags a bad email or overlong text', () => {
    expect(validate(filled())).toEqual({});
    expect(validate(filled({ email: 'nope' }))).toEqual({ email: 'Enter a valid email address.' });
    expect(validate(filled({ subject: '   ' }))).toEqual({ subject: 'This field is required.' });
    expect(validate(filled({ message: 'x'.repeat(LIMITS.message + 1) }))).toEqual({
      message: 'Too long.',
    });
  });

  it('builds a trimmed request, with the version only when system info is attached', () => {
    expect(toRequest(filled(), '0.1.2')).toEqual({
      name: 'An',
      email: 'an@example.com',
      topic: 'bug',
      subject: 'Crash on open',
      message: 'Steps…',
      includeSystem: true,
      appVersion: '0.1.2',
    });
    const r = toRequest(filled({ includeSystem: false }), '0.1.2');
    expect(r.includeSystem).toBe(false);
    expect(r.appVersion).toBeUndefined();
  });
});

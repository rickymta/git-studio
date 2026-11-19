// Help form model: fields, validation and the request sent to `support.send`.
// Limits and the email check mirror crates/gitstudio-core/src/support.rs.

import type { SupportRequest, SupportTopic } from '@/lib/types';

export const TOPICS: { value: SupportTopic; label: string }[] = [
  { value: 'bug', label: 'Bug report' },
  { value: 'feature', label: 'Feature request' },
  { value: 'question', label: 'Question' },
  { value: 'other', label: 'Other' },
];

export const LIMITS = { name: 100, subject: 200, message: 10_000 } as const;

export interface SupportForm {
  name: string;
  email: string;
  topic: SupportTopic | '';
  subject: string;
  message: string;
  includeSystem: boolean;
}

export type FieldName = 'name' | 'email' | 'topic' | 'subject' | 'message';
/** English source strings (pass through `t()` to show them). */
export type FormErrors = Partial<Record<FieldName, string>>;

export const emptyForm = (): SupportForm => ({
  name: '',
  email: '',
  topic: '',
  subject: '',
  message: '',
  includeSystem: true,
});

/** Loose `local@domain.tld` check; the same rule as `valid_email` in `support.rs`. */
export function isValidEmail(s: string): boolean {
  const v = s.trim();
  const at = v.indexOf('@');
  if (at <= 0 || /\s/.test(v)) return false;
  const domain = v.slice(at + 1);
  if (domain.includes('@')) return false;
  const dot = domain.lastIndexOf('.');
  return dot > 0 && dot < domain.length - 1;
}

export function validate(f: SupportForm): FormErrors {
  const e: FormErrors = {};
  const tooLong = (v: string, max: number) => v.trim().length > max;
  if (!f.name.trim()) e.name = 'This field is required.';
  else if (tooLong(f.name, LIMITS.name)) e.name = 'Too long.';
  if (!f.email.trim()) e.email = 'This field is required.';
  else if (!isValidEmail(f.email)) e.email = 'Enter a valid email address.';
  if (!f.topic) e.topic = 'Choose a topic.';
  if (!f.subject.trim()) e.subject = 'This field is required.';
  else if (tooLong(f.subject, LIMITS.subject)) e.subject = 'Too long.';
  if (!f.message.trim()) e.message = 'This field is required.';
  else if (tooLong(f.message, LIMITS.message)) e.message = 'Too long.';
  return e;
}

/** The request for a form that passed `validate`. */
export function toRequest(f: SupportForm, appVersion: string): SupportRequest {
  return {
    name: f.name.trim(),
    email: f.email.trim(),
    topic: f.topic || 'other',
    subject: f.subject.trim(),
    message: f.message.trim(),
    includeSystem: f.includeSystem,
    appVersion: f.includeSystem ? appVersion : undefined,
  };
}

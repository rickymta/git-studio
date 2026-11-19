// Splitting a full commit message into the summary/description fields and back.

/** Summary length guideline shown as a countdown next to summary fields. */
export const SUMMARY_MAX = 72;

/** `"subject\n\nbody"` → `{ summary: 'subject', description: 'body' }`. */
export function splitMessage(message: string): { summary: string; description: string } {
  const [first = '', ...rest] = message.replace(/\r\n/g, '\n').split('\n');
  return { summary: first.trim(), description: rest.join('\n').trim() };
}

/** The message git gets: the summary, then a blank line and the description when there is one. */
export function joinMessage(summary: string, description: string): string {
  const s = summary.trim();
  const d = description.trim();
  return d ? `${s}\n\n${d}` : s;
}

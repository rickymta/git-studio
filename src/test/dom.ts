// Minimal React rendering helpers for component tests (run them with `@vitest-environment jsdom`).
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Root[] = [];

/** Render `ui` into a fresh element in `document.body` and let its effects run. */
export async function render(ui: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  await act(async () => root.render(ui));
  await settle();
  return { container, rerender: (next: ReactNode) => act(async () => root.render(next)) };
}

/** Unmount everything `render` mounted (call in `afterEach`). */
export async function cleanup() {
  for (const root of mounted.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = '';
}

/** Let pending promises (mocked IPC calls) resolve and React re-render. */
export async function settle() {
  for (let i = 0; i < 3; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

export async function click(el: Element | null | undefined) {
  if (!el) throw new Error('click: no element');
  await act(async () => (el as HTMLElement).click());
  await settle();
}

/** Set the value of an input or select the way a user would, firing React's onChange. */
export async function change(el: Element | null | undefined, value: string) {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement))
    throw new Error('change: not an input or select');
  const proto = Object.getPrototypeOf(el) as object;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  await act(async () => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

/** The button whose text is exactly `text`. */
export function button(text: string, root: ParentNode = document.body): HTMLButtonElement {
  const b = [...root.querySelectorAll('button')].find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`No button "${text}"`);
  return b;
}

/** Whole visible text of `root`, whitespace collapsed. */
export function text(root: ParentNode = document.body): string {
  return (root.textContent ?? '').replace(/\s+/g, ' ');
}

// ---- GitStudio's Select (components/controls.tsx, Radix) ------------------------------------------

/** jsdom lacks a few element methods Radix's popper and pointer handling call. */
function polyfillRadix() {
  const p = Element.prototype as unknown as Record<string, unknown>;
  p.scrollIntoView ??= () => {};
  p.hasPointerCapture ??= () => false;
  p.releasePointerCapture ??= () => {};
}

function key(el: Element, k: string) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

/** Open a Select from its trigger (as the keyboard does) and return its options. */
export async function openSelect(trigger: Element | null | undefined): Promise<HTMLElement[]> {
  if (!trigger) throw new Error('openSelect: no trigger');
  polyfillRadix();
  await act(async () => {
    (trigger as HTMLElement).focus();
    key(trigger, 'Enter');
  });
  await settle();
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
}

/** Choose the option whose value is `value` in a Select. */
export async function pick(trigger: Element | null | undefined, value: string) {
  const option = (await openSelect(trigger)).find((o) => o.dataset.value === value);
  if (!option) throw new Error(`pick: no option "${value}"`);
  await act(async () => key(option, 'Enter'));
  await settle();
}

/** The current value of a Select trigger. */
export const selectValue = (trigger: Element) => trigger.getAttribute('data-value') ?? '';

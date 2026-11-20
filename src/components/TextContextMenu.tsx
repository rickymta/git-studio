import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';

type Target = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

interface MenuState {
  x: number;
  y: number;
  /** The text field right-clicked, if any. */
  field: Target | null;
  /** Text selected when the menu opened. */
  selection: string;
}

const TEXT_INPUTS = new Set(['text', 'search', 'url', 'email', 'password', 'number', 'tel', '']);

function editableTarget(el: EventTarget | null): Target | null {
  if (!(el instanceof HTMLElement)) return null;
  const field = el.closest<HTMLElement>('input, textarea, [contenteditable="true"]');
  if (!field) return null;
  if (field instanceof HTMLInputElement && !TEXT_INPUTS.has(field.type)) return null;
  if ((field as HTMLInputElement).readOnly || (field as HTMLInputElement).disabled) return null;
  return field;
}

function selectedText(field: Target | null): string {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const { selectionStart: a, selectionEnd: b, value } = field;
    return a != null && b != null && b > a ? value.slice(a, b) : '';
  }
  return window.getSelection()?.toString() ?? '';
}

/**
 * Replaces the webview's own right-click menu (Back, Reload, Inspect…): text fields get
 * Cut / Copy / Paste / Select all, selected text gets Copy, and elsewhere nothing shows. Menus
 * the app draws itself (Radix context menus) handle the event first and are left alone.
 */
export function TextContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      if (e.defaultPrevented) return; // an app menu took it
      // Developers can still reach the inspector with Shift+right-click in dev builds.
      if (import.meta.env.DEV && e.shiftKey) return;
      e.preventDefault();
      const field = editableTarget(e.target);
      const selection = selectedText(field);
      if (!field && !selection) {
        setMenu(null);
        return;
      }
      setMenu({ x: e.clientX, y: e.clientY, field, selection });
    };
    window.addEventListener('contextmenu', onContext);
    return () => window.removeEventListener('contextmenu', onContext);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close);
    };
  }, [menu]);

  // Keep the menu on screen.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!menu || !ref.current) {
      setPos(null);
      return;
    }
    const { width, height } = ref.current.getBoundingClientRect();
    setPos({
      left: Math.min(menu.x, window.innerWidth - width - 4),
      top: Math.min(menu.y, window.innerHeight - height - 4),
    });
  }, [menu]);

  if (!menu) return null;
  const { field, selection } = menu;

  const run = (fn: () => void | Promise<void>) => async () => {
    setMenu(null);
    field?.focus();
    await fn();
  };
  const items: { label: string; shortcut: string; disabled?: boolean; onSelect: () => void }[] = [];
  if (field) {
    items.push({
      label: t('Cut'),
      shortcut: 'Ctrl+X',
      disabled: !selection,
      onSelect: run(() => void document.execCommand('cut')),
    });
  }
  items.push({
    label: t('Copy'),
    shortcut: 'Ctrl+C',
    disabled: !selection,
    onSelect: run(async () => {
      if (!document.execCommand('copy')) await navigator.clipboard.writeText(selection);
    }),
  });
  if (field) {
    items.push({
      label: t('Paste'),
      shortcut: 'Ctrl+V',
      onSelect: run(async () => {
        const text = await navigator.clipboard.readText().catch(() => '');
        // insertText keeps undo history and fires the input event React listens to.
        if (text) document.execCommand('insertText', false, text);
      }),
    });
    items.push({
      label: t('Select all'),
      shortcut: 'Ctrl+A',
      onSelect: run(() => {
        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)
          field.select();
        else document.execCommand('selectAll');
      }),
    });
  }

  return (
    <div
      ref={ref}
      role="menu"
      // Keep the field's focus and selection while the menu is used.
      onMouseDown={(e) => e.preventDefault()}
      className="fixed z-[80] min-w-44 rounded-md border border-border bg-surface p-1 text-[13px] shadow-xl"
      style={{
        left: pos?.left ?? menu.x,
        top: pos?.top ?? menu.y,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          disabled={it.disabled}
          onClick={it.onSelect}
          className={cn(
            'flex h-7 w-full cursor-default items-center gap-6 rounded px-2 text-left outline-none',
            'enabled:hover:bg-accent enabled:hover:text-accent-foreground disabled:opacity-40',
          )}
        >
          <span className="flex-1">{it.label}</span>
          <span className="text-xs opacity-60">{it.shortcut}</span>
        </button>
      ))}
    </div>
  );
}

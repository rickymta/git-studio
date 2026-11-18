import { ContextMenu, Dialog, DropdownMenu } from 'radix-ui';
import { Loader2, X } from 'lucide-react';
import { useCallback, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { hue, initials } from '@/lib/format';
import { t } from '@/lib/i18n';

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'default' | 'ghost' | 'danger';

export function Button({
  variant = 'default',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3',
        variant === 'primary' && 'bg-accent text-accent-foreground hover:brightness-110',
        variant === 'default' && 'border border-border bg-surface-muted hover:bg-surface-hover',
        variant === 'ghost' && 'hover:bg-surface-hover',
        variant === 'danger' && 'bg-danger text-white hover:brightness-110',
        className,
      )}
    />
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...rest}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

export const Spinner = ({ className }: { className?: string }) => (
  <Loader2 className={cn('size-4 animate-spin', className)} />
);

export function Avatar({ name, url, size = 20 }: { name: string; url?: string; size?: number }) {
  if (url) {
    return <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-full" />;
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `oklch(0.6 0.12 ${hue(name)})`,
      }}
    >
      {initials(name)}
    </span>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'h-8 w-full rounded-md border border-border bg-background px-2.5 outline-none placeholder:text-muted-foreground focus:border-accent',
        props.className,
      )}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        'w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 outline-none placeholder:text-muted-foreground focus:border-accent',
        props.className,
      )}
    />
  );
}

// ---- menus --------------------------------------------------------------------------------------

export type MenuItem =
  | 'sep'
  | {
      label: string;
      icon?: ReactNode;
      onSelect?: () => void;
      danger?: boolean;
      disabled?: boolean;
      items?: MenuItem[];
    };

const itemCls =
  'flex h-7 cursor-default items-center gap-2 rounded px-2 outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground';
const contentCls =
  'z-50 min-w-48 rounded-md border border-border bg-surface p-1 text-[13px] shadow-xl';

function renderItems(items: MenuItem[], M: typeof ContextMenu | typeof DropdownMenu): ReactNode {
  return items.map((it, i) => {
    if (it === 'sep') return <M.Separator key={i} className="my-1 h-px bg-border" />;
    if (it.items) {
      return (
        <M.Sub key={i}>
          <M.SubTrigger className={itemCls}>
            <span className="w-4">{it.icon}</span>
            {it.label}
            <span className="ml-auto pl-4 text-muted-foreground">›</span>
          </M.SubTrigger>
          <M.Portal>
            <M.SubContent className={contentCls}>{renderItems(it.items, M)}</M.SubContent>
          </M.Portal>
        </M.Sub>
      );
    }
    return (
      <M.Item
        key={i}
        disabled={it.disabled}
        onSelect={it.onSelect}
        className={cn(itemCls, it.danger && 'text-danger')}
      >
        <span className="flex w-4 justify-center">{it.icon}</span>
        {it.label}
      </M.Item>
    );
  });
}

export function ContextMenuWrap({
  items,
  children,
  onOpenChange,
}: {
  items: () => MenuItem[];
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <ContextMenu.Root onOpenChange={onOpenChange}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className={contentCls}
          // Menu items often open a dialog; don't pull focus back to the trigger over it.
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {renderItems(items(), ContextMenu)}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function Dropdown({ items, children }: { items: MenuItem[]; children: ReactNode }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className={contentCls}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {renderItems(items, DropdownMenu)}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ---- modal --------------------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  description,
  width = 460,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  width?: number;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg border border-border bg-surface p-5 shadow-2xl"
          style={{ width: `min(${width}px, calc(100vw - 32px))` }}
          aria-describedby={undefined}
          // Radix focuses the first tabbable element (the close button). Prefer an element marked
          // data-autofocus, then the first text field.
          onOpenAutoFocus={(e) => {
            const root = e.currentTarget as HTMLElement;
            const el =
              root.querySelector<HTMLElement>('[data-autofocus]') ??
              root.querySelector<HTMLElement>(
                'input:not([type=checkbox]):not([type=radio]):not([disabled]), textarea:not([disabled])',
              );
            if (el) {
              e.preventDefault();
              el.focus();
            }
          }}
        >
          <div className="mb-3 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[15px] font-semibold">{title}</Dialog.Title>
              {description && (
                <Dialog.Description asChild>
                  <div className="mt-1 text-muted-foreground">{description}</div>
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <IconButton label={t('Close')}>
                <X className="size-4" />
              </IconButton>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex h-8 items-center gap-2 px-3 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
      <span className="flex-1">{children}</span>
      {right}
    </div>
  );
}

/** GitHub mark (lucide no longer ships brand icons). */
export function Github({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

// ---- resizable widths ---------------------------------------------------------------------------

/** A width in px persisted in localStorage, clamped to [min, max]. */
export function usePersistentWidth(
  key: string,
  initial: number,
  min: number,
  max: number,
): [number, (w: number) => void] {
  const [w, setW] = useState(() => {
    try {
      const v = Number(localStorage.getItem(`gitstudio.width.${key}`));
      return v >= min && v <= max ? v : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: number) => {
      const c = Math.round(Math.min(max, Math.max(min, v)));
      setW(c);
      try {
        localStorage.setItem(`gitstudio.width.${key}`, String(c));
      } catch {
        /* ignore */
      }
    },
    [key, min, max],
  );
  return [w, set];
}

/**
 * Drag handle on the edge of a column or panel. `side="left"` sits on the left edge (dragging
 * left makes the element wider), for panels docked on the right.
 */
export function ResizeHandle({
  width,
  onResize,
  side = 'right',
  onReset,
  className,
}: {
  width: number;
  onResize: (w: number) => void;
  side?: 'left' | 'right';
  onReset?: () => void;
  className?: string;
}) {
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = width;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      onResize(side === 'right' ? w0 + dx : w0 - dx);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title={t('Drag to resize, double-click to reset')}
      onPointerDown={start}
      onDoubleClick={onReset}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'absolute top-0 z-20 h-full w-1.5 cursor-col-resize hover:bg-accent/60 active:bg-accent',
        side === 'right' ? '-right-[3px]' : '-left-[3px]',
        className,
      )}
    />
  );
}

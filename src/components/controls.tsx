import { Check, ChevronDown, Minus } from 'lucide-react';
import { Select as RSelect } from 'radix-ui';
import { Fragment, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * GitStudio's own form controls, so nothing falls back to the webview's native widgets (white
 * drop-down lists, OS-styled checkboxes): they follow the app's theme in light and dark mode.
 */

// ---- checkbox -------------------------------------------------------------------------------------

export function Checkbox({
  checked,
  onChange,
  disabled,
  indeterminate,
  className,
  id,
  title,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** A dash instead of the tick (some, not all, selected). */
  indeterminate?: boolean;
  className?: string;
  id?: string;
  title?: string;
  'aria-label'?: string;
}) {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      id={id}
      title={title}
      aria-label={ariaLabel}
      aria-checked={indeterminate ? 'mixed' : checked}
      disabled={disabled}
      // Inside a <label>, a click on the text reaches this button; stop it from also toggling
      // twice when the button itself is clicked.
      onClick={(e) => {
        e.stopPropagation();
        onChange?.(!checked);
      }}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        on
          ? 'border-accent bg-accent text-accent-foreground'
          : 'border-muted-foreground/60 bg-background hover:border-accent',
        className,
      )}
    >
      {indeterminate ? (
        <Minus className="size-3" strokeWidth={3} />
      ) : checked ? (
        <Check className="size-3" strokeWidth={3} />
      ) : null}
    </button>
  );
}

// ---- radio ----------------------------------------------------------------------------------------

export function Radio({
  checked,
  onChange,
  disabled,
  className,
  id,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  /** Called when the user picks this option. */
  onChange?: () => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      id={id}
      aria-label={ariaLabel}
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!checked) onChange?.();
      }}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-accent' : 'border-muted-foreground/60 bg-background hover:border-accent',
        className,
      )}
    >
      {checked && <span className="size-2 rounded-full bg-accent" />}
    </button>
  );
}

// ---- select ---------------------------------------------------------------------------------------

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  /** Options with the same group are listed under that heading. */
  group?: string;
}

/** Radix forbids "" as an item value; it stands for "not set" in several places here. */
const EMPTY = '\u0000empty';
const toRadix = (v: string) => (v === '' ? EMPTY : v);
const fromRadix = (v: string) => (v === EMPTY ? '' : v);

export function Select({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
  id,
  title,
  invalid,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Shown while `value` matches no option. */
  placeholder?: string;
  disabled?: boolean;
  /** Size and width of the trigger, e.g. `h-8 w-80`. */
  className?: string;
  id?: string;
  title?: string;
  invalid?: boolean;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  const known = options.some((o) => o.value === value);
  return (
    <RSelect.Root
      value={known ? toRadix(value) : undefined}
      onValueChange={(v) => onChange(fromRadix(v))}
      disabled={disabled}
    >
      <RSelect.Trigger
        id={id}
        title={title}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        data-value={value}
        className={cn(
          'inline-flex h-8 min-w-0 items-center justify-between gap-1.5 rounded-md border border-border bg-background px-2 text-left',
          'outline-none hover:border-muted-foreground/60 focus-visible:border-accent data-[state=open]:border-accent',
          'disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground',
          invalid && 'border-danger focus-visible:border-danger',
          className,
        )}
      >
        <span className="min-w-0 truncate">
          <RSelect.Value placeholder={placeholder} />
        </span>
        <RSelect.Icon asChild>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className={cn(
            'z-[70] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-surface text-[13px] shadow-xl',
            'max-h-[min(360px,var(--radix-select-content-available-height))]',
          )}
        >
          <RSelect.Viewport className="p-1">
            {options.map((o, i) => {
              // A heading above the first option of each group.
              const heading = o.group && o.group !== options[i - 1]?.group ? o.group : null;
              return (
                <Fragment key={`${o.group ?? ''}|${o.value}`}>
                  {heading && (
                    <div
                      data-select-group
                      className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
                    >
                      {heading}
                    </div>
                  )}
                  <RSelect.Item
                    value={toRadix(o.value)}
                    data-value={o.value}
                    disabled={o.disabled}
                    className={cn(
                      'relative flex h-7 cursor-default items-center rounded pr-7 pl-2 outline-none select-none',
                      'data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
                    )}
                  >
                    <RSelect.ItemText>{o.label}</RSelect.ItemText>
                    <RSelect.ItemIndicator className="absolute right-2 inline-flex">
                      <Check className="size-3.5" />
                    </RSelect.ItemIndicator>
                  </RSelect.Item>
                </Fragment>
              );
            })}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

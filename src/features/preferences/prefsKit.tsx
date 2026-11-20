// Small layout helpers shared by the credential and repository preference sections. They mirror
// the private Row/Toggle/Select/Field helpers in Preferences.tsx so these sections look the same.

import { useState, type ReactNode } from 'react';

import { Input } from '@/components/ui';
import { cn } from '@/lib/cn';

import { Checkbox, Select as UiSelect } from '@/components/controls';

export const Title = ({ children }: { children: ReactNode }) => (
  <h1 className="mb-6 text-[26px] font-semibold">{children}</h1>
);

export function Row({
  label,
  help,
  warn,
  children,
}: {
  label: string;
  help?: ReactNode;
  warn?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mb-7 grid grid-cols-[220px_1fr] items-start gap-x-8">
      <div className="pt-1.5 text-right text-[14px]">{label}</div>
      <div className="min-w-0">
        {children}
        {help && <div className="mt-1.5 text-xs text-muted-foreground">{help}</div>}
        {warn && <div className="mt-1 text-xs text-warning">⚠ {warn}</div>}
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 pt-1.5">
      <Checkbox checked={checked} disabled={disabled} onChange={(v) => onChange(v)} />
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </label>
  );
}

export function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  // Keep a value we have no label for (e.g. a helper set outside GitStudio) selectable.
  const all = options.some((o) => o.value === value)
    ? options
    : [...options, { value, label: value }];
  return <UiSelect value={value} onChange={onChange} className="h-9 w-80" options={all} />;
}

/** Text field that saves on blur / Enter. */
export function Field({
  value,
  onSave,
  placeholder,
  disabled,
  className,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [v, setV] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setV(value);
  }
  return (
    <Input
      value={v}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={cn('h-9 w-80', className)}
      spellCheck={false}
    />
  );
}

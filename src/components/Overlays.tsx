import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useState } from 'react';

import { t } from '@/lib/i18n';
import { useUi, type PromptValues } from '@/stores/ui';
import { Button, Input, Modal, Textarea } from './ui';

const TOAST_STYLE = {
  error: { color: 'var(--danger)', Icon: XCircle },
  success: { color: 'var(--success)', Icon: CheckCircle2 },
  info: { color: 'var(--accent)', Icon: Info },
} as const;

/**
 * Bottom-left notifications. Each one hides itself when its progress bar runs out; hovering
 * (or focusing inside) pauses the bar, so there is time to read or copy an error.
 */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-9 left-4 z-[60] flex w-[420px] max-w-[calc(100vw-32px)] flex-col-reverse gap-2"
    >
      {toasts.map((toast) => {
        const { color, Icon } = TOAST_STYLE[toast.kind];
        return (
          <div
            key={toast.id}
            role={toast.kind === 'error' ? 'alert' : 'status'}
            className="toast-in group pointer-events-auto relative overflow-hidden rounded-lg border shadow-2xl"
            style={{
              borderColor: `color-mix(in oklch, ${color} 55%, var(--border))`,
              background: `color-mix(in oklch, ${color} 13%, var(--surface))`,
            }}
          >
            <span className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />
            <div className="flex gap-3 py-3 pr-3 pl-4">
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full"
                style={{ background: `color-mix(in oklch, ${color} 25%, transparent)`, color }}
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="text-[14px] leading-5 font-semibold">{toast.title}</div>
                {toast.detail && (
                  <pre className="selectable mt-1 max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted-foreground">
                    {toast.detail}
                  </pre>
                )}
              </div>
              <button
                type="button"
                aria-label={t('Dismiss')}
                onClick={() => dismiss(toast.id)}
                className="flex size-6 shrink-0 items-center justify-center self-start rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <div
              className="h-[3px] w-full"
              style={{ background: `color-mix(in oklch, ${color} 18%, transparent)` }}
            >
              <div
                className="toast-progress h-full origin-left group-focus-within:[animation-play-state:paused] group-hover:[animation-play-state:paused]"
                style={{ background: color, animationDuration: `${toast.duration}ms` }}
                onAnimationEnd={() => dismiss(toast.id)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Renders the dialog requested through `ask()`. */
export function PromptDialog() {
  const prompt = useUi((s) => s.prompt);
  const close = useUi((s) => s.closePrompt);
  if (!prompt) return null;
  return <PromptBody key={prompt.title + (prompt.fields?.length ?? 0)} close={close} />;
}

function PromptBody({ close }: { close: (v: PromptValues | null) => void }) {
  const prompt = useUi((s) => s.prompt)!;
  const fields = prompt.fields ?? [];
  const [values, setValues] = useState<PromptValues>(() =>
    Object.fromEntries(
      fields.map((f) => [
        f.name,
        f.initial ?? (f.type === 'checkbox' ? false : (f.options?.[0]?.value ?? '')),
      ]),
    ),
  );
  const missing = fields.some(
    (f) => f.required && typeof values[f.name] === 'string' && !(values[f.name] as string).trim(),
  );
  const submit = () => {
    if (!missing) close(values);
  };

  return (
    <Modal open onClose={() => close(null)} title={prompt.title} description={prompt.description}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-3"
      >
        {fields.map((f, i) => {
          const set = (v: string | boolean) => setValues((s) => ({ ...s, [f.name]: v }));
          if (f.type === 'checkbox') {
            return (
              <label key={f.name} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={values[f.name] === true}
                  onChange={(e) => set(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                {f.label}
              </label>
            );
          }
          return (
            <label key={f.name} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{f.label}</span>
              {f.type === 'textarea' ? (
                <Textarea
                  rows={4}
                  autoFocus={i === 0}
                  placeholder={f.placeholder}
                  value={values[f.name] as string}
                  onChange={(e) => set(e.target.value)}
                />
              ) : f.type === 'select' ? (
                <select
                  value={values[f.name] as string}
                  onChange={(e) => set(e.target.value)}
                  className="h-8 rounded-md border border-border bg-background px-2"
                >
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  autoFocus={i === 0}
                  type={f.type === 'password' ? 'password' : 'text'}
                  placeholder={f.placeholder}
                  value={values[f.name] as string}
                  onChange={(e) => set(e.target.value)}
                  spellCheck={false}
                />
              )}
              {f.help && <span className="text-xs text-muted-foreground">{f.help}</span>}
            </label>
          );
        })}
        <div className="mt-1 flex justify-end gap-2">
          <Button onClick={() => close(null)}>{t('Cancel')}</Button>
          <Button
            type="submit"
            variant={prompt.danger ? 'danger' : 'primary'}
            disabled={missing}
            data-autofocus={fields.length === 0 ? true : undefined}
          >
            {prompt.confirmLabel ?? t('OK')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

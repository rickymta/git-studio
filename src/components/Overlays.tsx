import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { memo, useState } from 'react';

import { t } from '@/lib/i18n';
import { useUi, type PromptValues } from '@/stores/ui';
import { Button, Input, Modal, Textarea } from './ui';
import { Checkbox, Select } from '@/components/controls';

const TOAST_STYLE = {
  error: { color: 'var(--danger)', Icon: XCircle },
  success: { color: 'var(--success)', Icon: CheckCircle2 },
  warning: { color: 'var(--warning)', Icon: AlertTriangle },
  info: { color: 'var(--accent)', Icon: Info },
} as const;

/**
 * Bottom-left notifications in a vertical list, newest at the bottom. Every toast is on its own:
 * it shows at once, runs its own timer (all of them at the same time) and hides itself when its
 * progress bar runs out; hovering a toast pauses that one only.
 */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-9 left-4 z-[60] flex w-[420px] max-w-[calc(100vw-32px)] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDone={() => dismiss(toast.id)} />
      ))}
    </div>
  );
}

const ToastCard = memo(function ToastCard({
  toast,
  onDone,
}: {
  toast: ReturnType<typeof useUi.getState>['toasts'][number];
  onDone: () => void;
}) {
  const { color, Icon } = TOAST_STYLE[toast.kind];
  return (
    <div
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
          {toast.actions?.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {toast.actions.map((a, i) => (
                <Button
                  key={a.label}
                  size="sm"
                  variant={i === 0 ? 'primary' : 'default'}
                  onClick={() => {
                    a.run();
                    onDone();
                  }}
                >
                  {a.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label={t('Dismiss')}
          onClick={onDone}
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
          // Hovering (or focusing) this toast pauses its own timer only.
          className="toast-progress h-full origin-left group-focus-within:[animation-play-state:paused] group-hover:[animation-play-state:paused]"
          style={{ background: color, animationDuration: `${toast.duration}ms` }}
          onAnimationEnd={onDone}
        />
      </div>
    </div>
  );
});

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
                <Checkbox checked={values[f.name] === true} onChange={(v) => set(v)} />
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
                <Select
                  value={values[f.name] as string}
                  onChange={(v) => set(v)}
                  options={f.options ?? []}
                  className="w-full"
                />
              ) : (
                <Input
                  autoFocus={i === 0}
                  type={f.type === 'password' ? 'password' : 'text'}
                  placeholder={f.placeholder}
                  maxLength={f.maxLength}
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

import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useState } from 'react';

import { useUi, type PromptValues } from '@/stores/ui';
import { Button, Input, Modal, Textarea, cn } from './ui';

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-96 max-w-[calc(100vw-32px)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex gap-2.5 rounded-lg border bg-surface p-3 shadow-xl',
            t.kind === 'error' ? 'border-danger/50' : 'border-border',
          )}
        >
          {t.kind === 'error' && <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
          {t.kind === 'success' && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />}
          {t.kind === 'info' && <Info className="mt-0.5 size-4 shrink-0 text-accent" />}
          <div className="min-w-0 flex-1">
            <div className="font-medium">{t.title}</div>
            {t.detail && (
              <pre className="selectable mt-1 max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted-foreground">
                {t.detail}
              </pre>
            )}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
            className="self-start text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
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
          <Button onClick={() => close(null)}>Cancel</Button>
          <Button
            type="submit"
            variant={prompt.danger ? 'danger' : 'primary'}
            disabled={missing}
            data-autofocus={fields.length === 0 ? true : undefined}
          >
            {prompt.confirmLabel ?? 'OK'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

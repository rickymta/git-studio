import { AlertCircle, CheckCircle2, Send } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button, Input, Modal, Spinner, Textarea } from '@/components/ui';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { SystemInfo } from '@/lib/types';
import {
  emptyForm,
  LIMITS,
  TOPICS,
  toRequest,
  validate,
  type FieldName,
  type FormErrors,
  type SupportForm,
} from './support';

type Status =
  { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string };

function Field({
  label,
  error,
  htmlFor,
  className,
  children,
}: {
  label: string;
  error?: string;
  htmlFor: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
        <span className="ml-0.5 text-danger" aria-hidden>
          *
        </span>
      </label>
      {children}
      {error && (
        <span id={`${htmlFor}-error`} role="alert" className="text-xs text-danger">
          {t(error)}
        </span>
      )}
    </div>
  );
}

/** Help / support form opened from the status bar; sent to the developer as an email. */
export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<SupportForm>(emptyForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const prefilled = useRef(false);

  // On first open, fill name/email from the global git identity and look up the OS.
  useEffect(() => {
    if (!open) return;
    if (!system) {
      api
        .supportSystemInfo()
        .then(setSystem)
        .catch(() => {});
    }
    if (prefilled.current) return;
    prefilled.current = true;
    api
      .gitConfig(['user.name', 'user.email'])
      .then((c) =>
        setForm((f) => ({
          ...f,
          name: f.name || c['user.name'] || '',
          email: f.email || c['user.email'] || '',
        })),
      )
      .catch(() => {});
  }, [open, system]);

  const sending = status.kind === 'sending';

  const set = <K extends keyof SupportForm>(key: K, value: SupportForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
    if (status.kind === 'error') setStatus({ kind: 'idle' });
  };

  const close = () => {
    if (sending) return;
    // Keep an unsent draft; start fresh after a successful send.
    if (status.kind === 'sent') {
      setForm((f) => ({ ...emptyForm(), name: f.name, email: f.email }));
      setStatus({ kind: 'idle' });
    }
    setErrors({});
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const errs = validate(form);
    setErrors(errs);
    const first = (Object.keys(errs) as FieldName[])[0];
    if (first) {
      document.getElementById(`help-${first}`)?.focus();
      return;
    }
    setStatus({ kind: 'sending' });
    try {
      await api.sendSupport(toRequest(form, __APP_VERSION__));
      setStatus({ kind: 'sent' });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const aria = (name: FieldName) => ({
    id: `help-${name}`,
    'aria-invalid': !!errors[name] || undefined,
    'aria-describedby': errors[name] ? `help-${name}-error` : undefined,
    disabled: sending,
    className: cn(errors[name] && 'border-danger focus:border-danger'),
  });

  return (
    <Modal
      open={open}
      onClose={close}
      width={600}
      title={t('Help & Support')}
      description={t('Report a problem, suggest a feature or ask a question. We reply by email.')}
    >
      {status.kind === 'sent' ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 className="size-10 text-success" />
          <div className="text-[15px] font-semibold">{t('Message sent')}</div>
          <p className="max-w-sm text-muted-foreground">
            {t('Thanks! We will reply to {email}.', { email: form.email.trim() })}
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              onClick={() => {
                setForm((f) => ({ ...emptyForm(), name: f.name, email: f.email }));
                setStatus({ kind: 'idle' });
              }}
            >
              {t('Send another')}
            </Button>
            <Button variant="primary" onClick={close} data-autofocus>
              {t('Close')}
            </Button>
          </div>
        </div>
      ) : (
        <form noValidate onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('Name')} htmlFor="help-name" error={errors.name}>
              <Input
                {...aria('name')}
                maxLength={LIMITS.name}
                autoComplete="name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
              />
            </Field>
            <Field label={t('Email')} htmlFor="help-email" error={errors.email}>
              <Input
                {...aria('email')}
                type="email"
                autoComplete="email"
                spellCheck={false}
                placeholder="you@example.com"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
              />
            </Field>
          </div>
          <Field label={t('What do you need help with?')} htmlFor="help-topic" error={errors.topic}>
            <select
              {...aria('topic')}
              value={form.topic}
              onChange={(e) => set('topic', e.target.value as SupportForm['topic'])}
              className={cn(
                'h-8 rounded-md border border-border bg-background px-2 outline-none focus:border-accent',
                errors.topic && 'border-danger focus:border-danger',
                !form.topic && 'text-muted-foreground',
              )}
            >
              <option value="" disabled>
                {t('Choose a topic')}
              </option>
              {TOPICS.map((o) => (
                <option key={o.value} value={o.value} className="text-foreground">
                  {t(o.label)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Subject')} htmlFor="help-subject" error={errors.subject}>
            <Input
              {...aria('subject')}
              maxLength={LIMITS.subject}
              value={form.subject}
              onChange={(e) => set('subject', e.target.value)}
            />
          </Field>
          <Field label={t('Message')} htmlFor="help-message" error={errors.message}>
            <Textarea
              {...aria('message')}
              rows={7}
              maxLength={LIMITS.message}
              placeholder={t(
                'Describe the problem or idea. For a bug, list the steps to reproduce it.',
              )}
              value={form.message}
              onChange={(e) => set('message', e.target.value)}
            />
          </Field>
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.includeSystem}
              disabled={sending}
              onChange={(e) => set('includeSystem', e.target.checked)}
            />
            <span>
              {t('Attach app version and operating system')}
              <span className="block font-mono">
                GitStudio {__APP_VERSION__}
                {system && ` · ${system.os} (${system.arch})`}
              </span>
            </span>
          </label>
          {status.kind === 'error' && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-danger/50 bg-danger-soft px-3 py-2 text-danger"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium">{t('Could not send your message.')}</div>
                <div className="text-xs break-words opacity-90">{status.message}</div>
              </div>
            </div>
          )}
          <div className="mt-1 flex justify-end gap-2">
            <Button onClick={close} disabled={sending}>
              {t('Cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={sending}>
              {sending ? <Spinner className="size-3.5" /> : <Send className="size-3.5" />}
              {sending ? t('Sending…') : status.kind === 'error' ? t('Try again') : t('Submit')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

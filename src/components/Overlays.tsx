import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

import { t } from '@/lib/i18n';
import { useUi, type PromptValues } from '@/stores/ui';
import { Button, Input, Modal, Textarea } from './ui';

const TOAST_STYLE = {
  error: { color: 'var(--danger)', Icon: XCircle },
  success: { color: 'var(--success)', Icon: CheckCircle2 },
  info: { color: 'var(--accent)', Icon: Info },
} as const;

const GAP = 8;
/** How much of each older toast peeks out above the front one while collapsed. */
const PEEK = 10;
const MAX_PEEK = 2;

/**
 * Bottom-left notifications, stacked like a deck: the newest in front, older ones peeking out
 * behind it. Hovering the stack fans it out into a vertical list and pauses every timer; each
 * toast hides itself when its progress bar runs out.
 */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  const [hover, setHover] = useState(false);
  const [heights, setHeights] = useState<Record<number, number>>({});
  const expanded = hover && toasts.length > 0;

  const newestFirst = [...toasts].reverse();
  const h = (id: number) => heights[id] ?? 0;
  const front = newestFirst[0];
  const offsets: number[] = [];
  let acc = 0;
  for (const toast of newestFirst) {
    offsets.push(acc);
    acc += h(toast.id) + GAP;
  }
  const height = expanded
    ? Math.max(0, acc - GAP)
    : front
      ? h(front.id) + PEEK * Math.min(newestFirst.length - 1, MAX_PEEK)
      : 0;

  return (
    <div
      aria-live="polite"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="fixed bottom-9 left-4 z-[60] w-[420px] max-w-[calc(100vw-32px)] transition-[height] duration-200"
      style={{ height, pointerEvents: toasts.length ? 'auto' : 'none' }}
    >
      {newestFirst.map((toast, i) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          index={i}
          expanded={expanded}
          offset={offsets[i]!}
          frontHeight={front ? h(front.id) : 0}
          onHeight={(px) => setHeights((m) => (m[toast.id] === px ? m : { ...m, [toast.id]: px }))}
          onDone={() => {
            dismiss(toast.id);
            setHeights((m) => {
              const rest = { ...m };
              delete rest[toast.id];
              return rest;
            });
          }}
        />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  index,
  expanded,
  offset,
  frontHeight,
  onHeight,
  onDone,
}: {
  toast: ReturnType<typeof useUi.getState>['toasts'][number];
  index: number;
  expanded: boolean;
  offset: number;
  frontHeight: number;
  onHeight: (px: number) => void;
  onDone: () => void;
}) {
  const { color, Icon } = TOAST_STYLE[toast.kind];
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const report = () => onHeight(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const behind = !expanded && index > 0;
  const hidden = !expanded && index > MAX_PEEK;
  const transform = expanded
    ? `translateY(-${offset}px)`
    : `translateY(-${PEEK * Math.min(index, MAX_PEEK)}px) scale(${1 - 0.05 * Math.min(index, MAX_PEEK + 1)})`;

  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      aria-hidden={hidden || undefined}
      className="group absolute inset-x-0 bottom-0 origin-bottom overflow-hidden rounded-lg border shadow-2xl transition-[transform,opacity,height] duration-200 ease-out"
      style={{
        zIndex: 100 - index,
        transform,
        opacity: hidden ? 0 : 1,
        // Collapsed, cards behind take the front card's height so only their top edge shows.
        height: behind && frontHeight ? frontHeight : undefined,
        pointerEvents: hidden ? 'none' : undefined,
        borderColor: `color-mix(in oklch, ${color} 55%, var(--border))`,
        background: `color-mix(in oklch, ${color} 13%, var(--surface))`,
      }}
    >
      <div
        ref={inner}
        className="toast-in transition-opacity duration-200"
        style={{ opacity: behind ? 0 : 1 }}
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
            className="toast-progress h-full origin-left group-focus-within:[animation-play-state:paused]"
            style={{
              background: color,
              animationDuration: `${toast.duration}ms`,
              // Hovering the stack pauses every toast, not only the one under the pointer.
              animationPlayState: expanded ? 'paused' : undefined,
            }}
            onAnimationEnd={onDone}
          />
        </div>
      </div>
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

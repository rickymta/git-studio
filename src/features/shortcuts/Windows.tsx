import { FolderGit2, Search, Trash2, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { IconButton, cn } from '@/components/ui';
import { t } from '@/lib/i18n';
import { useActivity } from '@/stores/activity';
import { useRepo } from '@/stores/repo';
import { SHORTCUTS } from './shortcuts';

/** Large GitKraken-style window (title bar, close button, scrolling body). */
function BigWindow({
  open,
  onClose,
  title,
  headerExtra,
  width,
  height,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  headerExtra?: ReactNode;
  width: string;
  height: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/55" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
          style={{ width, height }}
        >
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-5">
            <Dialog.Title className="text-[17px] font-medium">{title}</Dialog.Title>
            <div className="ml-auto flex items-center gap-3">
              {headerExtra}
              <Dialog.Close asChild>
                <IconButton label={t('Close')} className="size-7">
                  <X className="size-5" />
                </IconButton>
              </Dialog.Close>
            </div>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded border border-border bg-surface-muted px-1.5 font-sans text-xs font-medium shadow-[inset_0_-1px_0_var(--border)]">
      {children}
    </kbd>
  );
}

export function ShortcutsWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return SHORTCUTS.map((g) => ({
      ...g,
      items: g.items.filter(
        (i) =>
          !needle ||
          t(i.label).toLowerCase().includes(needle) ||
          i.label.toLowerCase().includes(needle) ||
          i.keys.some((k) => k.join('+').toLowerCase().includes(needle)),
      ),
    })).filter((g) => g.items.length > 0);
  }, [q]);

  return (
    <BigWindow
      open={open}
      onClose={onClose}
      width="min(720px, calc(100vw - 32px))"
      height="min(640px, calc(100vh - 64px))"
      title={
        <span className="flex items-center gap-3">
          {t('Keyboard Shortcuts')}
          <span className="flex gap-1">
            <Key>Ctrl</Key>
            <Key>/</Key>
          </span>
        </span>
      }
      headerExtra={
        <div className="relative">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('Filter shortcuts')}
            className="h-7 w-52 rounded border border-border bg-background pr-7 pl-2 text-xs outline-none focus:border-accent"
          />
          <Search className="absolute top-1.5 right-2 size-3.5 text-muted-foreground" />
        </div>
      }
    >
      <div className="min-h-0 flex-1 overflow-auto px-8 py-5">
        {groups.length === 0 && (
          <div className="py-10 text-center text-muted-foreground">{t('No shortcut matches.')}</div>
        )}
        {groups.map((g) => (
          <section key={g.title} className="mb-6">
            <h2 className="mb-2 border-b border-border pb-2 text-[19px] font-medium">
              {t(g.title)}
            </h2>
            {g.items.map((i) => (
              <div key={i.label} className="flex h-9 items-center">
                <span className="flex-1 text-[14px]">{t(i.label)}</span>
                <span className="flex w-64 items-center gap-1.5">
                  {i.keys.map((combo, n) => (
                    <span key={n} className="flex items-center gap-1">
                      {n > 0 && <span className="px-1 text-muted-foreground">{t('or')}</span>}
                      {combo.map((k) => (
                        <Key key={k}>{k}</Key>
                      ))}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </BigWindow>
  );
}

const time = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });

export function ActivityWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const items = useActivity((s) => s.items);
  const clear = useActivity((s) => s.clear);
  const path = useRepo((s) => s.path);
  const name = useRepo((s) => s.info?.name);
  const [tab, setTab] = useState<'app' | 'repo'>(path ? 'repo' : 'app');
  const box = useRef<HTMLDivElement>(null);

  const shown = items.filter((i) => (tab === 'app' ? i.repo === null : i.repo === path));

  // Follow new lines while scrolled to the bottom.
  useEffect(() => {
    const el = box.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  const tabBtn = (id: 'app' | 'repo', icon: ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      disabled={id === 'repo' && !path}
      className={cn(
        'flex h-full items-center gap-2 px-5 text-[14px] disabled:opacity-40',
        tab === id
          ? 'bg-surface-hover font-medium text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <BigWindow
      open={open}
      onClose={onClose}
      width="calc(100vw - 96px)"
      height="calc(100vh - 96px)"
      title={t('Activity Logs')}
      headerExtra={
        <IconButton
          label={t('Clear log')}
          onClick={() => clear(tab === 'app' ? null : path)}
          className="size-7"
        >
          <Trash2 className="size-4" />
        </IconButton>
      }
    >
      <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-surface">
        {tabBtn('app', <img src="/icon.svg" alt="" className="size-4" />, t('Application'))}
        {tabBtn(
          'repo',
          <FolderGit2 className="size-4" />,
          name ? `${t('Repository')} · ${name}` : t('Repository'),
        )}
      </div>
      <div
        ref={box}
        className="selectable min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-xs leading-5"
      >
        {shown.length === 0 && (
          <div className="py-10 text-center font-sans text-muted-foreground">
            {t('Nothing logged yet.')}
          </div>
        )}
        {shown.map((i) => (
          <div key={i.id} className="flex gap-3">
            <span className="shrink-0 text-muted-foreground">{time(i.at)}</span>
            <span
              className={cn(
                'min-w-0 flex-1 whitespace-pre-wrap',
                i.status === 'failed' && 'text-danger',
              )}
            >
              {t(i.label, i.vars)}
              {(i.status === 'started' || i.ms !== undefined) && `: ${t(i.status)}.`}
              {i.error && <span className="block text-danger/80">{i.error}</span>}
            </span>
            {i.ms !== undefined && <span className="shrink-0 text-accent">{i.ms}ms</span>}
          </div>
        ))}
      </div>
    </BigWindow>
  );
}

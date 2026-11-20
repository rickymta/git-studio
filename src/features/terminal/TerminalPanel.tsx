import { ChevronDown, Plus, Terminal as TerminalIcon, Trash2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Button, IconButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { usePersistentWidth } from '@/components/usePersistentWidth';
import { t } from '@/lib/i18n';
import { useRepo } from '@/stores/repo';
import { useTerminal } from '@/stores/terminal';
import { confirm } from '@/stores/ui';
import { attach, closeSession, killAll, openSession } from './runtime';

const DEFAULT_HEIGHT = 280;

/** Terminal sessions of the current repository, docked under the commit graph / diff. */
export function TerminalPanel() {
  const repo = useRepo((s) => s.path);
  const visible = useTerminal((s) => s.visible);
  const sessions = useTerminal((s) => s.sessions);
  const activeMap = useTerminal((s) => s.active);
  const [height, setHeight] = usePersistentWidth('terminal', DEFAULT_HEIGHT, 100, 1200);

  if (!visible || !repo) return null;
  const mine = sessions.filter((s) => s.repo === repo);
  const active = mine.find((s) => s.id === activeMap[repo]) ?? mine[0];

  return (
    <section
      className="relative flex max-h-[85%] shrink-0 flex-col border-t border-border bg-background"
      style={{ height }}
    >
      <TopHandle height={height} onResize={setHeight} onReset={() => setHeight(DEFAULT_HEIGHT)} />
      <header className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-surface pr-1">
        <div className="flex h-full min-w-0 flex-1 items-center overflow-x-auto">
          {mine.map((s) => (
            <div
              key={s.id}
              role="tab"
              aria-selected={s.id === active?.id}
              onClick={() => useTerminal.getState().setActive(repo, s.id)}
              onAuxClick={(e) => e.button === 1 && closeSession(s.id)}
              className={cn(
                'group flex h-full shrink-0 cursor-default items-center gap-1.5 border-r border-border pr-1 pl-2.5 text-xs',
                s.id === active?.id
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:bg-surface-hover',
                s.exited && 'italic opacity-70',
              )}
            >
              <TerminalIcon className="size-3.5 shrink-0" />
              <span className="max-w-40 truncate">{s.shell}</span>
              <IconButton
                label={t('Close terminal')}
                className="size-5"
                onClick={(e) => {
                  e.stopPropagation();
                  closeSession(s.id);
                }}
              >
                <X className="size-3" />
              </IconButton>
            </div>
          ))}
          <IconButton label={t('New terminal')} className="mx-1" onClick={() => openSession(repo)}>
            <Plus className="size-3.5" />
          </IconButton>
        </div>
        <IconButton
          label={t('Hide terminal')}
          onClick={() => useTerminal.getState().setVisible(false)}
        >
          <ChevronDown className="size-4" />
        </IconButton>
        <IconButton
          label={t('Kill All Terminals')}
          disabled={mine.length === 0}
          onClick={async () => {
            if (
              await confirm(
                t('Kill All Terminals'),
                t('End every terminal session of this repository?'),
                t('Kill All'),
                true,
              )
            )
              killAll(repo);
          }}
        >
          <Trash2 className="size-3.5" />
        </IconButton>
        <IconButton
          label={t('Close terminal panel')}
          onClick={() => {
            killAll(repo);
            useTerminal.getState().setVisible(false);
          }}
        >
          <X className="size-4" />
        </IconButton>
      </header>
      {active ? (
        <TerminalView key={active.id} id={active.id} />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <Button size="sm" onClick={() => openSession(repo)}>
            <Plus className="size-3.5" /> {t('New terminal')}
          </Button>
        </div>
      )}
    </section>
  );
}

function TerminalView({ id }: { id: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => (ref.current ? attach(id, ref.current) : undefined), [id]);
  return <div ref={ref} className="min-h-0 flex-1 overflow-hidden pt-1 pl-2" />;
}

/** Drag handle on the panel's top edge; dragging up makes it taller. */
function TopHandle({
  height,
  onResize,
  onReset,
}: {
  height: number;
  onResize: (h: number) => void;
  onReset: () => void;
}) {
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = height;
    const move = (ev: PointerEvent) => onResize(h0 - (ev.clientY - y0));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'row-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      title={t('Drag to resize, double-click to reset')}
      onPointerDown={start}
      onDoubleClick={onReset}
      className="absolute -top-[3px] left-0 z-20 h-1.5 w-full cursor-row-resize hover:bg-accent/60 active:bg-accent"
    />
  );
}

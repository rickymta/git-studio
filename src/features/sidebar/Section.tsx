import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';

/**
 * Sections the user opened or closed since the app started. Every launch starts from
 * each section's default (only Local open); toggles survive switching repositories.
 */
const sectionOpen = new Map<string, boolean>();

export function Section({
  id,
  title,
  icon,
  count,
  actions,
  defaultOpen = false,
  forceOpen = false,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  count?: number;
  actions?: ReactNode;
  defaultOpen?: boolean;
  /** Show the contents regardless of the toggle (e.g. while the filter is in use). */
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const [toggled, setToggled] = useState(() => sectionOpen.get(id) ?? defaultOpen);
  const open = forceOpen || toggled;
  const toggle = () => {
    const next = !open;
    sectionOpen.set(id, next);
    setToggled(next);
  };
  return (
    <div className="border-b border-border/60">
      <div className="group flex h-[30px] items-center gap-1 pr-2 pl-1.5 text-xs font-semibold text-muted-foreground hover:bg-surface-hover">
        <button
          type="button"
          onClick={toggle}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 tracking-wide uppercase hover:text-foreground"
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          {icon}
          <span className="truncate">{title}</span>
        </button>
        <span className="flex opacity-0 group-hover:opacity-100">{actions}</span>
        {count !== undefined && (
          <span className="w-6 text-right font-normal tabular-nums">{count}</span>
        )}
      </div>
      {open && <div className="pb-1.5">{children}</div>}
    </div>
  );
}

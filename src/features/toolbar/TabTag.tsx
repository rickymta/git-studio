import { cn } from '@/lib/cn';
import { colorValue, useTabMark } from '@/stores/tabMarks';

/** A repository's tag as a small pill, in its colour (or neutral without one). */
export function TabTag({
  path,
  className,
  plain,
}: {
  path: string;
  className?: string;
  /** Neutral, in the text colour (on a highlighted row). */
  plain?: boolean;
}) {
  const { tag, color } = useTabMark(path);
  if (!tag) return null;
  const c = plain ? undefined : colorValue(color);
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1 text-[10px] leading-4 font-semibold whitespace-nowrap',
        !c && (plain ? 'bg-black/20' : 'bg-surface-hover text-foreground'),
        className,
      )}
      style={c ? { background: `color-mix(in oklab, ${c} 28%, transparent)`, color: c } : undefined}
    >
      {tag}
    </span>
  );
}

/** A dot in the repository's colour, if it has one. */
export function TabColorDot({ path }: { path: string }) {
  const c = colorValue(useTabMark(path).color);
  if (!c) return null;
  return <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: c }} />;
}

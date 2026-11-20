import { ArrowDown, ArrowUp, Check } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button, IconButton, Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  parseConflicts,
  resolveConflicts,
  type ConflictChoice,
  type ConflictPart,
} from '@/lib/diff';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { DecodedText } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { toast } from '@/stores/ui';
import { CodeView } from './CodeView';

import { Checkbox } from '@/components/controls';

type Conflict = Extract<ConflictPart, { type: 'conflict' }>;

/**
 * Merge-conflict tool: the current branch (A) and the incoming side (B) next to each other with a
 * checkbox per conflict, and the editable output below. Saving writes the file in its original
 * encoding and marks it resolved (stages it).
 */
export function ConflictView({ path, wrap }: { path: string; wrap: boolean }) {
  const repo = useRepo((s) => s.path)!;
  const run = useRepo((s) => s.run);
  const closeDiff = useRepo((s) => s.closeDiff);
  const [file, setFile] = useState<DecodedText | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<ConflictChoice[]>([]);
  const [output, setOutput] = useState('');
  const [edited, setEdited] = useState(false);
  const [current, setCurrent] = useState(0);
  const [saving, setSaving] = useState(false);
  const panes = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .readFile(repo, path)
      .then((f) => alive && setFile(f))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [repo, path]);

  const parts = useMemo(() => (file ? parseConflicts(file.text) : []), [file]);
  const conflicts = parts.filter((p): p is Conflict => p.type === 'conflict');

  // Output follows the checkboxes until the user types in it.
  const generated = useMemo(() => resolveConflicts(parts, choices), [parts, choices]);
  const shownOutput = edited ? output : generated;

  const choose = (i: number, side: 'ours' | 'theirs', on: boolean) => {
    setEdited(false);
    setChoices((prev) => {
      const next = [...prev];
      next[i] = { ...(next[i] ?? { ours: false, theirs: false }), [side]: on };
      return next;
    });
  };
  const chooseAll = (side: 'ours' | 'theirs') => {
    setEdited(false);
    setChoices(conflicts.map(() => ({ ours: side === 'ours', theirs: side === 'theirs' })));
  };

  const unresolved = conflicts.filter((c) => {
    const ch = choices[c.index];
    return !ch || (!ch.ours && !ch.theirs);
  }).length;

  const go = (dir: 1 | -1) => {
    if (conflicts.length === 0) return;
    const next = (current + dir + conflicts.length) % conflicts.length;
    setCurrent(next);
    panes.current
      ?.querySelectorAll(`[data-conflict="${next}"]`)
      .forEach((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };

  const save = async () => {
    if (!file) return;
    setSaving(true);
    const ok = await run('Resolve', async (p) => {
      await api.writeFile(p, path, shownOutput, file.format);
      await api.stage(p, [path]);
    });
    setSaving(false);
    if (ok) {
      toast('success', t('Conflict resolved: {path}', { path }));
      closeDiff();
    }
  };

  const takeWhole = (side: 'ours' | 'theirs') =>
    run('Resolve', (p) => api.resolve(p, [path], side)).then((ok) => ok && closeDiff());

  if (error) return <div className="p-6 text-danger">{error}</div>;
  if (!file) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-muted-foreground" />
      </div>
    );
  }

  if (conflicts.length === 0) {
    // Deleted on one side, binary, or markers already removed: whole-file choices only.
    return (
      <div className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="text-muted-foreground">
          {t(
            'No conflict markers in this file. Choose a whole side, or mark it resolved as it is.',
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={() => takeWhole('ours')}>{t('Take current branch (A)')}</Button>
          <Button onClick={() => takeWhole('theirs')}>{t('Take incoming (B)')}</Button>
          <Button
            variant="primary"
            onClick={() =>
              run('Stage', (p) => api.stage(p, [path])).then((ok) => ok && closeDiff())
            }
          >
            <Check className="size-4" /> {t('Mark Resolved')}
          </Button>
        </div>
      </div>
    );
  }

  const first = conflicts[0]!;
  const side = (which: 'ours' | 'theirs') => (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <span
          className={cn(
            'flex size-5 items-center justify-center rounded text-xs font-bold text-white',
            which === 'ours' ? 'bg-[oklch(0.6_0.13_250)]' : 'bg-[oklch(0.62_0.14_320)]',
          )}
        >
          {which === 'ours' ? 'A' : 'B'}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">
          {which === 'ours' ? first.oursLabel || 'HEAD' : first.theirsLabel || t('incoming')}
        </span>
        <Button size="sm" variant="ghost" onClick={() => chooseAll(which)}>
          {t('Take all')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto font-mono text-xs leading-5">
        {parts.map((p, i) =>
          p.type === 'text' ? (
            <pre
              key={i}
              className={cn(
                'px-3 text-muted-foreground',
                wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre',
              )}
            >
              {p.lines.join('\n')}
            </pre>
          ) : (
            <div
              key={i}
              data-conflict={p.index}
              className={cn(
                'my-1 border-y',
                which === 'ours'
                  ? 'border-[oklch(0.6_0.13_250)]/60'
                  : 'border-[oklch(0.62_0.14_320)]/60',
                p.index === current && 'outline-1 -outline-offset-1 outline-accent',
              )}
            >
              <label className="flex cursor-pointer items-center gap-2 bg-surface-muted px-3 py-1 font-sans text-[12px]">
                <Checkbox
                  checked={!!choices[p.index]?.[which]}
                  onChange={(v) => choose(p.index, which, v)}
                />
                {t('Conflict {n}', { n: p.index + 1 })}
              </label>
              <pre
                className={cn(
                  'px-3',
                  which === 'ours' ? 'bg-[oklch(0.6_0.13_250)]/12' : 'bg-[oklch(0.62_0.14_320)]/12',
                  wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre',
                )}
              >
                {(which === 'ours' ? p.ours : p.theirs).join('\n') || ' '}
              </pre>
            </div>
          ),
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-warning-soft px-3">
        <span className="font-medium">
          {unresolved === 0
            ? t('All {n} conflicts have a choice', { n: conflicts.length })
            : t('{n} of {total} conflicts unresolved', { n: unresolved, total: conflicts.length })}
        </span>
        <IconButton label={t('Previous conflict')} onClick={() => go(-1)}>
          <ArrowUp className="size-4" />
        </IconButton>
        <IconButton label={t('Next conflict')} onClick={() => go(1)}>
          <ArrowDown className="size-4" />
        </IconButton>
        <span className="ml-auto text-xs text-muted-foreground">
          {file.format.encoding} · {file.format.eol.toUpperCase()}
        </span>
      </div>
      <div ref={panes} className="flex min-h-0 flex-[1.1] divide-x divide-border">
        {side('ours')}
        {side('theirs')}
      </div>
      <div className="flex h-8 shrink-0 items-center gap-2 border-y border-border bg-surface px-3">
        <span className="font-medium">{t('Output')}</span>
        {edited && <span className="text-xs text-muted-foreground">{t('edited by hand')}</span>}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={closeDiff}>
            {t('Cancel')}
          </Button>
          <Button size="sm" variant="primary" disabled={saving} onClick={save} title="Ctrl+S">
            {saving ? <Spinner /> : <Check className="size-3.5" />} {t('Save and Mark Resolved')}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <CodeView
          value={shownOutput}
          path={path}
          editable
          wrap={wrap}
          onChange={(v) => {
            if (v !== shownOutput) {
              setEdited(true);
              setOutput(v);
            }
          }}
          onSave={save}
        />
      </div>
    </div>
  );
}

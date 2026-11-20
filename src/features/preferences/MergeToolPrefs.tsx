import { useEffect, useState } from 'react';

import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { MergeTools } from '@/lib/types';
import { toast } from '@/stores/ui';

/** `merge.tool` / `diff.tool` (global git config): what "Open in merge / diff tool" starts. */
export function MergeToolPrefs() {
  const [tools, setTools] = useState<MergeTools | null>(null);
  useEffect(() => {
    api
      .mergeTools()
      .then(setTools)
      .catch(() => setTools({ mergeTool: '', diffTool: '', available: [], other: [] }));
  }, []);
  if (!tools) return null;

  const save = async (kind: 'merge' | 'diff', name: string) => {
    try {
      await api.setTool(kind, name);
      setTools({ ...tools, [kind === 'merge' ? 'mergeTool' : 'diffTool']: name });
    } catch (e) {
      toast('error', t('Could not save the tool'), (e as Error).message);
    }
  };

  const select = (kind: 'merge' | 'diff', value: string) => {
    // A tool set by hand (e.g. a custom mergetool.<name>.cmd) is kept in the list.
    const known = [...tools.available, ...tools.other];
    return (
      <select
        value={value}
        onChange={(e) => void save(kind, e.target.value)}
        className="h-8 rounded-md border border-border bg-background px-2"
      >
        <option value="">{t('Not set (git picks one)')}</option>
        {value && !known.includes(value) && <option value={value}>{value}</option>}
        {tools.available.length > 0 && (
          <optgroup label={t('Found on this computer')}>
            {tools.available.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </optgroup>
        )}
        {tools.other.length > 0 && (
          <optgroup label={t('Other tools git supports')}>
            {tools.other.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    );
  };

  const row = (label: string, body: React.ReactNode, help: string) => (
    <div className="mb-7 grid grid-cols-[220px_1fr] items-start gap-x-8">
      <div className="pt-1.5 text-right text-[14px]">{label}</div>
      <div className="min-w-0">
        {body}
        <div className="mt-1.5 text-xs text-muted-foreground">{help}</div>
      </div>
    </div>
  );

  return (
    <>
      {row(
        t('Merge tool'),
        select('merge', tools.mergeTool),
        t('Opened by “Open in merge tool” on a conflicted file (git config merge.tool).'),
      )}
      {row(
        t('Diff tool'),
        select('diff', tools.diffTool),
        t('Opened by “Open in diff tool” on a changed file (git config diff.tool).'),
      )}
    </>
  );
}

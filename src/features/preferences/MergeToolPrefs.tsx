import { useEffect, useState } from 'react';

import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { MergeTools } from '@/lib/types';
import { toast } from '@/stores/ui';

import { Select } from '@/components/controls';

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
      <Select
        value={value}
        onChange={(v) => void save(kind, v)}
        className="w-80"
        options={[
          { value: '', label: t('Not set (git picks one)') },
          ...(value && !known.includes(value) ? [{ value, label: value }] : []),
          ...tools.available.map((n) => ({
            value: n,
            label: n,
            group: t('Found on this computer'),
          })),
          ...tools.other.map((n) => ({ value: n, label: n, group: t('Other tools git supports') })),
        ]}
      />
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

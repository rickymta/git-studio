import { Check, Settings } from 'lucide-react';

import { Dropdown, type MenuItem } from '@/components/ui';
import { t } from '@/lib/i18n';
import { useColumnSettings, type Column } from './columnSettings';

const LABELS: Record<Column, string> = {
  refs: 'Branch / Tag',
  graph: 'Graph',
  message: 'Commit message',
  author: 'Author',
  date: 'Date / Time',
  sha: 'Sha',
};

const check = (on: boolean) => (on ? <Check className="size-3.5" /> : undefined);

/** The gear at the right end of the graph header, like GitKraken's "Column settings". */
export function ColumnSettingsMenu({ onReset }: { onReset: (compact: boolean) => void }) {
  const s = useColumnSettings();
  const items: MenuItem[] = [
    ...(Object.keys(LABELS) as Column[]).map((c) => {
      const on = s.visible.includes(c);
      return {
        label: t(LABELS[c]),
        icon: check(on),
        // At least one column stays.
        disabled: on && s.visible.length === 1,
        onSelect: () => s.toggle(c),
      };
    }),
    'sep',
    {
      label: t('Compact Graph Column'),
      icon: check(s.compactGraph),
      onSelect: () => s.setCompactGraph(!s.compactGraph),
    },
    {
      label: t('Smart Branch Visibility'),
      icon: check(s.smartBranches),
      onSelect: () => s.setSmartBranches(!s.smartBranches),
    },
    'sep',
    {
      label: t('Reset columns to default layout'),
      onSelect: () => {
        s.reset(false);
        onReset(false);
      },
    },
    {
      label: t('Reset columns to compact layout'),
      onSelect: () => {
        s.reset(true);
        onReset(true);
      },
    },
  ];
  return (
    <Dropdown items={items} align="end">
      <button
        type="button"
        aria-label={t('Column settings')}
        title={t('Column settings')}
        className="mr-2 ml-0.5 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground"
      >
        <Settings className="size-3.5" />
      </button>
    </Dropdown>
  );
}

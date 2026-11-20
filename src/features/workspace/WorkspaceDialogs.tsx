import { Check, FolderOpen, FolderSearch } from 'lucide-react';
import { useState } from 'react';

import { Button, Input, Modal, Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { pickFolder } from '@/lib/native';
import { useRepo } from '@/stores/repo';
import { toast } from '@/stores/ui';
import { WORKSPACE_COLORS, samePath, useWorkspaces } from '@/stores/workspace';

import { Checkbox } from '@/components/controls';

export function ColorSwatches({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {WORKSPACE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={t('Colour {color}', { color: c })}
          onClick={() => onChange(c)}
          className="flex size-6 items-center justify-center rounded-full"
          style={{
            background: c,
            boxShadow: value === c ? `0 0 0 2px var(--surface), 0 0 0 4px ${c}` : undefined,
          }}
        >
          {value === c && <Check className="size-3.5 text-black/70" />}
        </button>
      ))}
    </div>
  );
}

/** Pick repositories found under a folder. Used when creating a workspace and to add to one. */
function ScanPicker({
  existing,
  selected,
  onSelected,
}: {
  existing: string[];
  selected: string[];
  onSelected: (paths: string[]) => void;
}) {
  const [root, setRoot] = useState('');
  const [found, setFound] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const isExisting = (p: string) => existing.some((e) => samePath(e, p));

  const scan = async (dir: string) => {
    setRoot(dir);
    setBusy(true);
    try {
      const res = await api.scanRepos(dir, 3);
      setFound(res);
      onSelected(res.filter((p) => !isExisting(p)));
    } catch (e) {
      toast('error', t('Scan failed'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (p: string) =>
    onSelected(selected.includes(p) ? selected.filter((x) => x !== p) : [...selected, p]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        <Input
          placeholder={t('Folder that contains your repositories')}
          value={root}
          onChange={(e) => setRoot(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && root.trim() && scan(root.trim())}
          spellCheck={false}
        />
        <Button
          aria-label={t('Browse')}
          onClick={async () => {
            const p = await pickFolder(t('Folder to scan for repositories'), root || undefined);
            if (p) await scan(p);
          }}
        >
          <FolderOpen className="size-4" />
        </Button>
        <Button onClick={() => root.trim() && scan(root.trim())} disabled={!root.trim() || busy}>
          {busy ? <Spinner /> : <FolderSearch className="size-4" />} {t('Scan')}
        </Button>
      </div>
      {found && (
        <div className="max-h-64 overflow-auto rounded-md border border-border">
          {found.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              {t('No Git repositories found (searched 3 levels deep).')}
            </div>
          ) : (
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
              {t('{n} found', { n: found.length })}
              <button
                type="button"
                className="ml-auto text-accent hover:underline"
                onClick={() => onSelected(found.filter((p) => !isExisting(p)))}
              >
                {t('Select all')}
              </button>
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => onSelected([])}
              >
                {t('None')}
              </button>
            </div>
          )}
          {found.map((p) => {
            const already = isExisting(p);
            return (
              <label
                key={p}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 hover:bg-surface-hover',
                  already && 'opacity-50',
                )}
              >
                <Checkbox
                  disabled={already}
                  checked={already || selected.includes(p)}
                  onChange={() => toggle(p)}
                />
                <span className="font-medium">{p.split(/[\\/]/).pop()}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{p}</span>
                {already && <span className="text-xs">{t('already added')}</span>}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function NewWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <NewWorkspaceBody onClose={onClose} /> : null;
}

function NewWorkspaceBody({ onClose }: { onClose: () => void }) {
  const tabs = useRepo((s) => s.tabs);
  const count = useWorkspaces((s) => s.data.items.length);
  const create = useWorkspaces((s) => s.create);
  const [name, setName] = useState('');
  const [color, setColor] = useState(WORKSPACE_COLORS[count % WORKSPACE_COLORS.length]!);
  const [source, setSource] = useState<'scan' | 'tabs' | 'empty'>('scan');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const repos = source === 'scan' ? picked : source === 'tabs' ? tabs.map((t) => t.path) : [];

  const submit = async () => {
    setBusy(true);
    try {
      const ws = await create(name, color, repos);
      toast(
        'success',
        t('Workspace “{name}” created with {n} repositories', {
          name: ws.name,
          n: ws.repos.length,
        }),
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('New workspace')}
      width={600}
      description={t(
        "A workspace groups repositories you work on together. It keeps its own tabs, and its overview shows every repository's state at a glance.",
      )}
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t('Name')}</span>
          <Input
            autoFocus
            placeholder={t('e.g. Backend services')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t('Colour')}</span>
          <ColorSwatches value={color} onChange={setColor} />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">{t('Repositories')}</span>
          <div className="flex gap-1 rounded-md bg-surface-muted p-1">
            {(
              [
                ['scan', t('Scan a folder')],
                ['tabs', t('Open tabs ({n})', { n: tabs.length })],
                ['empty', t('Start empty')],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setSource(k)}
                className={cn(
                  'h-7 flex-1 rounded',
                  source === k ? 'bg-surface shadow' : 'text-muted-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {source === 'scan' && (
            <ScanPicker existing={[]} selected={picked} onSelected={setPicked} />
          )}
          {source === 'tabs' && (
            <div className="rounded-md border border-border p-2 text-xs text-muted-foreground">
              {tabs.length === 0 ? t('No tabs are open.') : tabs.map((t) => t.name).join(', ')}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted-foreground">
            {repos.length === 1
              ? t('{n} repository selected', { n: repos.length })
              : t('{n} repositories selected', { n: repos.length })}
          </span>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" disabled={!name.trim() || busy} onClick={submit}>
            {busy && <Spinner />} {t('Create workspace')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function ScanDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <ScanBody onClose={onClose} /> : null;
}

function ScanBody({ onClose }: { onClose: () => void }) {
  const ws = useWorkspaces((s) => s.active());
  const addRepos = useWorkspaces((s) => s.addRepos);
  const [picked, setPicked] = useState<string[]>([]);
  if (!ws) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={t('Add repositories to {name}', { name: ws.name })}
      width={600}
    >
      <ScanPicker existing={ws.repos} selected={picked} onSelected={setPicked} />
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>{t('Cancel')}</Button>
        <Button
          variant="primary"
          disabled={picked.length === 0}
          onClick={async () => {
            const n = await addRepos(ws.id, picked);
            toast(
              'success',
              n === 1 ? t('Added {n} repository', { n }) : t('Added {n} repositories', { n }),
            );
            onClose();
          }}
        >
          {picked.length ? t('Add {n}', { n: picked.length }) : t('Add')}
        </Button>
      </div>
    </Modal>
  );
}

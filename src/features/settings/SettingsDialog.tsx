import { useEffect, useState } from 'react';

import { Button, Input, Modal } from '@/components/ui';
import { api } from '@/lib/ipc';
import type { Settings } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { toast } from '@/stores/ui';

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useRepo((s) => s.settings);
  // Mounted only while open, so the draft starts from the saved settings each time.
  return open && settings ? <SettingsBody initial={settings} onClose={onClose} /> : null;
}

function SettingsBody({ initial, onClose }: { initial: Settings; onClose: () => void }) {
  const open = true;
  const setSettings = useRepo((s) => s.setSettings);
  const path = useRepo((s) => s.path);
  const [draft, setDraft] = useState<Settings | null>(initial);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [global, setGlobal] = useState(true);
  const [gitVersion, setGitVersion] = useState('');

  useEffect(() => {
    api
      .gitVersion()
      .then(setGitVersion)
      .catch(() => setGitVersion('git not found'));
    if (path) {
      api.identity(path).then((i) => {
        setName(i.name);
        setEmail(i.email);
      });
    }
  }, [path]);

  if (!draft) return null;

  const save = async () => {
    try {
      setSettings(await api.saveSettings(draft));
      if (path && (name.trim() || email.trim())) {
        await api.setIdentity(path, name.trim(), email.trim(), global);
      }
      toast('success', 'Settings saved');
      onClose();
    } catch (e) {
      toast('error', 'Could not save settings', (e as Error).message);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Settings" width={520} description={gitVersion}>
      <div className="flex flex-col gap-4">
        {path && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Commit identity
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={global}
                onChange={(e) => setGlobal(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              Save for all repositories (global git config)
            </label>
          </fieldset>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Pull strategy</span>
          <select
            value={draft.pullMode}
            onChange={(e) =>
              setDraft({ ...draft, pullMode: e.target.value as Settings['pullMode'] })
            }
            className="h-8 rounded-md border border-border bg-background px-2"
          >
            <option value="merge">Merge (default)</option>
            <option value="rebase">Rebase</option>
            <option value="ff-only">Fast-forward only</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Default clone folder</span>
          <Input
            value={draft.cloneDir}
            onChange={(e) => setDraft({ ...draft, cloneDir: e.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            GitHub OAuth App client ID (for “Sign in with browser”)
          </span>
          <Input
            placeholder="Ov23li…"
            value={draft.githubClientId}
            onChange={(e) => setDraft({ ...draft, githubClientId: e.target.value })}
            spellCheck={false}
          />
          <span className="text-xs text-muted-foreground">
            Register an OAuth App on GitHub (Settings → Developer settings → OAuth Apps) and tick
            “Enable Device Flow”. Not needed when signing in with a personal access token.
          </span>
        </label>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

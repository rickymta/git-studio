import { useEffect, useState } from 'react';

import { Button, Input } from '@/components/ui';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { SigningConfig } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { toast } from '@/stores/ui';

type Scope = 'local' | 'global';

/**
 * Commit and tag signing (GPG or SSH): git's own settings, for this repository or for every
 * repository. git does the signing when committing, so the rest of the app needs nothing else.
 */
export function SigningPrefs() {
  const path = useRepo((s) => s.path);
  const [scope, setScope] = useState<Scope>(path ? 'local' : 'global');
  const [loaded, setLoaded] = useState<{ key: string; cfg: SigningConfig } | null>(null);
  const [draft, setDraft] = useState<SigningConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const key = `${path}\u0000${scope}`;

  useEffect(() => {
    if (!path) return;
    let live = true;
    api
      .signingConfig(path, scope)
      .then((cfg) => {
        if (!live) return;
        setLoaded({ key, cfg });
        setDraft(cfg);
      })
      .catch((e: Error) => toast('error', t('Could not read signing settings'), e.message));
    return () => {
      live = false;
    };
  }, [path, scope, key]);

  if (!path)
    return (
      <>
        <h1 className="mb-6 text-[26px] font-semibold">{t('Commit signing')}</h1>
        <p className="text-muted-foreground">
          {t('Open a repository to change signing settings.')}
        </p>
      </>
    );

  const cfg = loaded?.key === key ? draft : null;
  const set = (patch: Partial<SigningConfig>) => cfg && setDraft({ ...cfg, ...patch });
  const ssh = cfg?.format === 'ssh';
  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      await api.setSigning(path, cfg, scope);
      setLoaded({ key, cfg });
      toast('success', t('Signing settings saved'));
    } catch (e) {
      toast('error', t('Could not save signing settings'), (e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const changed = !!cfg && JSON.stringify(cfg) !== JSON.stringify(loaded?.cfg);

  const row = (label: string, body: React.ReactNode, help?: string) => (
    <div className="mb-6 grid grid-cols-[220px_1fr] items-start gap-x-8">
      <div className="pt-1.5 text-right text-[14px]">{label}</div>
      <div className="min-w-0">
        {body}
        {help && <div className="mt-1.5 text-xs text-muted-foreground">{help}</div>}
      </div>
    </div>
  );

  return (
    <>
      <h1 className="mb-6 text-[26px] font-semibold">{t('Commit signing')}</h1>
      {row(
        t('Settings for'),
        <div className="flex gap-1 pt-0.5">
          {(['local', 'global'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={cn(
                'rounded-md border px-3 py-1',
                scope === s
                  ? 'border-accent bg-accent-soft text-foreground'
                  : 'border-border text-muted-foreground hover:bg-surface-hover',
              )}
            >
              {s === 'local' ? t('This repository') : t('All repositories')}
            </button>
          ))}
        </div>,
        scope === 'local'
          ? t('Saved in this repository; it overrides the settings for all repositories.')
          : t('Saved in your global git config.'),
      )}
      {!cfg ? (
        <div className="text-muted-foreground">…</div>
      ) : (
        <>
          {row(
            t('Sign'),
            <div className="flex flex-col gap-1.5 pt-1.5">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={cfg.signCommits}
                  onChange={(e) => set({ signCommits: e.target.checked })}
                  className="size-4 accent-[var(--accent)]"
                />
                {t('Sign every commit')}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={cfg.signTags}
                  onChange={(e) => set({ signTags: e.target.checked })}
                  className="size-4 accent-[var(--accent)]"
                />
                {t('Sign annotated tags')}
              </label>
            </div>,
          )}
          {row(
            t('Signature type'),
            <select
              value={cfg.format}
              onChange={(e) => set({ format: e.target.value })}
              className="h-8 rounded-md border border-border bg-background px-2"
            >
              <option value="">{t('Not set (GPG)')}</option>
              <option value="openpgp">GPG (OpenPGP)</option>
              <option value="ssh">{t('SSH key')}</option>
              <option value="x509">X.509 (gpgsm)</option>
            </select>,
          )}
          {row(
            t('Signing key'),
            <Input
              value={cfg.key}
              onChange={(e) => set({ key: e.target.value })}
              placeholder={ssh ? '~/.ssh/id_ed25519.pub' : t('Key ID, e.g. 3AA5C34371567BD2')}
              className="font-mono"
            />,
            ssh
              ? t(
                  'Path to your public key (or the key itself). To verify SSH signatures, git also needs gpg.ssh.allowedSignersFile.',
                )
              : t('Empty: GPG picks the key matching your commit email.'),
          )}
          <div className="grid grid-cols-[220px_1fr] gap-x-8">
            <div />
            <div>
              <Button variant="primary" disabled={!changed || saving} onClick={() => void save()}>
                {t('Save')}
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// Global credential preferences: which credential helper git uses and what it has stored.

import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button, Spinner } from '@/components/ui';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { HostCredential } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { ask, confirm, toast } from '@/stores/ui';
import { Row, Select, Title } from './prefsKit';

const UNSET = '';

function helperOptions() {
  return [
    { value: 'manager', label: t('Git Credential Manager') },
    { value: 'wincred', label: t('Windows Credential Store') },
    { value: 'store', label: t('Plain-text store (~/.git-credentials)') },
  ];
}

export function CredentialsPrefs() {
  const repo = useRepo((s) => s.path) ?? undefined;
  const [helper, setHelper] = useState<string | null>(null);
  const [creds, setCreds] = useState<HostCredential[] | null>(null);
  // Bumped to re-read what the credential helper has stored.
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .gitConfig(['credential.helper'])
      .then((v) => setHelper(v['credential.helper'] ?? UNSET))
      .catch(() => setHelper(UNSET));
  }, []);

  useEffect(() => {
    let live = true;
    api
      .credentials(repo)
      .then((c) => live && setCreds(c))
      .catch((e) => {
        if (!live) return;
        toast('error', t('Could not read stored credentials'), (e as Error).message);
        setCreds([]);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [repo, tick]);

  const load = () => {
    setLoading(true);
    setTick((n) => n + 1);
  };

  const changeHelper = async (v: string) => {
    try {
      await api.setGitConfig('credential.helper', v === UNSET ? null : v);
      setHelper(v);
      load();
    } catch (e) {
      toast('error', t('Could not set {key}', { key: 'credential.helper' }), (e as Error).message);
    }
  };

  const save = async (c: HostCredential) => {
    const v = await ask({
      title: t('Save credentials for {host}', { host: c.host }),
      description: t(
        'Saved through the credential helper selected above, so git uses them for every repository on {host}. For GitHub and GitLab use a personal access token as the password.',
        { host: c.host },
      ),
      fields: [
        {
          name: 'username',
          label: t('Username'),
          initial: c.username ?? '',
          required: true,
        },
        { name: 'password', label: t('Password or token'), type: 'password', required: true },
      ],
      confirmLabel: t('Save'),
    });
    if (!v) return;
    try {
      await api.saveCredential(c.host, (v.username as string).trim(), v.password as string);
      toast('success', t('Saved credentials for {host}', { host: c.host }));
    } catch (e) {
      toast('error', t('Could not save credentials'), (e as Error).message);
    }
    load();
  };

  const remove = async (c: HostCredential) => {
    if (
      !(await confirm(
        t('Remove credentials'),
        t(
          'Remove the stored credentials for {host}? Git asks for them again the next time it needs them.',
          { host: c.host },
        ),
        t('Remove'),
        true,
      ))
    )
      return;
    try {
      await api.eraseCredential(c.host);
      toast('success', t('Removed credentials for {host}', { host: c.host }));
    } catch (e) {
      toast('error', t('Could not remove credentials'), (e as Error).message);
    }
    load();
  };

  return (
    <>
      <Title>{t('Credentials')}</Title>
      <Row
        label={t('Credential Helper')}
        help={t(
          'credential.helper in your global Git config: where git keeps usernames and passwords for HTTPS remotes.',
        )}
        warn={
          helper === 'store'
            ? t('The plain-text store saves passwords unencrypted in your home folder.')
            : undefined
        }
      >
        {helper === null ? (
          <Spinner />
        ) : (
          <Select
            value={helper}
            onChange={changeHelper}
            options={[...helperOptions(), { value: UNSET, label: t('Not set') }]}
          />
        )}
      </Row>
      <Row
        label={t('Stored Credentials')}
        help={t(
          'Hosts of the open repository’s HTTPS remotes plus GitHub and GitLab. Passwords are never shown.',
        )}
      >
        <div className="w-[520px] max-w-full">
          <div className="mb-2 flex items-center gap-2">
            <Button onClick={() => load()} disabled={loading}>
              <RefreshCw className="size-3.5" /> {t('Refresh')}
            </Button>
            {loading && <Spinner className="text-muted-foreground" />}
          </div>
          {creds?.length === 0 && (
            <div className="text-xs text-muted-foreground">{t('No HTTPS hosts found.')}</div>
          )}
          <div className="flex flex-col gap-2">
            {creds?.map((c) => (
              <div
                key={c.host}
                className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.host}</div>
                  {c.remotes.length > 0 && (
                    <div className="truncate text-xs text-muted-foreground">
                      {t('Used by {remotes}', { remotes: c.remotes.join(', ') })}
                    </div>
                  )}
                  <div
                    className={c.stored ? 'text-xs text-success' : 'text-xs text-muted-foreground'}
                  >
                    {c.stored
                      ? c.username
                        ? t('Stored for {username}', { username: c.username })
                        : t('Stored')
                      : t('Not stored')}
                  </div>
                </div>
                {c.stored && <Button onClick={() => remove(c)}>{t('Remove')}</Button>}
                <Button onClick={() => save(c)}>{t('Save credentials…')}</Button>
              </div>
            ))}
          </div>
        </div>
      </Row>
    </>
  );
}

// Global credential preferences: which credential helper git uses, what it has stored, and
// which stored account each host uses (per repository or for every repository).

import { RefreshCw, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button, Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { CredentialAccount, HostCredential } from '@/lib/types';
import { useGitHub } from '@/stores/github';
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

const badge = 'rounded border px-1.5 text-[10.5px] leading-4 whitespace-nowrap';

export function CredentialsPrefs() {
  const repo = useRepo((s) => s.path) ?? undefined;
  const repoName = useRepo((s) => s.info?.name) ?? null;
  const ghUser = useGitHub((s) => s.user?.login) ?? null;
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

  /** Store a new account (or a new token for an existing one) on `host`. */
  const save = async (c: HostCredential, username = '') => {
    const v = await ask({
      title: username
        ? t('Update the token of {username} on {host}', { username, host: c.host })
        : t('Add an account for {host}', { host: c.host }),
      description: t(
        'Saved through the credential helper selected above. Several accounts can be stored for one host; choose below which one each repository uses. For GitHub and GitLab use a personal access token as the password.',
      ),
      fields: [
        { name: 'username', label: t('Username'), initial: username, required: true },
        { name: 'password', label: t('Password or token'), type: 'password', required: true },
      ],
      confirmLabel: t('Save'),
    });
    if (!v) return;
    const name = (v.username as string).trim();
    try {
      await api.saveCredential(c.host, name, v.password as string);
      toast('success', t('Saved {username} for {host}', { username: name, host: c.host }));
    } catch (e) {
      toast('error', t('Could not save credentials'), (e as Error).message);
    }
    load();
  };

  const remove = async (c: HostCredential, a: CredentialAccount) => {
    if (
      !(await confirm(
        t('Remove credentials'),
        t(
          'Remove the stored password or token of {username} on {host}? Git asks for it again the next time it needs it.',
          { username: a.username, host: c.host },
        ),
        t('Remove'),
        true,
      ))
    )
      return;
    try {
      await api.eraseCredential(c.host, a.username);
      // A choice pointing at a removed account would make git prompt; drop it too.
      if (a.forRepo && repo) await api.chooseCredential(c.host, null, repo);
      if (a.globalDefault) await api.chooseCredential(c.host, null);
      toast('success', t('Removed {username} from {host}', { username: a.username, host: c.host }));
    } catch (e) {
      toast('error', t('Could not remove credentials'), (e as Error).message);
    }
    load();
  };

  /** `scope`: this repository, or every repository (global). `username` null clears. */
  const choose = async (c: HostCredential, username: string | null, scope: 'repo' | 'global') => {
    try {
      await api.chooseCredential(c.host, username, scope === 'repo' ? repo : undefined);
      if (username)
        toast(
          'success',
          scope === 'repo'
            ? t('{repo} now uses {username} on {host}', {
                repo: repoName ?? t('This repository'),
                username,
                host: c.host,
              })
            : t('{username} is now the default account on {host}', { username, host: c.host }),
        );
    } catch (e) {
      toast('error', t('Could not change the account'), (e as Error).message);
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
        <div className="w-[620px] max-w-full">
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
              <HostCard
                key={c.host}
                c={c}
                repoName={repo ? repoName : null}
                ghUser={c.host === 'github.com' ? ghUser : null}
                onSave={(u) => save(c, u)}
                onRemove={(a) => remove(c, a)}
                onChoose={(u, scope) => choose(c, u, scope)}
              />
            ))}
          </div>
        </div>
      </Row>
    </>
  );
}

function HostCard({
  c,
  repoName,
  ghUser,
  onSave,
  onRemove,
  onChoose,
}: {
  c: HostCredential;
  /** Name of the open repository (null when none is open). */
  repoName: string | null;
  /** GitStudio's own GitHub sign-in, for github.com. */
  ghUser: string | null;
  onSave: (username?: string) => void;
  onRemove: (a: CredentialAccount) => void;
  onChoose: (username: string | null, scope: 'repo' | 'global') => void;
}) {
  const repo = repoName ?? t('This repository');
  const chosen = !!(c.repoChoice || c.globalChoice);
  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{c.host}</div>
          <div className="text-xs text-muted-foreground">
            {[
              c.remotes.length ? t('Used by {remotes}', { remotes: c.remotes.join(', ') }) : null,
              c.accounts.length
                ? t('{n} stored accounts', { n: c.accounts.length })
                : t('Not stored'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <Button onClick={() => onSave()}>{t('Add account…')}</Button>
      </div>

      {c.accounts.length > 0 && (
        <div className="border-t border-border">
          {c.accounts.map((a) => {
            const inUse = c.username === a.username;
            return (
              <div
                key={a.username}
                className={cn(
                  'flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5',
                  inUse && 'bg-accent-soft/50',
                )}
              >
                {/* Name and badges; the actions wrap below when the panel is narrow. */}
                <div className="flex min-w-[200px] flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                  <UserRound
                    className={cn(
                      'size-3.5 shrink-0',
                      inUse ? 'text-accent' : 'text-muted-foreground',
                    )}
                  />
                  <span className={cn('break-all', inUse && 'font-semibold')}>{a.username}</span>
                  {repoName && inUse && (
                    <span className={cn(badge, 'border-accent text-accent')}>
                      {t('used by {repo}', { repo })}
                    </span>
                  )}
                  {a.helperDefault && (
                    <span className={cn(badge, 'border-border text-muted-foreground')}>
                      {a.globalDefault ? t('default for all repositories') : t('default')}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1">
                  {repoName && !a.forRepo && (
                    <Button size="sm" variant="ghost" onClick={() => onChoose(a.username, 'repo')}>
                      {t('Use for {repo}', { repo })}
                    </Button>
                  )}
                  {!a.globalDefault && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onChoose(a.username, 'global')}
                    >
                      {t('Make default')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('Replace the stored password or token')}
                    onClick={() => onSave(a.username)}
                  >
                    {t('Update token…')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onRemove(a)}>
                    {t('Remove')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(c.repoChoice || c.globalChoice || ghUser) && (
        <div className="space-y-0.5 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
          {repoName && c.repoChoice && (
            <div>
              {t('{repo} is set to {username}.', { repo, username: c.repoChoice })}{' '}
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => onChoose(null, 'repo')}
              >
                {t('Use the default account instead')}
              </button>
            </div>
          )}
          {c.globalChoice && (
            <div>
              {t('Every repository without its own choice uses {username}.', {
                username: c.globalChoice,
              })}{' '}
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => onChoose(null, 'global')}
              >
                {t('Clear the default')}
              </button>
            </div>
          )}
          {ghUser && (
            <div>
              {chosen
                ? t(
                    'Fetch, pull and push here go through the chosen account, not your GitHub sign-in (@{login}).',
                    { login: ghUser },
                  )
                : t(
                    'Without a chosen account, fetch, pull and push use your GitHub sign-in (@{login}).',
                    { login: ghUser },
                  )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Repository-specific preferences: overrides written to the repository's own (--local) Git
// config. Anything left on "Inherit global" falls back to the global config.

import { useCallback, useEffect, useState } from 'react';

import { Spinner } from '@/components/ui';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { toast } from '@/stores/ui';
import { Field, Row, Select, Title, Toggle } from './prefsKit';

const KEYS = ['user.name', 'user.email', 'credential.helper', 'core.autocrlf', 'commit.gpgsign'];
const INHERIT = '\u0000inherit';

type Values = Record<string, string>;

const baseName = (p: string) => p.replace(/[\\/]+$/, '').replace(/^.*[\\/]/, '');

export function RepoPrefs({ repo }: { repo: string }) {
  const [local, setLocal] = useState<Values | null>(null);
  const [global, setGlobal] = useState<Values>({});
  // The identity fields stay visible after switching the override on, before anything is typed.
  const [customIdentity, setCustomIdentity] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([api.gitConfig(KEYS, repo), api.gitConfig(KEYS).catch(() => ({}) as Values)])
      .then(([l, g]) => {
        if (!live) return;
        setLocal(l);
        setGlobal(g);
        setCustomIdentity(!!(l['user.name'] || l['user.email']));
      })
      .catch((e) => {
        if (!live) return;
        setLocal({});
        toast('error', t('Could not read the repository config'), (e as Error).message);
      });
    return () => {
      live = false;
    };
  }, [repo]);

  const set = useCallback(
    async (key: string, value: string | null) => {
      try {
        await api.setGitConfig(key, value, repo);
        setLocal((v) => ({ ...(v ?? {}), [key]: value ?? '' }));
      } catch (e) {
        toast('error', t('Could not set {key}', { key }), (e as Error).message);
      }
    },
    [repo],
  );

  if (!local) return <Spinner />;

  const val = (key: string) => local[key] || INHERIT;
  const setOrInherit = (key: string) => (v: string) => set(key, v === INHERIT ? null : v);
  const inheritLabel = (key: string, fmt?: (v: string) => string) => {
    const g = global[key];
    return g
      ? t('Inherit global ({value})', { value: fmt ? fmt(g) : g })
      : t('Inherit global (not set)');
  };

  const toggleIdentity = async (on: boolean) => {
    setCustomIdentity(on);
    if (on) return;
    if (local['user.name']) await set('user.name', null);
    if (local['user.email']) await set('user.email', null);
  };

  return (
    <>
      <Title>{t('Repository Preferences')}</Title>
      <div className="-mt-4 mb-6 text-muted-foreground">
        {t('Settings for {name} only, saved in its .git/config.', { name: baseName(repo) })}
        <div className="font-mono text-xs">{repo}</div>
      </div>

      <Row
        label={t('Commit Identity')}
        help={t('Global identity: {name} <{email}>', {
          name: global['user.name'] || t('(no name)'),
          email: global['user.email'] || t('no email'),
        })}
      >
        <Toggle
          checked={customIdentity}
          onChange={toggleIdentity}
          label={t('Use a different identity for this repository')}
        />
      </Row>
      {customIdentity && (
        <>
          <Row label={t('Author Name')} help={t('user.name for this repository.')}>
            <Field
              value={local['user.name'] ?? ''}
              placeholder={global['user.name']}
              onSave={(v) => set('user.name', v.trim() || null)}
            />
          </Row>
          <Row label={t('Author Email')} help={t('user.email for this repository.')}>
            <Field
              value={local['user.email'] ?? ''}
              placeholder={global['user.email']}
              onSave={(v) => set('user.email', v.trim() || null)}
            />
          </Row>
        </>
      )}

      <Row
        label={t('Credential Helper (this repository)')}
        help={t('credential.helper for this repository only.')}
        warn={
          local['credential.helper'] === 'store'
            ? t('The plain-text store saves passwords unencrypted in your home folder.')
            : undefined
        }
      >
        <Select
          value={val('credential.helper')}
          onChange={setOrInherit('credential.helper')}
          options={[
            { value: INHERIT, label: inheritLabel('credential.helper') },
            { value: 'manager', label: t('Git Credential Manager') },
            { value: 'wincred', label: t('Windows Credential Store') },
            { value: 'store', label: t('Plain-text store (~/.git-credentials)') },
          ]}
        />
      </Row>

      <Row
        label={t('Line Endings (this repository)')}
        help={t('core.autocrlf for this repository only.')}
      >
        <Select
          value={val('core.autocrlf')}
          onChange={setOrInherit('core.autocrlf')}
          options={[
            { value: INHERIT, label: inheritLabel('core.autocrlf') },
            { value: 'true', label: t('true — CRLF in working tree, LF in repo') },
            { value: 'input', label: t('input — convert CRLF to LF on commit') },
            { value: 'false', label: t('false — never convert') },
          ]}
        />
      </Row>

      <Row
        label={t('Sign Commits')}
        help={t(
          'commit.gpgsign for this repository only. Requires a signing key already configured for git.',
        )}
      >
        <Select
          value={val('commit.gpgsign')}
          onChange={setOrInherit('commit.gpgsign')}
          options={[
            {
              value: INHERIT,
              label: inheritLabel('commit.gpgsign', (v) => (v === 'true' ? t('on') : t('off'))),
            },
            { value: 'true', label: t('On') },
            { value: 'false', label: t('Off') },
          ]}
        />
      </Row>
    </>
  );
}

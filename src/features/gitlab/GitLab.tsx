import { ExternalLink, KeyRound } from 'lucide-react';
import { useState } from 'react';

import { Button, Input, Modal, Spinner } from '@/components/ui';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { openUrl } from '@/lib/native';
import type { GitLabUser } from '@/lib/types';
import { useGitLab } from '@/stores/gitlab';
import { toast } from '@/stores/ui';

const TOKEN_URL =
  'https://gitlab.com/-/user_settings/personal_access_tokens?name=GitStudio&scopes=api,read_repository,write_repository';

/** GitLab tanuki mark. */
export function GitLabIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M23.955 13.587l-1.342-4.135-2.664-8.189a.455.455 0 0 0-.867 0L16.418 9.45H7.582L4.919 1.263a.455.455 0 0 0-.867 0L1.388 9.452.045 13.587a.924.924 0 0 0 .331 1.023L12 23.054l11.623-8.443a.92.92 0 0 0 .332-1.024" />
    </svg>
  );
}

/** The ways to connect a GitLab.com account: reuse Git Credential Manager, or paste a token. */
export function GitLabConnectOptions({ onDone }: { onDone?: (u: GitLabUser) => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<'gcm' | 'token' | null>(null);

  const finish = (u: GitLabUser) => {
    useGitLab.getState().setUser(u);
    toast('success', t('Connected to GitLab as {login}', { login: u.login }));
    onDone?.(u);
  };

  const importToken = async () => {
    setBusy('gcm');
    try {
      finish(await api.glImportToken());
    } catch (e) {
      toast('error', t('Could not reuse existing credentials'), (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const signIn = async () => {
    setBusy('token');
    try {
      finish(await api.glSignInToken(token.trim()));
      setToken('');
    } catch (e) {
      toast('error', t('Could not connect to GitLab'), (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex w-full max-w-[460px] flex-col gap-3">
      <Button className="h-10 justify-start" disabled={busy !== null} onClick={importToken}>
        {busy === 'gcm' ? <Spinner /> : <KeyRound className="size-4" />}{' '}
        {t('Use Git Credential Manager login')}
      </Button>
      <div className="rounded-md border border-border p-3">
        <div className="mb-1 font-medium">{t('Use a personal access token')}</div>
        <div className="mb-2 text-xs text-muted-foreground">
          {t('Create a token with the api, read_repository and write_repository scopes.')}{' '}
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => openUrl(TOKEN_URL)}
          >
            {t('Create a token on GitLab.com')} <ExternalLink className="inline size-3" />
          </button>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (token.trim() && !busy) void signIn();
          }}
        >
          <Input
            type="password"
            placeholder="glpat-…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <Button type="submit" variant="primary" disabled={!token.trim() || busy !== null}>
            {busy === 'token' && <Spinner />} {t('Connect')}
          </Button>
        </form>
      </div>
    </div>
  );
}

export function GitLabConnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Connect to GitLab.com')}
      description={t('The token is stored in the Windows Credential Manager.')}
      width={500}
    >
      <GitLabConnectOptions onDone={onClose} />
    </Modal>
  );
}

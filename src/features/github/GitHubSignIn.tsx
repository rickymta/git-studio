import { Check, Copy, ExternalLink, KeyRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button, Github, Input, Modal, Spinner } from '@/components/ui';
import { api } from '@/lib/ipc';
import { copyText, openUrl } from '@/lib/native';
import type { DeviceCode } from '@/lib/types';
import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';
import { toast } from '@/stores/ui';

const TOKEN_URL =
  'https://github.com/settings/tokens/new?description=GitStudio&scopes=repo,read:org,user:email,workflow';

/** Sign in with the OAuth device flow (needs a client ID) or a personal access token. */
export function GitHubSignIn({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mounted only while open, so every opening starts from a clean state.
  return open ? <SignInBody onClose={onClose} /> : null;
}

function SignInBody({ onClose }: { onClose: () => void }) {
  const open = true;
  const clientId = useRepo((s) => s.settings?.githubClientId ?? '');
  const setUser = useGitHub((s) => s.setUser);
  const [mode, setMode] = useState<'choose' | 'device' | 'token'>('choose');
  const [device, setDevice] = useState<DeviceCode | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const cancelled = useRef(false);

  // Stop polling the device flow once the dialog closes.
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const finish = (u: Awaited<ReturnType<typeof api.ghSignInToken>>) => {
    setUser(u);
    toast('success', `Signed in to GitHub as ${u.login}`);
    onClose();
  };

  const startDevice = async () => {
    setBusy(true);
    try {
      const d = await api.ghDeviceStart();
      setDevice(d);
      setMode('device');
      await copyText(d.userCode).catch(() => {});
      await openUrl(d.verificationUri);
      void poll(d, d.interval);
    } catch (e) {
      toast('error', 'GitHub sign-in failed', (e as Error).message);
      setBusy(false);
    }
  };

  const poll = async (d: DeviceCode, interval: number) => {
    const deadline = Date.now() + d.expiresIn * 1000;
    let wait = Math.max(interval, 5);
    while (!cancelled.current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, wait * 1000));
      if (cancelled.current) return;
      try {
        const r = await api.ghDevicePoll(d.deviceCode);
        if (r.status === 'done') return finish(r.user);
        if (r.status === 'slowDown') wait = r.interval;
      } catch (e) {
        toast('error', 'GitHub sign-in failed', (e as Error).message);
        setBusy(false);
        setMode('choose');
        return;
      }
    }
  };

  const signInToken = async () => {
    setBusy(true);
    try {
      finish(await api.ghSignInToken(token));
    } catch (e) {
      toast('error', 'Token rejected', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Connect to GitHub" width={480}>
      {mode === 'choose' && (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground">
            GitStudio uses your GitHub account to clone private repositories, push and pull over
            HTTPS, and work with pull requests. The token is kept in the OS credential store.
          </p>
          <Button
            variant="primary"
            className="h-10"
            onClick={startDevice}
            disabled={busy || !clientId}
          >
            {busy ? <Spinner /> : <Github className="size-4" />} Sign in with browser
          </Button>
          {!clientId && (
            <p className="text-xs text-muted-foreground">
              Browser sign-in needs a GitHub OAuth App client ID (with device flow enabled) in
              Settings. Until then, use a personal access token.
            </p>
          )}
          <Button className="h-10" onClick={() => setMode('token')}>
            <KeyRound className="size-4" /> Use a personal access token
          </Button>
        </div>
      )}

      {mode === 'device' && device && (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-muted-foreground">
            Enter this code on GitHub (it is already in your clipboard):
          </p>
          <div className="flex items-center gap-2">
            <code className="selectable rounded-md bg-surface-muted px-4 py-2 font-mono text-2xl tracking-[0.2em]">
              {device.userCode}
            </code>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await copyText(device.userCode);
                setCopied(true);
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
          <Button onClick={() => openUrl(device.verificationUri)}>
            <ExternalLink className="size-4" /> Open {device.verificationUri}
          </Button>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Spinner /> Waiting for you to approve…
          </div>
        </div>
      )}

      {mode === 'token' && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void signInToken();
          }}
        >
          <p className="text-muted-foreground">
            Create a token with the <code>repo</code>, <code>read:org</code>,{' '}
            <code>user:email</code> and <code>workflow</code> scopes (classic), or a fine-grained
            token with Contents and Pull requests read/write.
          </p>
          <Button size="sm" className="self-start" onClick={() => openUrl(TOKEN_URL)}>
            <ExternalLink className="size-3.5" /> Create a token on GitHub
          </Button>
          <Input
            autoFocus
            type="password"
            placeholder="ghp_… or github_pat_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setMode('choose')}>Back</Button>
            <Button type="submit" variant="primary" disabled={busy || !token.trim()}>
              {busy && <Spinner />} Connect
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

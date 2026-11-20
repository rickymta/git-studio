import { Cloud, Globe, Trash2, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { Button, Github, IconButton, Input, Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import * as A from '@/features/actions';
import { GitLabConnectDialog, GitLabIcon } from '@/features/gitlab/GitLab';
import { RepoCombobox } from '@/features/welcome/CloneDialog';
import { t } from '@/lib/i18n';
import type { GitHubRepo, Remote } from '@/lib/types';
import { useGitHub } from '@/stores/github';
import { ensureGitLabChecked, useGitLab } from '@/stores/gitlab';
import { useRemotePanel, type RemoteSource } from '@/stores/remotePanel';
import { useRepo } from '@/stores/repo';
import { toast } from '@/stores/ui';

/** GitKraken-style "Add Remote" / "Edit Remote" panel that slides over the graph. */
export function RemotePanel({ onSignIn }: { onSignIn: () => void }) {
  const target = useRemotePanel((s) => s.target);
  const close = useRemotePanel((s) => s.close);
  const remotes = useRepo((s) => s.refs?.remotes);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, close]);

  if (!target) return null;
  const editing = target.mode === 'edit' ? remotes?.find((r) => r.name === target.name) : null;
  if (target.mode === 'edit' && !editing) return null;

  return (
    <div className="absolute inset-y-0 left-0 z-30 flex w-[min(500px,100%)] flex-col border-r border-border bg-surface shadow-2xl">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-5">
        <Cloud className="size-5 text-muted-foreground" />
        <h2 className="flex-1 truncate text-[18px]">
          {editing ? t('Edit remote {name}', { name: editing.name }) : t('Add Remote')}
        </h2>
        <IconButton label={t('Close')} onClick={close}>
          <X className="size-4" />
        </IconButton>
      </div>
      {editing ? (
        // Keyed so switching to another remote starts from its values.
        <EditForm key={editing.name} remote={editing} onDone={close} />
      ) : (
        <AddForm
          key={target.mode === 'add' ? target.source : ''}
          initial={target.mode === 'add' ? target.source : 'url'}
          onDone={close}
          onSignIn={onSignIn}
        />
      )}
    </div>
  );
}

function SourceTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-24 flex-col items-center gap-1.5 border-b-2 pt-2 pb-2.5 text-[13px] transition-colors',
        active
          ? 'border-foreground text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      <span className="[&>svg]:size-7">{icon}</span>
      {label}
    </button>
  );
}

const FieldLabel = ({ children, hint }: { children: ReactNode; hint?: string }) => (
  <div className="mb-1.5 flex items-baseline gap-2">
    <span className="text-[14px]">{children}</span>
    {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
  </div>
);

const submitCls =
  'mt-2 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-success font-semibold text-background transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';

function AddForm({
  initial,
  onDone,
  onSignIn,
}: {
  initial: RemoteSource;
  onDone: () => void;
  onSignIn: () => void;
}) {
  const remotes = useRepo((s) => s.refs?.remotes ?? []);
  const preferSsh = useRepo((s) => s.settings?.preferSsh ?? false);
  const gh = useGitHub();
  const gl = useGitLab();
  const [source, setSource] = useState<RemoteSource>(initial);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [url, setUrl] = useState('');
  const [pushUrl, setPushUrl] = useState('');
  const [picked, setPicked] = useState<Record<'github' | 'gitlab', GitHubRepo | null>>({
    github: null,
    gitlab: null,
  });
  const [ssh, setSsh] = useState(preferSsh);
  const [busy, setBusy] = useState(false);
  const [glConnect, setGlConnect] = useState(false);

  useEffect(() => ensureGitLabChecked(), []);
  const { user: ghUser, repos: ghRepos, loadRepos: ghLoad } = gh;
  useEffect(() => {
    if (source === 'github' && ghUser && !ghRepos)
      ghLoad().catch((e) => toast('error', t('Could not list repositories'), e.message));
  }, [source, ghUser, ghRepos, ghLoad]);
  const { user: glUser, repos: glRepos, loadRepos: glLoad } = gl;
  useEffect(() => {
    if (source === 'gitlab' && glUser && !glRepos)
      glLoad().catch((e) => toast('error', t('Could not list repositories'), e.message));
  }, [source, glUser, glRepos, glLoad]);

  const hasOrigin = remotes.some((r) => r.name === 'origin');
  const repo = source === 'url' ? null : picked[source];
  // Default name: origin first, then the repository's owner (like GitKraken).
  const suggested = hasOrigin
    ? repo
      ? repo.fullName.slice(0, repo.fullName.lastIndexOf('/')).split('/').pop()!
      : ''
    : 'origin';
  const finalName = (nameTouched ? name : name || suggested).trim();
  const finalUrl = source === 'url' ? url.trim() : repo ? (ssh ? repo.sshUrl : repo.cloneUrl) : '';
  const taken = remotes.some((r) => r.name === finalName);
  const connected = source === 'url' || (source === 'github' ? !!gh.user : !!gl.user);

  const submit = async () => {
    setBusy(true);
    const ok = await A.createRemote(finalName, finalUrl, source === 'url' ? pushUrl.trim() : '');
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <>
      <div className="flex shrink-0 justify-center gap-2 border-b border-border px-5">
        <SourceTab
          active={source === 'url'}
          onClick={() => setSource('url')}
          icon={<Globe />}
          label="URL"
        />
        <SourceTab
          active={source === 'github'}
          onClick={() => setSource('github')}
          icon={<Github />}
          label="GitHub"
        />
        <SourceTab
          active={source === 'gitlab'}
          onClick={() => setSource('gitlab')}
          icon={<GitLabIcon />}
          label="GitLab"
        />
      </div>

      <form
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (finalName && finalUrl && !taken && !busy) void submit();
        }}
      >
        {source === 'gitlab' && !gl.checked ? (
          <div className="flex justify-center py-10 text-muted-foreground">
            <Spinner className="size-5" />
          </div>
        ) : !connected ? (
          <div className="flex flex-col items-center gap-4 py-10 text-muted-foreground">
            {source === 'github' ? (
              <Github className="size-10" />
            ) : (
              <GitLabIcon className="size-10" />
            )}
            <div className="text-[15px]">
              {t('{provider} is not connected', {
                provider: source === 'github' ? 'GitHub' : 'GitLab',
              })}
            </div>
            <Button
              variant="primary"
              onClick={source === 'github' ? onSignIn : () => setGlConnect(true)}
            >
              {t('Connect to {provider}', {
                provider: source === 'github' ? 'GitHub' : 'GitLab',
              })}
            </Button>
          </div>
        ) : (
          <>
            {source !== 'url' && (
              <div>
                <FieldLabel>{source === 'github' ? t('GitHub Repo') : t('GitLab Repo')}</FieldLabel>
                <RepoCombobox
                  key={source}
                  repos={(source === 'github' ? gh.repos : gl.repos) ?? []}
                  loading={source === 'github' ? gh.reposLoading : gl.reposLoading}
                  value={picked[source]}
                  onPick={(r) => setPicked((p) => ({ ...p, [source]: r }))}
                />
              </div>
            )}
            <div>
              <FieldLabel>{t('Name')}</FieldLabel>
              <Input
                autoFocus={source === 'url'}
                value={nameTouched ? name : name || suggested}
                onChange={(e) => {
                  setNameTouched(true);
                  setName(e.target.value);
                }}
                placeholder={hasOrigin ? 'upstream' : 'origin'}
                spellCheck={false}
              />
              {taken && (
                <div className="mt-1 text-xs text-danger">
                  {t('A remote named {name} already exists', { name: finalName })}
                </div>
              )}
            </div>
            {source === 'url' ? (
              <>
                <div>
                  <FieldLabel>{t('Pull URL')}</FieldLabel>
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo.git"
                    spellCheck={false}
                  />
                </div>
                <div>
                  <FieldLabel hint={t('optional')}>{t('Push URL')}</FieldLabel>
                  <Input
                    value={pushUrl}
                    onChange={(e) => setPushUrl(e.target.value)}
                    placeholder={url || t('Same as the pull URL')}
                    spellCheck={false}
                  />
                </div>
              </>
            ) : (
              repo && (
                <div>
                  <FieldLabel>URL</FieldLabel>
                  <div className="mb-2 flex gap-4 text-[13px]">
                    {(['https', 'ssh'] as const).map((k) => (
                      <label key={k} className="flex cursor-pointer items-center gap-1.5">
                        <input
                          type="radio"
                          className="accent-[var(--accent)]"
                          checked={(k === 'ssh') === ssh}
                          onChange={() => setSsh(k === 'ssh')}
                        />
                        {k.toUpperCase()}
                      </label>
                    ))}
                  </div>
                  <div className="selectable truncate rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[12.5px] text-muted-foreground">
                    {finalUrl}
                  </div>
                </div>
              )
            )}
            <button
              type="submit"
              className={submitCls}
              disabled={busy || !finalName || !finalUrl || taken}
            >
              {busy && <Spinner />} {t('Add Remote')}
            </button>
          </>
        )}
      </form>
      <GitLabConnectDialog open={glConnect} onClose={() => setGlConnect(false)} />
    </>
  );
}

function EditForm({ remote, onDone }: { remote: Remote; onDone: () => void }) {
  const remotes = useRepo((s) => s.refs?.remotes ?? []);
  const [name, setName] = useState(remote.name);
  const [url, setUrl] = useState(remote.url);
  const [pushUrl, setPushUrl] = useState(
    remote.pushUrl && remote.pushUrl !== remote.url ? remote.pushUrl : '',
  );
  const [busy, setBusy] = useState(false);
  const n = name.trim();
  const taken = n !== remote.name && remotes.some((r) => r.name === n);

  const submit = async () => {
    setBusy(true);
    const ok = await A.updateRemote(remote, { name: n, url: url.trim(), pushUrl: pushUrl.trim() });
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto border-t border-border p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (n && url.trim() && !taken && !busy) void submit();
      }}
    >
      <div>
        <FieldLabel>{t('Name')}</FieldLabel>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          spellCheck={false}
        />
        {taken && (
          <div className="mt-1 text-xs text-danger">
            {t('A remote named {name} already exists', { name: n })}
          </div>
        )}
      </div>
      <div>
        <FieldLabel>{t('Pull URL')}</FieldLabel>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
      </div>
      <div>
        <FieldLabel hint={t('optional')}>{t('Push URL')}</FieldLabel>
        <Input
          value={pushUrl}
          onChange={(e) => setPushUrl(e.target.value)}
          placeholder={url || t('Same as the pull URL')}
          spellCheck={false}
        />
      </div>
      <button type="submit" className={submitCls} disabled={busy || !n || !url.trim() || taken}>
        {busy && <Spinner />} {t('Save')}
      </button>
      <Button
        variant="ghost"
        className="text-danger"
        onClick={async () => {
          onDone();
          await A.removeRemote(remote.name);
        }}
      >
        <Trash2 className="size-4" /> {t('Remove {name}', { name: remote.name })}
      </Button>
    </form>
  );
}

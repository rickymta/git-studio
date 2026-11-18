import { FolderOpen, Lock, Search, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button, Github, Input, Modal, Spinner, cn } from '@/components/ui';
import { joinPath, relativeTime, repoNameFromUrl } from '@/lib/format';
import { api } from '@/lib/ipc';
import { pickFolder } from '@/lib/native';
import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';
import { toast } from '@/stores/ui';

interface Props {
  open: boolean;
  onClose: () => void;
  onSignIn: () => void;
}

export function CloneDialog(props: Props) {
  // Mounted only while open, so every opening starts from a clean state.
  return props.open ? <CloneBody {...props} /> : null;
}

function CloneBody({ open, onClose, onSignIn }: Props) {
  const settings = useRepo((s) => s.settings);
  const adopt = useRepo((s) => s.adopt);
  const { user, repos, reposLoading, loadRepos } = useGitHub();
  const [tab, setTab] = useState<'github' | 'url'>(user ? 'github' : 'url');
  const [url, setUrl] = useState('');
  const [parent, setParent] = useState(settings?.cloneDir ?? '');
  const [customName, setName] = useState<string | null>(null);
  const setNameTouched = (touched: boolean) => {
    if (!touched) setName(null);
  };
  const name = customName ?? repoNameFromUrl(url);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user && !repos)
      loadRepos().catch((e) => toast('error', 'Could not list repositories', e.message));
  }, [user, repos, loadRepos]);

  const shown = useMemo(() => {
    const q = filter.toLowerCase();
    return (repos ?? []).filter((r) => r.fullName.toLowerCase().includes(q)).slice(0, 200);
  }, [repos, filter]);

  const dest = parent && name ? joinPath(parent, name) : '';

  const clone = async () => {
    setBusy(true);
    try {
      const info = await api.clone(url.trim(), dest);
      toast('success', `Cloned ${info.name}`);
      onClose();
      await adopt(info);
    } catch (e) {
      toast('error', 'Clone failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Clone a repository" width={620}>
      <div className="mb-3 flex gap-1 rounded-md bg-surface-muted p-1">
        {(['github', 'url'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'flex h-7 flex-1 items-center justify-center gap-1.5 rounded',
              tab === t ? 'bg-surface shadow' : 'text-muted-foreground',
            )}
          >
            {t === 'github' ? <Github className="size-4" /> : null}
            {t === 'github' ? 'GitHub' : 'URL'}
          </button>
        ))}
      </div>

      {tab === 'github' &&
        (!user ? (
          <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
            Connect your GitHub account to browse your repositories.
            <Button variant="primary" onClick={onSignIn}>
              <Github className="size-4" /> Connect GitHub
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
              <Input
                autoFocus
                className="pl-8"
                placeholder="Filter repositories"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <div className="h-64 overflow-auto rounded-md border border-border">
              {reposLoading && (
                <div className="flex items-center justify-center gap-2 p-6 text-muted-foreground">
                  <Spinner /> Loading repositories…
                </div>
              )}
              {shown.map((r) => (
                <button
                  key={r.fullName}
                  type="button"
                  onClick={() => {
                    setUrl(settings?.preferSsh ? r.sshUrl : r.cloneUrl);
                    setNameTouched(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-surface-hover',
                    (url === r.cloneUrl || url === r.sshUrl) && 'bg-selection',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-medium">
                      <span className="truncate">{r.fullName}</span>
                      {r.private && <Lock className="size-3 shrink-0 text-muted-foreground" />}
                    </div>
                    {r.description && (
                      <div className="truncate text-xs text-muted-foreground">{r.description}</div>
                    )}
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <Star className="size-3" /> {r.stargazersCount}
                  </span>
                  {r.updatedAt && (
                    <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                      {relativeTime(Date.parse(r.updatedAt) / 1000)}
                    </span>
                  )}
                </button>
              ))}
              {repos && shown.length === 0 && (
                <div className="p-6 text-center text-muted-foreground">No repositories match.</div>
              )}
            </div>
          </div>
        ))}

      {tab === 'url' && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Repository URL</span>
          <Input
            autoFocus
            placeholder="https://github.com/owner/repo.git"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
          />
        </label>
      )}

      <div className="mt-3 grid grid-cols-[1fr_200px] gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Clone into folder</span>
          <div className="flex gap-1">
            <Input value={parent} onChange={(e) => setParent(e.target.value)} spellCheck={false} />
            <Button
              aria-label="Browse"
              onClick={async () => {
                const p = await pickFolder('Clone into', parent);
                if (p) setParent(p);
              }}
            >
              <FolderOpen className="size-4" />
            </Button>
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Folder name</span>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            spellCheck={false}
          />
        </label>
      </div>
      {dest && <div className="mt-1 truncate text-xs text-muted-foreground">→ {dest}</div>}

      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={clone} disabled={busy || !url.trim() || !dest}>
          {busy && <Spinner />} {busy ? 'Cloning…' : 'Clone'}
        </Button>
      </div>
    </Modal>
  );
}

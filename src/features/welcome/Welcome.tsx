import { Download, FolderOpen, FolderPlus, GitBranch, LayoutGrid, Plus, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { Avatar, Github, IconButton } from '@/components/ui';
import { basename, relativeTime } from '@/lib/format';
import { api } from '@/lib/ipc';
import { pickFolder } from '@/lib/native';
import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';
import { ask, toast } from '@/stores/ui';
import { useWorkspaces } from '@/stores/workspace';

export function Welcome({
  onClone,
  onSignIn,
  onNewWorkspace,
}: {
  onClone: () => void;
  onSignIn: () => void;
  onNewWorkspace: () => void;
}) {
  const workspaces = useWorkspaces((s) => s.data.items);
  const activate = useWorkspaces((s) => s.activate);
  const settings = useRepo((s) => s.settings);
  const open = useRepo((s) => s.open);
  const adopt = useRepo((s) => s.adopt);
  const setSettings = useRepo((s) => s.setSettings);
  const user = useGitHub((s) => s.user);

  const openFolder = async () => {
    const p = await pickFolder('Open a Git repository');
    if (p) await open(p);
  };

  const initRepo = async () => {
    const p = await pickFolder('Choose a folder for the new repository');
    if (!p) return;
    const v = await ask({
      title: 'Initialize repository',
      description: p,
      fields: [{ name: 'branch', label: 'Initial branch', initial: 'main', required: true }],
      confirmLabel: 'Initialize',
    });
    if (!v) return;
    try {
      await adopt(await api.init(p, (v.branch as string).trim()));
    } catch (e) {
      toast('error', 'Could not initialize repository', (e as Error).message);
    }
  };

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-8">
      <div className="w-full max-w-3xl">
        <div className="mb-8 flex items-center gap-3">
          <img src="/icon.svg" alt="" className="size-12" />
          <div>
            <h1 className="text-2xl font-semibold">GitStudio</h1>
            <p className="text-muted-foreground">A visual Git client with GitHub built in.</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Action
            icon={<FolderOpen className="size-5" />}
            title="Open repository"
            text="A folder already under Git"
            onClick={openFolder}
          />
          <Action
            icon={<Download className="size-5" />}
            title="Clone"
            text="From GitHub or any URL"
            onClick={onClone}
          />
          <Action
            icon={<FolderPlus className="size-5" />}
            title="Initialize"
            text="Start a new repository"
            onClick={initRepo}
          />
        </div>

        <div className="mt-6 flex items-center gap-3 rounded-lg border border-border bg-surface p-4">
          {user ? (
            <>
              <Avatar name={user.login} url={user.avatarUrl} size={32} />
              <div className="flex-1">
                <div className="font-medium">{user.name ?? user.login}</div>
                <div className="text-xs text-muted-foreground">
                  Connected to GitHub as @{user.login}
                </div>
              </div>
            </>
          ) : (
            <>
              <Github className="size-8 text-muted-foreground" />
              <div className="flex-1">
                <div className="font-medium">Connect GitHub</div>
                <div className="text-xs text-muted-foreground">
                  Clone private repositories, push over HTTPS and manage pull requests.
                </div>
              </div>
              <button
                type="button"
                onClick={onSignIn}
                className="h-8 rounded-md bg-accent px-3 font-medium text-accent-foreground"
              >
                Connect
              </button>
            </>
          )}
        </div>

        <div className="mt-8 mb-2 flex items-center">
          <h2 className="flex-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Workspaces
          </h2>
          <button
            type="button"
            onClick={onNewWorkspace}
            className="flex items-center gap-1 text-xs text-accent hover:underline"
          >
            <Plus className="size-3.5" /> New workspace
          </button>
        </div>
        {workspaces.length === 0 ? (
          <button
            type="button"
            onClick={onNewWorkspace}
            className="flex w-full items-center gap-3 rounded-lg border border-dashed border-border p-4 text-left text-muted-foreground hover:border-accent hover:bg-surface-hover"
          >
            <LayoutGrid className="size-6 shrink-0" />
            <span>
              Group the repositories you work on together. Each workspace keeps its own tabs and
              shows branches, unpushed work and pull requests of all its repositories on one page.
            </span>
          </button>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {workspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => activate(w.id)}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left hover:border-accent hover:bg-surface-hover"
              >
                <span className="size-3 shrink-0 rounded-full" style={{ background: w.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{w.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {w.repos.length} repositor{w.repos.length === 1 ? 'y' : 'ies'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        <h2 className="mt-8 mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Recent repositories
        </h2>
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {(settings?.recent ?? []).length === 0 && (
            <div className="p-6 text-center text-muted-foreground">
              Nothing yet. Open or clone a repository.
            </div>
          )}
          {(settings?.recent ?? []).map((r) => (
            <div
              key={r.path}
              role="button"
              tabIndex={0}
              onClick={() => open(r.path)}
              onKeyDown={(e) => e.key === 'Enter' && open(r.path)}
              className="group flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0 hover:bg-surface-hover"
            >
              <GitBranch className="size-4 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{r.name || basename(r.path)}</div>
                <div className="truncate text-xs text-muted-foreground">{r.path}</div>
              </div>
              <span className="text-xs text-muted-foreground">{relativeTime(r.openedAt)}</span>
              <IconButton
                label="Remove from list"
                className="opacity-0 group-hover:opacity-100"
                onClick={async (e) => {
                  e.stopPropagation();
                  setSettings(await api.forgetRecent(r.path));
                }}
              >
                <X className="size-3.5" />
              </IconButton>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Action({
  icon,
  title,
  text,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-2 rounded-lg border border-border bg-surface p-4 text-left transition-colors hover:border-accent hover:bg-surface-hover"
    >
      <span className="text-accent">{icon}</span>
      <span className="font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{text}</span>
    </button>
  );
}

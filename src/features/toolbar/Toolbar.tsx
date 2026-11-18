import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  LogOut,
  Moon,
  RefreshCw,
  Settings as SettingsIcon,
  Sun,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Avatar, Dropdown, Github, Spinner, cn, type MenuItem } from '@/components/ui';
import { api } from '@/lib/ipc';
import { openUrl, pickFolder, revealPath } from '@/lib/native';
import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';
import { useUi } from '@/stores/ui';
import * as A from '../actions';

function ToolButton({
  icon,
  label,
  onClick,
  badge,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  badge?: number;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="relative flex h-12 w-14 flex-col items-center justify-center gap-0.5 rounded-md text-[11px] text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
    >
      {icon}
      {label}
      {!!badge && (
        <span className="absolute top-0.5 right-1.5 rounded-full bg-accent px-1 text-[10px] leading-4 font-semibold text-accent-foreground">
          {badge}
        </span>
      )}
    </button>
  );
}

export function Toolbar({
  onSignIn,
  onSettings,
}: {
  onSignIn: () => void;
  onSettings: () => void;
}) {
  const info = useRepo((s) => s.info);
  const settings = useRepo((s) => s.settings);
  const refs = useRepo((s) => s.refs);
  const busy = useRepo((s) => s.busy);
  const open = useRepo((s) => s.open);
  const close = useRepo((s) => s.close);
  const refresh = useRepo((s) => s.refresh);
  const { user, signOut } = useGitHub();
  const theme = useUi((s) => s.theme);
  const toggleTheme = useUi((s) => s.toggleTheme);
  if (!info) return null;
  const st = info.status;
  const hasGitHub = refs?.remotes.some((r) => r.github);

  const repoMenu: MenuItem[] = [
    ...(settings?.recent ?? [])
      .filter((r) => r.path !== info.path)
      .slice(0, 8)
      .map((r) => ({ label: r.name, onSelect: () => open(r.path) })),
    'sep',
    {
      label: 'Open repository…',
      onSelect: async () => {
        const p = await pickFolder('Open a Git repository');
        if (p) await open(p);
      },
    },
    { label: 'Show in file explorer', onSelect: () => revealPath(info.path) },
    { label: 'Close repository', onSelect: close },
  ];

  const pullMenu: MenuItem[] = [
    { label: 'Fetch all', onSelect: () => A.fetchAll() },
    {
      label: 'Pull (fast-forward only)',
      onSelect: () => useRepo.getState().run('Pull', (p) => api.pull(p, 'ff-only')),
    },
    {
      label: 'Pull (merge)',
      onSelect: () => useRepo.getState().run('Pull', (p) => api.pull(p, 'merge')),
    },
    {
      label: 'Pull (rebase)',
      onSelect: () => useRepo.getState().run('Pull', (p) => api.pull(p, 'rebase')),
    },
  ];

  return (
    <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border bg-surface px-2">
      <Dropdown items={repoMenu}>
        <button
          type="button"
          className="flex h-10 max-w-56 items-center gap-2 rounded-md px-2 hover:bg-surface-hover"
        >
          <FolderGit2 className="size-4 shrink-0 text-accent" />
          <div className="min-w-0 text-left">
            <div className="truncate text-[11px] text-muted-foreground">repository</div>
            <div className="truncate font-semibold">{info.name}</div>
          </div>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </Dropdown>
      <div className="flex h-10 max-w-56 items-center gap-2 rounded-md px-2">
        <GitBranch className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground">branch</div>
          <div
            className="truncate font-semibold"
            title={st.upstream ? `tracking ${st.upstream}` : 'no upstream'}
          >
            {st.branch ?? `detached @ ${st.head?.slice(0, 7) ?? '—'}`}
          </div>
        </div>
      </div>

      <div className="mx-auto flex items-center gap-0.5">
        <div className="flex">
          <ToolButton
            icon={<ArrowDownToLine className="size-4" />}
            label="Pull"
            badge={st.behind}
            onClick={() => A.pull()}
            disabled={!!busy}
          />
          <Dropdown items={pullMenu}>
            <button
              type="button"
              aria-label="Pull options"
              className="flex h-12 w-4 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover"
            >
              <ChevronDown className="size-3" />
            </button>
          </Dropdown>
        </div>
        <ToolButton
          icon={<ArrowUpFromLine className="size-4" />}
          label="Push"
          badge={st.ahead}
          onClick={() => A.push()}
          disabled={!!busy || !st.branch}
        />
        <ToolButton
          icon={<RefreshCw className="size-4" />}
          label="Fetch"
          onClick={() => A.fetchAll()}
          disabled={!!busy}
        />
        <div className="mx-1 h-8 w-px bg-border" />
        <ToolButton
          icon={<GitBranch className="size-4" />}
          label="Branch"
          onClick={() => A.newBranch()}
          disabled={!st.head}
        />
        <ToolButton icon={<Archive className="size-4" />} label="Stash" onClick={() => A.stash()} />
        <ToolButton
          icon={<ArchiveRestore className="size-4" />}
          label="Pop"
          badge={refs?.stashes.length}
          onClick={() => A.popLatest()}
          disabled={!refs?.stashes.length}
        />
        {hasGitHub && (
          <ToolButton
            icon={<GitPullRequest className="size-4" />}
            label="PR"
            onClick={() => A.createPullRequest()}
            disabled={!user || !st.branch}
          />
        )}
      </div>

      <div
        className={cn(
          'flex w-36 items-center justify-end gap-2 text-xs text-muted-foreground',
          !busy && 'invisible',
        )}
      >
        <Spinner /> {busy}…
      </div>
      <button
        type="button"
        title="Refresh (F5)"
        aria-label="Refresh"
        onClick={() => refresh()}
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover"
      >
        <RefreshCw className="size-4" />
      </button>
      <button
        type="button"
        title="Toggle theme"
        aria-label="Toggle theme"
        onClick={toggleTheme}
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover"
      >
        {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
      <button
        type="button"
        title="Settings"
        aria-label="Settings"
        onClick={onSettings}
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover"
      >
        <SettingsIcon className="size-4" />
      </button>
      {user ? (
        <Dropdown
          items={[
            { label: `@${user.login}`, onSelect: () => openUrl(user.htmlUrl) },
            'sep',
            {
              label: 'Sign out of GitHub',
              icon: <LogOut className="size-3.5" />,
              onSelect: () => signOut(),
            },
          ]}
        >
          <button
            type="button"
            aria-label="GitHub account"
            className="flex h-8 items-center gap-1.5 rounded-md px-1.5 hover:bg-surface-hover"
          >
            <Avatar name={user.login} url={user.avatarUrl} size={24} />
          </button>
        </Dropdown>
      ) : (
        <button
          type="button"
          onClick={onSignIn}
          className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 hover:bg-surface-hover"
        >
          <Github className="size-4" /> Connect
        </button>
      )}
    </div>
  );
}

import {
  ChevronDown,
  FolderGit2,
  LayoutGrid,
  LogOut,
  Moon,
  Plus,
  Settings as SettingsIcon,
  Sun,
  X,
} from 'lucide-react';
import { useState } from 'react';

import { Avatar, Dropdown, Github, cn } from '@/components/ui';
import { openUrl } from '@/lib/native';
import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';
import { useUi } from '@/stores/ui';
import { samePath, useWorkspaces } from '@/stores/workspace';

const same = (a: string | null, b: string) =>
  !!a && a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();

/** One tab per open repository, plus the start page when no repository is active. */
export function TabBar({
  onSignIn,
  onSettings,
  onNewWorkspace,
}: {
  onSignIn: () => void;
  onSettings: () => void;
  onNewWorkspace: () => void;
}) {
  const tabs = useRepo((s) => s.tabs);
  const path = useRepo((s) => s.path);
  const open = useRepo((s) => s.open);
  const closeTab = useRepo((s) => s.closeTab);
  const newTab = useRepo((s) => s.newTab);
  const moveTab = useRepo((s) => s.moveTab);
  const { user, signOut } = useGitHub();
  const theme = useUi((s) => s.theme);
  const toggleTheme = useUi((s) => s.toggleTheme);
  const [drag, setDrag] = useState<number | null>(null);
  const workspaces = useWorkspaces((s) => s.data);
  const activate = useWorkspaces((s) => s.activate);
  const ws = workspaces.items.find((w) => w.id === workspaces.active) ?? null;
  const inWorkspace = (p: string) => !ws || ws.repos.some((r) => samePath(r, p));

  const iconBtn =
    'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground';

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-background">
      <Dropdown
        items={[
          ...workspaces.items.map((w) => ({
            label: `${w.name}  (${w.repos.length})`,
            icon: <span className="block size-2.5 rounded-full" style={{ background: w.color }} />,
            onSelect: () => activate(w.id),
          })),
          ...(workspaces.items.length ? ['sep' as const] : []),
          { label: 'No workspace', icon: ws ? undefined : '✓', onSelect: () => activate('') },
          {
            label: 'New workspace…',
            icon: <Plus className="size-3.5" />,
            onSelect: onNewWorkspace,
          },
        ]}
      >
        <button
          type="button"
          title="Switch workspace"
          className="flex max-w-56 shrink-0 items-center gap-2 border-r border-border px-3 hover:bg-surface-hover"
        >
          {ws ? (
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: ws.color }} />
          ) : (
            <LayoutGrid className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className={cn('truncate', ws ? 'font-semibold' : 'text-muted-foreground')}>
            {ws ? ws.name : 'Workspaces'}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </Dropdown>
      {ws && (
        <button
          type="button"
          title={`${ws.name} overview`}
          aria-label="Workspace overview"
          onClick={() => useRepo.getState().newTab()}
          className={cn(
            'relative flex w-10 shrink-0 items-center justify-center border-r border-border',
            !path ? 'bg-surface text-foreground' : 'text-muted-foreground hover:bg-surface-hover',
          )}
        >
          {!path && (
            <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: ws.color }} />
          )}
          <LayoutGrid className="size-4" />
        </button>
      )}
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((t, i) => {
          const active = same(path, t.path);
          return (
            <div
              key={t.path}
              role="tab"
              aria-selected={active}
              title={t.path}
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (drag !== null && drag !== i) moveTab(drag, i);
                setDrag(null);
              }}
              onClick={() => open(t.path)}
              onAuxClick={(e) => e.button === 1 && closeTab(t.path)}
              className={cn(
                'group relative flex max-w-52 min-w-28 shrink-0 cursor-default items-center gap-2 border-r border-border px-3',
                active
                  ? 'bg-surface text-foreground'
                  : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
              )}
            >
              {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
              <FolderGit2 className={cn('size-3.5 shrink-0', active && 'text-accent')} />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate',
                  active && 'font-semibold',
                  !inWorkspace(t.path) && 'italic',
                )}
                title={inWorkspace(t.path) ? undefined : `Not in workspace ${ws?.name}`}
              >
                {t.name}
              </span>
              <button
                type="button"
                aria-label={`Close ${t.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.path);
                }}
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded hover:bg-surface-hover',
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
        {!path && !ws && (
          <div className="relative flex shrink-0 items-center gap-2 border-r border-border bg-surface px-3 font-semibold">
            <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />
            New tab
          </div>
        )}
        <button
          type="button"
          title="Open a repository in a new tab"
          aria-label="New tab"
          onClick={newTab}
          className="flex w-9 shrink-0 items-center justify-center text-muted-foreground hover:bg-surface-hover hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 px-2">
        <button
          type="button"
          title="Toggle theme"
          aria-label="Toggle theme"
          onClick={toggleTheme}
          className={iconBtn}
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
        <button
          type="button"
          title="Settings"
          aria-label="Settings"
          onClick={onSettings}
          className={iconBtn}
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
              className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs hover:bg-surface-hover"
            >
              <Avatar name={user.login} url={user.avatarUrl} size={20} />
              {user.login}
            </button>
          </Dropdown>
        ) : (
          <button
            type="button"
            onClick={onSignIn}
            className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs hover:bg-surface-hover"
          >
            <Github className="size-3.5" /> Connect GitHub
          </button>
        )}
      </div>
    </div>
  );
}

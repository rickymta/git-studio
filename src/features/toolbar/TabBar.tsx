import {
  ChevronDown,
  Download,
  FolderOpen,
  FolderSearch,
  LayoutGrid,
  LogOut,
  Moon,
  Plus,
  Rocket,
  Settings as SettingsIcon,
  Sun,
} from 'lucide-react';

import { Avatar, Dropdown, Github } from '@/components/ui';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { openUrl } from '@/lib/native';
import { badgeCount } from '@/features/launchpad/model';
import { useGitHub } from '@/stores/github';
import { allItems, useLaunchpad } from '@/stores/launchpad';
import { useRepo } from '@/stores/repo';
import { openDialog, useUi } from '@/stores/ui';
import { samePath, useWorkspaces } from '@/stores/workspace';
import { addRepoFolder, addToWorkspace } from '@/features/workspace/workspaceActions';
import { RepoTabs } from './RepoTabs';
import { TabShortcuts } from './TabSwitcher';

const same = (a: string | null, b: string) =>
  !!a && a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();

/** One tab per open repository, plus the start page when no repository is active. */
export function TabBar({
  onSignIn,
  onSettings,
  onNewWorkspace,
  onNavigate,
  prefsOpen,
}: {
  onSignIn: () => void;
  onSettings: () => void;
  onNewWorkspace: () => void;
  /** Called when the user picks a tab (leaves Preferences). */
  onNavigate: () => void;
  prefsOpen: boolean;
}) {
  const tabs = useRepo((s) => s.tabs);
  const path = useRepo((s) => s.path);
  const { user, signOut } = useGitHub();
  const theme = useUi((s) => s.theme);
  const toggleTheme = useUi((s) => s.toggleTheme);
  const workspaces = useWorkspaces((s) => s.data);
  const activate = useWorkspaces((s) => s.activate);
  const ws = workspaces.items.find((w) => w.id === workspaces.active) ?? null;
  const inWorkspace = (p: string) => !ws || ws.repos.some((r) => samePath(r, p));
  const launchpadOpen = useLaunchpad((s) => s.open);
  const badge = useLaunchpad((s) => badgeCount(allItems(s.items), s.prefs, Date.now()));

  const iconBtn =
    'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground';

  return (
    <div className="flex h-[34px] shrink-0 items-stretch border-b border-border bg-background">
      <button
        type="button"
        title={t('Launchpad (Ctrl+Shift+K)')}
        aria-label={t('Launchpad')}
        aria-pressed={launchpadOpen}
        onClick={() => {
          onNavigate();
          useLaunchpad.getState().setOpen(true);
        }}
        className={cn(
          'relative flex shrink-0 items-center gap-1.5 border-r border-border px-3',
          launchpadOpen
            ? 'bg-surface font-semibold text-foreground'
            : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
        )}
      >
        {launchpadOpen && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
        <Rocket className={cn('size-3.5', launchpadOpen && 'text-accent')} />
        <span className="hidden xl:inline">{t('Launchpad')}</span>
        {badge > 0 && (
          <span
            className="min-w-4 rounded-full bg-accent px-1 text-center text-[10px] leading-4 font-semibold text-accent-foreground tabular-nums"
            title={t('{n} waiting for you (review requests and assigned)', { n: badge })}
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
      <Dropdown
        items={[
          // Grow the active workspace from anywhere, not only from its overview.
          ...(ws
            ? [
                {
                  label: t('Add a repository folder to “{name}”…', { name: ws.name }),
                  icon: <FolderOpen className="size-3.5" />,
                  onSelect: addRepoFolder,
                },
                {
                  label: t('Scan a folder into “{name}”…', { name: ws.name }),
                  icon: <FolderSearch className="size-3.5" />,
                  onSelect: () => openDialog('scanWorkspace'),
                },
                {
                  label: t('Clone into “{name}”…', { name: ws.name }),
                  icon: <Download className="size-3.5" />,
                  onSelect: () => openDialog('clone'),
                },
                ...(path && !inWorkspace(path)
                  ? [
                      {
                        label: t('Add this tab to “{name}”', { name: ws.name }),
                        icon: <Plus className="size-3.5" />,
                        onSelect: () =>
                          void addToWorkspace(
                            [path],
                            tabs.find((x) => same(path, x.path))?.name ?? path,
                          ),
                      },
                    ]
                  : []),
                'sep' as const,
              ]
            : []),
          ...workspaces.items.map((w) => ({
            label: `${w.name}  (${w.repos.length})`,
            icon: <span className="block size-2.5 rounded-full" style={{ background: w.color }} />,
            onSelect: () => activate(w.id),
          })),
          ...(workspaces.items.length ? ['sep' as const] : []),
          { label: t('No workspace'), icon: ws ? undefined : '✓', onSelect: () => activate('') },
          {
            label: t('New workspace…'),
            icon: <Plus className="size-3.5" />,
            onSelect: onNewWorkspace,
          },
        ]}
      >
        <button
          type="button"
          title={t('Switch workspace')}
          className="flex max-w-56 shrink-0 items-center gap-2 border-r border-border px-3 hover:bg-surface-hover"
        >
          {ws ? (
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: ws.color }} />
          ) : (
            <LayoutGrid className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className={cn('truncate', ws ? 'font-semibold' : 'text-muted-foreground')}>
            {ws ? ws.name : t('Workspaces')}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </Dropdown>
      {ws && (
        <button
          type="button"
          title={t('{name} overview', { name: ws.name })}
          aria-label={t('Workspace overview')}
          onClick={() => {
            onNavigate();
            useRepo.getState().newTab();
          }}
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
      <RepoTabs
        onNavigate={onNavigate}
        showNewTabPlaceholder={!path && !ws}
        inWorkspace={inWorkspace}
        workspaceName={ws?.name ?? null}
      />
      <TabShortcuts onNavigate={onNavigate} />

      <div className="flex shrink-0 items-center gap-0.5 px-2">
        <button
          type="button"
          title={t('Toggle theme')}
          aria-label={t('Toggle theme')}
          onClick={toggleTheme}
          className={iconBtn}
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
        <button
          type="button"
          title={t('Preferences')}
          aria-label={t('Preferences')}
          aria-pressed={prefsOpen}
          onClick={onSettings}
          className={cn(iconBtn, prefsOpen && 'bg-accent-soft text-foreground')}
        >
          <SettingsIcon className="size-4" />
        </button>
        {user ? (
          <Dropdown
            items={[
              { label: `@${user.login}`, onSelect: () => openUrl(user.htmlUrl) },
              'sep',
              {
                label: t('Sign out of GitHub'),
                icon: <LogOut className="size-3.5" />,
                onSelect: () => signOut(),
              },
            ]}
          >
            <button
              type="button"
              aria-label={t('GitHub account')}
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
            <Github className="size-3.5" /> {t('Connect GitHub')}
          </button>
        )}
      </div>
    </div>
  );
}

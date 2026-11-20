import {
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpFromLine,
  Archive,
  ChevronDown,
  ChevronRight,
  GitBranchPlus,
  GitPullRequest,
  Redo2,
  RefreshCw,
  Search,
  SquareTerminal,
  Undo2,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Dropdown, Spinner, cn, type MenuItem } from '@/components/ui';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { pickFolder, revealPath } from '@/lib/native';
import { openSession, toggleTerminal } from '@/features/terminal/runtime';
import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';
import { openDialog, toast } from '@/stores/ui';
import { samePath, useWorkspaces } from '@/stores/workspace';
import * as A from '../actions';

function ToolButton({
  icon,
  label,
  onClick,
  badge,
  disabled,
  title,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  badge?: number;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className="relative flex h-12 min-w-12 flex-col items-center justify-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
    >
      <span>{label}</span>
      <span className="flex items-center gap-1">
        {icon}
        {!!badge && (
          // Next to the icon (never over the label), a wide pill even for one digit.
          <span className="inline-flex h-[15px] min-w-[26px] items-center justify-center rounded-full bg-badge px-2 text-[10.5px] leading-none font-semibold text-badge-foreground tabular-nums">
            {badge}
          </span>
        )}
      </span>
    </button>
  );
}

const Divider = () => <div className="mx-1.5 h-8 w-px bg-border" />;

function Selector({ label, value, items }: { label: string; value: string; items: MenuItem[] }) {
  return (
    <Dropdown items={items}>
      <button
        type="button"
        className="flex h-11 max-w-72 min-w-0 flex-col justify-center rounded-md px-2 text-left hover:bg-surface-hover"
      >
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className="flex min-w-0 items-center gap-1 text-[15px] font-semibold">
          <span className="truncate">{value}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </span>
      </button>
    </Dropdown>
  );
}

export function Toolbar() {
  const info = useRepo((s) => s.info);
  const settings = useRepo((s) => s.settings);
  const refs = useRepo((s) => s.refs);
  const busy = useRepo((s) => s.busy);
  const open = useRepo((s) => s.open);
  const close = useRepo((s) => s.close);
  const undoTop = useRepo((s) => s.undoStack.at(-1));
  const redoTop = useRepo((s) => s.redoStack.at(-1));
  const user = useGitHub((s) => s.user);
  const ws = useWorkspaces((s) => s.active());
  const addRepos = useWorkspaces((s) => s.addRepos);
  if (!info) return null;
  const st = info.status;
  const remotes = refs?.remotes ?? [];
  // Remote the current branch tracks: the longest remote name that prefixes the upstream.
  const tracked =
    [...remotes]
      .sort((a, b) => b.name.length - a.name.length)
      .find((r) => st.upstream?.startsWith(`${r.name}/`))?.name ?? null;
  const hasGitHub = refs?.remotes.some((r) => r.github);
  const run = useRepo.getState().run;

  const repoMenu: MenuItem[] = [
    ...(settings?.recent ?? [])
      .filter((r) => r.path !== info.path)
      .slice(0, 10)
      .map((r) => ({ label: r.name, onSelect: () => open(r.path) })),
    'sep',
    {
      label: t('Open repository…'),
      onSelect: async () => {
        const p = await pickFolder(t('Open a Git repository'));
        if (p) await open(p);
      },
    },
    { label: t('Clone repository…'), onSelect: () => openDialog('clone') },
    ...(ws && !ws.repos.some((r) => samePath(r, info.path))
      ? [
          {
            label: t('Add to workspace “{name}”', { name: ws.name }),
            onSelect: () => addRepos(ws.id, [info.path]),
          },
        ]
      : []),
    { label: t('Show in file explorer'), onSelect: () => revealPath(info.path) },
    {
      label: t('Open in editor'),
      onSelect: () =>
        api
          .openEditor(info.path)
          .catch((e) => toast('error', t('Could not open editor'), (e as Error).message)),
    },
    { label: t('Close tab'), onSelect: close },
  ];

  const branchMenu: MenuItem[] = [
    // Detached: HEAD is what is checked out, so it carries the tick.
    ...(!st.branch && st.head
      ? [
          {
            label: t('HEAD (detached) at {hash}', { hash: st.head.slice(0, 7) }),
            icon: '✓',
            onSelect: () => void A.goToHead(),
          },
        ]
      : []),
    ...(refs?.refs ?? [])
      .filter((r) => r.kind === 'local')
      .map((r) => ({
        label: r.name,
        icon: r.isHead ? '✓' : undefined,
        disabled: r.isHead,
        onSelect: () => A.checkoutRef(r),
      })),
    'sep',
    { label: t('Create branch…'), onSelect: () => A.newBranch() },
  ];

  const pullMenu: MenuItem[] = [
    { label: t('Fetch all'), onSelect: () => A.fetchAll() },
    {
      label: t('Pull (merge)'),
      onSelect: () => run('Pull', (p) => api.pull(p, 'merge'), t('Pulled')),
    },
    {
      label: t('Pull (fast-forward only)'),
      onSelect: () => run('Pull', (p) => api.pull(p, 'ff-only'), t('Pulled')),
    },
    {
      label: t('Pull (rebase)'),
      onSelect: () => run('Pull', (p) => api.pull(p, 'rebase'), t('Pulled')),
    },
    ...(remotes.length > 0
      ? ([
          'sep',
          {
            label: t('Pull from'),
            disabled: !st.branch,
            items: remotes.map((r) => ({
              label: r.name,
              icon: r.name === tracked ? '✓' : undefined,
              onSelect: () => A.pull({ remote: r.name }),
            })),
          },
        ] satisfies MenuItem[])
      : []),
  ];

  const pushMenu: MenuItem[] = [
    ...remotes.map((r) => ({
      label: t('Push to {name}', { name: r.name }),
      icon: r.name === tracked ? '✓' : undefined,
      disabled: !st.branch,
      onSelect: () => A.push({ remote: r.name }),
    })),
    ...(remotes.length ? (['sep'] as MenuItem[]) : []),
    { label: t('Add remote…'), onSelect: () => A.addRemote() },
  ];

  return (
    <div className="flex h-[50px] shrink-0 items-center gap-1 border-b border-border bg-surface px-2">
      <div className="flex w-[30%] min-w-0 items-center">
        <Selector label={t('repository')} value={info.name} items={repoMenu} />
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        <Selector
          label={t('branch')}
          value={st.branch ?? t('detached @ {hash}', { hash: st.head?.slice(0, 7) ?? '—' })}
          items={branchMenu}
        />
      </div>

      <div className="flex flex-1 items-center justify-center">
        <ToolButton
          icon={<Undo2 className="size-[18px]" />}
          label={t('Undo')}
          title={undoTop ? t('Undo {label}', { label: t(undoTop.label) }) : t('Nothing to undo')}
          onClick={() => A.undo()}
          disabled={!undoTop || !!busy}
        />
        <ToolButton
          icon={<Redo2 className="size-[18px]" />}
          label={t('Redo')}
          title={redoTop ? t('Redo {label}', { label: t(redoTop.label) }) : t('Nothing to redo')}
          onClick={() => A.redo()}
          disabled={!redoTop || !!busy}
        />
        <Divider />
        <div className="flex">
          <ToolButton
            icon={<ArrowDownToLine className="size-[18px]" />}
            label={t('Pull')}
            title={st.upstream ? t('Pull from {name}', { name: st.upstream }) : t('Pull')}
            badge={st.behind}
            onClick={() => A.pull()}
            disabled={!!busy}
          />
          <Dropdown items={pullMenu}>
            <button
              type="button"
              aria-label={t('Pull options')}
              className="flex h-12 w-4 items-start justify-center rounded-md pt-2 text-muted-foreground hover:bg-surface-hover"
            >
              <ChevronDown className="size-3" />
            </button>
          </Dropdown>
        </div>
        <div className="flex">
          <ToolButton
            icon={<ArrowUpFromLine className="size-[18px]" />}
            label={t('Push')}
            title={
              st.upstream
                ? t('Push to {name}', { name: st.upstream })
                : remotes.length
                  ? t('Push and track a remote branch')
                  : t('Push')
            }
            badge={st.ahead}
            onClick={() => A.push()}
            disabled={!!busy || !st.branch}
          />
          <Dropdown items={pushMenu}>
            <button
              type="button"
              aria-label={t('Push options')}
              className="flex h-12 w-4 items-start justify-center rounded-md pt-2 text-muted-foreground hover:bg-surface-hover"
            >
              <ChevronDown className="size-3" />
            </button>
          </Dropdown>
        </div>
        <Divider />
        <ToolButton
          icon={<GitBranchPlus className="size-[18px]" />}
          label={t('Branch')}
          onClick={() => A.newBranch()}
          disabled={!st.head}
        />
        <Divider />
        <ToolButton
          icon={<Archive className="size-[18px]" />}
          label={t('Stash')}
          onClick={() => A.stash()}
        />
        <ToolButton
          icon={<ArchiveRestore className="size-[18px]" />}
          label={t('Pop')}
          badge={refs?.stashes.length}
          onClick={() => A.popLatest()}
          disabled={!refs?.stashes.length}
        />
        {hasGitHub && (
          <>
            <Divider />
            <ToolButton
              icon={<GitPullRequest className="size-[18px]" />}
              label={t('Pull Request')}
              onClick={() => A.createPullRequest()}
              disabled={!user || !st.branch}
              title={user ? t('Create pull request') : t('Connect GitHub to create pull requests')}
            />
          </>
        )}
        <Divider />
        <div className="flex">
          <ToolButton
            icon={<SquareTerminal className="size-[18px]" />}
            label={t('Terminal')}
            title={t('Toggle terminal (Ctrl+`)')}
            onClick={toggleTerminal}
          />
          <Dropdown
            items={[
              { label: t('New terminal'), onSelect: () => openSession(info.path) },
              {
                label: t('Open external terminal'),
                onSelect: () =>
                  api
                    .openTerminal(info.path)
                    .catch((e) =>
                      toast('error', t('Could not open terminal'), (e as Error).message),
                    ),
              },
            ]}
          >
            <button
              type="button"
              aria-label={t('Terminal options')}
              className="flex h-12 w-4 items-start justify-center rounded-md pt-2 text-muted-foreground hover:bg-surface-hover"
            >
              <ChevronDown className="size-3" />
            </button>
          </Dropdown>
        </div>
      </div>

      <div className="flex w-[22%] items-center justify-end gap-1">
        {busy && (
          <div className="flex items-center gap-2 pr-2 text-xs text-muted-foreground">
            <Spinner /> {t(busy)}…
          </div>
        )}
        <ToolButton
          icon={<RefreshCw className={cn('size-[18px]')} />}
          label={t('Fetch')}
          onClick={() => A.fetchAll()}
          disabled={!!busy}
        />
        <ToolButton
          icon={<Search className="size-[18px]" />}
          label={t('Search')}
          title={t('Search commits (Ctrl+F)')}
          onClick={() =>
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }))
          }
        />
      </div>
    </div>
  );
}

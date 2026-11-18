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
import { api } from '@/lib/ipc';
import { pickFolder, revealPath } from '@/lib/native';
import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';
import { toast } from '@/stores/ui';
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
      {icon}
      {!!badge && (
        <span className="absolute top-0.5 right-0 rounded-full bg-accent px-1 text-[10px] leading-4 font-semibold text-accent-foreground">
          {badge}
        </span>
      )}
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
  const hasGitHub = refs?.remotes.some((r) => r.github);
  const run = useRepo.getState().run;

  const repoMenu: MenuItem[] = [
    ...(settings?.recent ?? [])
      .filter((r) => r.path !== info.path)
      .slice(0, 10)
      .map((r) => ({ label: r.name, onSelect: () => open(r.path) })),
    'sep',
    {
      label: 'Open repository…',
      onSelect: async () => {
        const p = await pickFolder('Open a Git repository');
        if (p) await open(p);
      },
    },
    ...(ws && !ws.repos.some((r) => samePath(r, info.path))
      ? [
          {
            label: `Add to workspace “${ws.name}”`,
            onSelect: () => addRepos(ws.id, [info.path]),
          },
        ]
      : []),
    { label: 'Show in file explorer', onSelect: () => revealPath(info.path) },
    { label: 'Close tab', onSelect: close },
  ];

  const branchMenu: MenuItem[] = [
    ...(refs?.refs ?? [])
      .filter((r) => r.kind === 'local')
      .map((r) => ({
        label: r.name,
        icon: r.isHead ? '✓' : undefined,
        disabled: r.isHead,
        onSelect: () => A.checkoutRef(r),
      })),
    'sep',
    { label: 'Create branch…', onSelect: () => A.newBranch() },
  ];

  const pullMenu: MenuItem[] = [
    { label: 'Fetch all', onSelect: () => A.fetchAll() },
    { label: 'Pull (merge)', onSelect: () => run('Pull', (p) => api.pull(p, 'merge'), 'Pulled') },
    {
      label: 'Pull (fast-forward only)',
      onSelect: () => run('Pull', (p) => api.pull(p, 'ff-only'), 'Pulled'),
    },
    { label: 'Pull (rebase)', onSelect: () => run('Pull', (p) => api.pull(p, 'rebase'), 'Pulled') },
  ];

  return (
    <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border bg-surface px-2">
      <div className="flex w-[30%] min-w-0 items-center">
        <Selector label="repository" value={info.name} items={repoMenu} />
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        <Selector
          label="branch"
          value={st.branch ?? `detached @ ${st.head?.slice(0, 7) ?? '—'}`}
          items={branchMenu}
        />
      </div>

      <div className="flex flex-1 items-center justify-center">
        <ToolButton
          icon={<Undo2 className="size-[18px]" />}
          label="Undo"
          title={undoTop ? `Undo ${undoTop.label}` : 'Nothing to undo'}
          onClick={() => A.undo()}
          disabled={!undoTop || !!busy}
        />
        <ToolButton
          icon={<Redo2 className="size-[18px]" />}
          label="Redo"
          title={redoTop ? `Redo ${redoTop.label}` : 'Nothing to redo'}
          onClick={() => A.redo()}
          disabled={!redoTop || !!busy}
        />
        <Divider />
        <div className="flex">
          <ToolButton
            icon={<ArrowDownToLine className="size-[18px]" />}
            label="Pull"
            badge={st.behind}
            onClick={() => A.pull()}
            disabled={!!busy}
          />
          <Dropdown items={pullMenu}>
            <button
              type="button"
              aria-label="Pull options"
              className="flex h-12 w-4 items-start justify-center rounded-md pt-2 text-muted-foreground hover:bg-surface-hover"
            >
              <ChevronDown className="size-3" />
            </button>
          </Dropdown>
        </div>
        <ToolButton
          icon={<ArrowUpFromLine className="size-[18px]" />}
          label="Push"
          badge={st.ahead}
          onClick={() => A.push()}
          disabled={!!busy || !st.branch}
        />
        <Divider />
        <ToolButton
          icon={<GitBranchPlus className="size-[18px]" />}
          label="Branch"
          onClick={() => A.newBranch()}
          disabled={!st.head}
        />
        <Divider />
        <ToolButton
          icon={<Archive className="size-[18px]" />}
          label="Stash"
          onClick={() => A.stash()}
        />
        <ToolButton
          icon={<ArchiveRestore className="size-[18px]" />}
          label="Pop"
          badge={refs?.stashes.length}
          onClick={() => A.popLatest()}
          disabled={!refs?.stashes.length}
        />
        {hasGitHub && (
          <>
            <Divider />
            <ToolButton
              icon={<GitPullRequest className="size-[18px]" />}
              label="Pull Request"
              onClick={() => A.createPullRequest()}
              disabled={!user || !st.branch}
              title={user ? 'Create pull request' : 'Connect GitHub to create pull requests'}
            />
          </>
        )}
        <Divider />
        <ToolButton
          icon={<SquareTerminal className="size-[18px]" />}
          label="Terminal"
          onClick={() =>
            api
              .openTerminal(info.path)
              .catch((e) => toast('error', 'Could not open terminal', (e as Error).message))
          }
        />
      </div>

      <div className="flex w-[22%] items-center justify-end gap-1">
        {busy && (
          <div className="flex items-center gap-2 pr-2 text-xs text-muted-foreground">
            <Spinner /> {busy}…
          </div>
        )}
        <ToolButton
          icon={<RefreshCw className={cn('size-[18px]')} />}
          label="Fetch"
          onClick={() => A.fetchAll()}
          disabled={!!busy}
        />
        <ToolButton
          icon={<Search className="size-[18px]" />}
          label="Search"
          title="Search commits (Ctrl+F)"
          onClick={() =>
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }))
          }
        />
      </div>
    </div>
  );
}

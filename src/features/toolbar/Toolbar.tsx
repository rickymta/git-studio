import {
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpFromLine,
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  GitBranchPlus,
  GitPullRequest,
  Redo2,
  Search,
  SquareTerminal,
  Undo2,
} from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';

import { Dropdown, Spinner, type MenuItem } from '@/components/ui';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { pickFolder, revealPath } from '@/lib/native';
import { openSession, toggleTerminal } from '@/features/terminal/runtime';
import { useRepoHost } from '@/features/pulls/hosting';
import { usePullAction, type PullAction } from '@/stores/pullAction';
import { useRepo } from '@/stores/repo';
import { useSpotlight } from '@/stores/spotlight';
import { headOffBranch } from '../graph/refGroups';
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
  className,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  badge?: number;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={cn(
        'relative flex h-12 min-w-12 flex-col items-center justify-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-35',
        className,
      )}
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

/**
 * A tool button with a menu (GitKraken's layout): two columns, the button and a narrow ▾ column
 * as tall as the block, lit up together on hover (and while the menu is open).
 */
function SplitTool({ children }: { children: ReactNode }) {
  return (
    <div className="flex rounded-md hover:bg-surface-hover has-[[data-state=open]]:bg-surface-hover [&>button:first-child]:pr-0.5 [&>button:first-child]:hover:bg-transparent">
      {children}
    </div>
  );
}

/** The ▾ of a `SplitTool` (the menu trigger; Radix passes its props and ref through). */
function Caret({
  label,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className="group/caret flex h-12 w-4 flex-col items-center justify-center gap-1 rounded-r-md pr-1 text-[11px] text-muted-foreground hover:text-foreground data-[state=open]:text-foreground"
    >
      {/* Same rows as the button beside it, so the ▾ sits level with its icon. */}
      <span aria-hidden className="invisible">
        ·
      </span>
      <span className="flex h-[18px] items-center">
        <svg
          viewBox="0 0 8 5"
          aria-hidden
          className="w-2 transition-transform group-data-[state=open]/caret:rotate-180"
        >
          <path d="M0 0h8L4 5z" fill="currentColor" />
        </svg>
      </span>
    </button>
  );
}

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
  const pullAction = usePullAction((s) => s.action);
  const refs = useRepo((s) => s.refs);
  const busy = useRepo((s) => s.busy);
  const open = useRepo((s) => s.open);
  const close = useRepo((s) => s.close);
  const undoTop = useRepo((s) => s.undoStack.at(-1));
  const redoTop = useRepo((s) => s.redoStack.at(-1));
  const { host, signedIn } = useRepoHost();
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
    { label: t('Repository maintenance…'), onSelect: () => openDialog('maintenance') },
    'sep',
    { label: t('Close tab'), onSelect: close },
  ];

  const branchMenu: MenuItem[] = [
    // Detached: HEAD is what is checked out, so it carries the tick.
    ...(st.head && headOffBranch(st.branch, st.head, refs?.refs)
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

  // The Pull button runs the operation picked in its menu (else the Pull Strategy setting).
  const action: PullAction = pullAction ?? settings?.pullMode ?? 'merge';
  const doPull = () => (action === 'fetch' ? A.fetchAll() : A.pull({ mode: action }));

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
        <SplitTool>
          <ToolButton
            icon={<ArrowDownToLine className="size-[18px]" />}
            label={t('Pull')}
            title={PULL_LABEL[action]()}
            badge={st.behind}
            onClick={() => void doPull()}
            disabled={!!busy}
          />
          <PullMenu
            action={action}
            remotes={remotes.map((r) => r.name)}
            tracked={tracked}
            canPull={!!st.branch}
          />
        </SplitTool>
        <SplitTool>
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
            <Caret label={t('Push options')} />
          </Dropdown>
        </SplitTool>
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
        {host && (
          <>
            <Divider />
            <ToolButton
              icon={<GitPullRequest className="size-[18px]" />}
              label={host.kind === 'github' ? t('Pull Request') : t('Merge Request')}
              onClick={() => A.createPullRequest()}
              disabled={!signedIn || !st.branch}
              title={
                host.kind === 'github'
                  ? signedIn
                    ? t('Create pull request')
                    : t('Connect GitHub to create pull requests')
                  : signedIn
                    ? t('Create merge request')
                    : t('Connect GitLab to create merge requests')
              }
            />
          </>
        )}
        <Divider />
        <SplitTool>
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
            <Caret label={t('Terminal options')} />
          </Dropdown>
        </SplitTool>
      </div>

      <div className="flex w-[22%] items-center justify-end gap-1">
        {busy && (
          <div className="flex items-center gap-2 pr-2 text-xs text-muted-foreground">
            <Spinner /> {t(busy)}…
          </div>
        )}
        <ToolButton
          icon={<Search className="size-[18px]" />}
          label={t('Search')}
          title={t('Search this repository (Ctrl+K)')}
          onClick={() => useSpotlight.getState().setOpen(true)}
        />
      </div>
    </div>
  );
}

const PULL_LABEL: Record<PullAction, () => string> = {
  fetch: () => t('Fetch all'),
  merge: () => t('Pull (fast-forward if possible)'),
  'ff-only': () => t('Pull (fast-forward only)'),
  rebase: () => t('Pull (rebase)'),
};

/**
 * The arrow next to Pull (like GitKraken): pick what clicking Pull does (it is remembered), or
 * pull from a particular remote now.
 */
function PullMenu({
  action,
  remotes,
  tracked,
  canPull,
}: {
  action: PullAction;
  remotes: string[];
  tracked: string | null;
  canPull: boolean;
}) {
  const setAction = usePullAction((s) => s.set);
  const item =
    'flex h-8 cursor-default items-center gap-2.5 rounded px-2 outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-hover';
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Caret label={t('Pull options')} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="z-50 w-64 rounded-md border border-border bg-surface p-1 text-[13px] shadow-xl"
        >
          <DropdownMenu.Label className="px-2 pt-1.5 pb-2 text-xs leading-snug text-muted-foreground">
            {t('Select a default pull/fetch operation to execute when clicking this button')}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={action} onValueChange={(v) => setAction(v as PullAction)}>
            {(Object.keys(PULL_LABEL) as PullAction[]).map((a) => (
              <DropdownMenu.RadioItem
                key={a}
                value={a}
                className={cn(
                  item,
                  a === action && 'bg-accent-soft data-[highlighted]:bg-accent-soft',
                )}
              >
                <span
                  className={cn(
                    'flex size-3.5 shrink-0 items-center justify-center rounded-full border',
                    a === action ? 'border-accent' : 'border-muted-foreground/60',
                  )}
                >
                  {a === action && <span className="size-1.5 rounded-full bg-accent" />}
                </span>
                {PULL_LABEL[a]()}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          {remotes.length > 0 && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              {remotes.map((r) => (
                <DropdownMenu.Item
                  key={r}
                  disabled={!canPull}
                  onSelect={() => void A.pull({ remote: r })}
                  className={item}
                >
                  <ArrowDownToLine className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {t('Pull from {name}', { name: r })}
                  </span>
                  {r === tracked && <Check className="size-3.5 shrink-0 text-muted-foreground" />}
                </DropdownMenu.Item>
              ))}
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

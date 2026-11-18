import { Download, FolderOpen, LayoutGrid, Plus, Search, SquarePlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Avatar, Button, Github, IconButton, Spinner, cn } from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { api } from '@/lib/ipc';
import { pickFolder } from '@/lib/native';
import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';
import { ask, toast, useUi } from '@/stores/ui';
import { useWorkspaces } from '@/stores/workspace';

/** The New Tab page: every repository GitStudio knows, searchable, plus account shortcuts. */
export function Welcome({
  onClone,
  onSignIn,
  onNewWorkspace,
}: {
  onClone: () => void;
  onSignIn: () => void;
  onNewWorkspace: () => void;
}) {
  const settings = useRepo((s) => s.settings);
  const open = useRepo((s) => s.open);
  const adopt = useRepo((s) => s.adopt);
  const setSettings = useRepo((s) => s.setSettings);
  const user = useGitHub((s) => s.user);
  const workspaces = useWorkspaces((s) => s.data.items);
  const activate = useWorkspaces((s) => s.activate);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const recent = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (settings?.recent ?? []).filter(
      (r) => !q || r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q),
    );
  }, [settings?.recent, query]);

  const openFolder = async () => {
    const p = await pickFolder('Open a Git repository');
    if (p) await open(p);
  };

  const create = async () => {
    const p = await pickFolder('Choose a folder for the new repository');
    if (!p) return;
    const v = await ask({
      title: 'Create repository',
      description: p,
      fields: [
        {
          name: 'branch',
          label: 'Initial branch',
          initial: settings?.defaultBranch ?? 'main',
          required: true,
        },
      ],
      confirmLabel: 'Create',
    });
    if (!v) return;
    try {
      await adopt(await api.init(p, (v.branch as string).trim()));
    } catch (e) {
      toast('error', 'Could not create repository', (e as Error).message);
    }
  };

  const forget = async (path: string) => setSettings(await api.forgetRecent(path));

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(recent.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter' && recent[cursor]) {
      void open(recent[cursor]!.path);
    } else if (e.key === 'Escape') {
      setQuery('');
    }
  };

  return (
    <div className="flex h-full min-h-0 gap-10 overflow-hidden px-[5%] pt-10 pb-4">
      {/* Repositories */}
      <section className="flex min-h-0 min-w-0 flex-[1.5] flex-col">
        <h1 className="mb-4 text-xl font-semibold">Repositories</h1>
        <div className="mb-4 flex gap-2">
          <BigButton icon={<FolderOpen className="size-4" />} onClick={openFolder}>
            Open
          </BigButton>
          <BigButton icon={<Download className="size-4" />} onClick={onClone}>
            Clone
          </BigButton>
          <BigButton icon={<SquarePlus className="size-4" />} onClick={create}>
            Create
          </BigButton>
        </div>
        <div className="relative mb-4">
          <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onSearchKey}
            placeholder="Search repositories (Ctrl + Alt + F)"
            className="h-9 w-full rounded-md border border-border bg-background pr-3 pl-9 outline-none focus:border-accent"
          />
        </div>
        <div className="mb-1 text-[13px] text-muted-foreground">
          Recent {recent.length > 0 && <span className="tabular-nums">({recent.length})</span>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto pr-2">
          {recent.length === 0 && (
            <div className="py-6 text-muted-foreground">
              {query
                ? 'No repository matches.'
                : 'Nothing yet. Open, clone or create a repository.'}
            </div>
          )}
          {recent.map((r, i) => (
            <div
              key={r.path}
              role="button"
              tabIndex={-1}
              onClick={() => open(r.path)}
              onMouseEnter={() => setCursor(i)}
              className={cn(
                'group flex h-[26px] cursor-pointer items-center gap-3 rounded px-1.5',
                i === cursor && query && 'bg-surface-hover',
              )}
            >
              <span className="shrink-0 text-[14px] font-semibold text-accent group-hover:underline">
                {r.name}
              </span>
              <span className="min-w-0 truncate text-muted-foreground" title={r.path}>
                {r.path}
              </span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground opacity-0 group-hover:opacity-100">
                {r.openedAt ? relativeTime(r.openedAt) : ''}
              </span>
              <IconButton
                label="Remove from recent"
                className="opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  void forget(r.path);
                }}
              >
                <X className="size-3.5" />
              </IconButton>
            </div>
          ))}
        </div>
      </section>

      {/* Side column */}
      <aside className="flex w-[380px] shrink-0 flex-col gap-6 overflow-auto border-l border-border pl-8">
        <div>
          <h2 className="mb-3 text-[15px] font-semibold">GitHub</h2>
          {user ? (
            <div className="flex items-center gap-3">
              <Avatar name={user.login} url={user.avatarUrl} size={36} />
              <div>
                <div className="font-medium">{user.name ?? user.login}</div>
                <div className="text-xs text-muted-foreground">Connected as @{user.login}</div>
              </div>
            </div>
          ) : (
            <>
              <p className="mb-3 text-muted-foreground">
                Connect to clone private repositories, push over HTTPS, manage SSH keys and pull
                requests.
              </p>
              <Button onClick={onSignIn}>
                <Github className="size-4" /> Connect GitHub
              </Button>
            </>
          )}
        </div>

        <GitKrakenImport />

        <div>
          <div className="mb-3 flex items-center">
            <h2 className="flex-1 text-[15px] font-semibold">Workspaces</h2>
            <button
              type="button"
              onClick={onNewWorkspace}
              className="flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <Plus className="size-3.5" /> New
            </button>
          </div>
          {workspaces.length === 0 ? (
            <button
              type="button"
              onClick={onNewWorkspace}
              className="flex w-full items-start gap-3 rounded-lg border border-dashed border-border p-3 text-left text-muted-foreground hover:border-accent"
            >
              <LayoutGrid className="mt-0.5 size-5 shrink-0" />
              Group repositories you work on together. A workspace keeps its own tabs and shows the
              state of all its repositories on one page.
            </button>
          ) : (
            <div className="flex flex-col">
              {workspaces.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => activate(w.id)}
                  className="flex items-center gap-2.5 rounded px-1.5 py-1.5 text-left hover:bg-surface-hover"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: w.color }}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{w.name}</span>
                  <span className="text-xs text-muted-foreground">{w.repos.length} repos</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function BigButton({
  icon,
  children,
  onClick,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 items-center gap-2 rounded-md border border-border bg-surface px-4 text-[15px] hover:border-accent hover:bg-surface-hover"
    >
      {icon}
      {children}
    </button>
  );
}

/** Offer to bring repositories, tabs and SSH settings over from GitKraken Desktop. */
export function GitKrakenImport({ compact = false }: { compact?: boolean }) {
  const [found, setFound] = useState<{ repos: number; tabs: number; ssh: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const loadSettings = useRepo((s) => s.loadSettings);
  const addTabs = useRepo((s) => s.addTabs);
  const open = useRepo((s) => s.open);
  const path = useRepo((s) => s.path);

  useEffect(() => {
    api
      .gitkrakenDetect()
      .then(setFound)
      .catch(() => setFound(null));
  }, []);

  if (!found) return null;

  const run = async () => {
    setBusy(true);
    try {
      const res = await api.gitkrakenImport(true);
      const d = res.data;
      addTabs(d.tabs);
      if (d.theme === 'light' || d.theme === 'dark') {
        if (useUi.getState().theme !== d.theme) useUi.getState().toggleTheme();
      }
      if (d.fileView) {
        try {
          localStorage.setItem('gitstudio.fileView', d.fileView === 'tree' ? 'tree' : 'path');
        } catch {
          /* ignore */
        }
      }
      await loadSettings();
      const parts = [
        `${res.addedRepos} new repositor${res.addedRepos === 1 ? 'y' : 'ies'}`,
        `${d.tabs.length} tab${d.tabs.length === 1 ? '' : 's'}`,
      ];
      if (res.sshImported) parts.push('SSH key');
      toast('success', 'Imported from GitKraken', parts.join(' · '));
      const target = d.selectedTab ?? d.tabs[0]?.path;
      if (!path && target) await open(target);
    } catch (e) {
      toast('error', 'Import failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn(!compact && 'rounded-lg border border-border bg-surface p-4')}>
      {!compact && <h2 className="mb-2 text-[15px] font-semibold">Import from GitKraken</h2>}
      <p className="mb-3 text-muted-foreground">
        GitKraken Desktop is installed here with {found.repos} repositories and {found.tabs} open
        tabs{found.ssh ? ', and an SSH key' : ''}. Bring them into GitStudio? Nothing in GitKraken
        is changed.
      </p>
      <Button onClick={run} disabled={busy}>
        {busy && <Spinner />} Import repositories, tabs{found.ssh ? ' and SSH key' : ''}
      </Button>
    </div>
  );
}

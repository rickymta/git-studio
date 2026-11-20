import { Check, ChevronDown, Globe, Lock, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Button, Github, Input, Modal, Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import { GitLabConnectDialog, GitLabIcon } from '@/features/gitlab/GitLab';
import { joinPath, repoNameFromUrl } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { pickFolder } from '@/lib/native';
import type { GitHubRepo } from '@/lib/types';
import { useGitHub } from '@/stores/github';
import { ensureGitLabChecked, useGitLab } from '@/stores/gitlab';
import { useRepo } from '@/stores/repo';
import { toast } from '@/stores/ui';
import { useWorkspaces } from '@/stores/workspace';
import { addToWorkspace } from '@/features/workspace/workspaceActions';

import { Checkbox } from '@/components/controls';

interface Props {
  open: boolean;
  onClose: () => void;
  onSignIn: () => void;
}

type Source = 'url' | 'github' | 'gitlab';

export function CloneDialog(props: Props) {
  // Mounted only while open, so every opening starts from a clean state.
  return props.open ? <CloneBody {...props} /> : null;
}

function CloneBody({ open, onClose, onSignIn }: Props) {
  const settings = useRepo((s) => s.settings);
  const adopt = useRepo((s) => s.adopt);
  const gh = useGitHub();
  const gl = useGitLab();
  const [source, setSource] = useState<Source>(gh.user ? 'github' : 'url');
  const [urlInput, setUrlInput] = useState('');
  const [picked, setPicked] = useState<Record<'github' | 'gitlab', GitHubRepo | null>>({
    github: null,
    gitlab: null,
  });
  const [parent, setParent] = useState(settings?.cloneDir ?? '');
  const [customName, setName] = useState<string | null>(null);
  const [shallow, setShallow] = useState(false);
  const [sparse, setSparse] = useState(false);
  const [busy, setBusy] = useState(false);
  const [glConnect, setGlConnect] = useState(false);
  // Cloning while a workspace is active adds the clone to it unless unticked.
  const ws = useWorkspaces((s) => s.active());
  const [toWorkspace, setToWorkspace] = useState(true);

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

  const repoUrl = (r: GitHubRepo | null) =>
    r ? (settings?.preferSsh ? r.sshUrl : r.cloneUrl) : '';
  const url = source === 'url' ? urlInput : repoUrl(picked[source]);
  const name = customName ?? repoNameFromUrl(url);
  const dest = parent && name ? joinPath(parent, name) : '';

  const switchTo = (s: Source) => {
    setSource(s);
    setName(null);
  };

  const clone = async () => {
    setBusy(true);
    try {
      const info = await api.clone(url.trim(), dest, { shallow, sparse });
      toast('success', t('Cloned {name}', { name: info.name }));
      onClose();
      if (ws && toWorkspace) await addToWorkspace([info.path], info.name);
      await adopt(info, { keepOutOfWorkspace: !toWorkspace });
    } catch (e) {
      toast('error', t('Clone failed'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const connected = source === 'url' || (source === 'github' ? !!gh.user : !!gl.user);
  const provider = source === 'github' ? 'GitHub.com' : 'GitLab.com';

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={t('Clone a Repository')}
      width={960}
    >
      <div className="-mx-5 -mb-5 flex h-[480px] border-t border-border">
        <nav className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-border bg-surface-muted p-2">
          <NavItem
            active={source === 'url'}
            onClick={() => switchTo('url')}
            icon={<Globe className="size-4" />}
          >
            {t('Clone with URL')}
          </NavItem>
          <NavItem
            active={source === 'github'}
            onClick={() => switchTo('github')}
            icon={<Github className="size-4" />}
          >
            GitHub.com
          </NavItem>
          <NavItem
            active={source === 'gitlab'}
            onClick={() => switchTo('gitlab')}
            icon={<GitLabIcon className="size-4" />}
          >
            GitLab.com
          </NavItem>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col overflow-auto p-6">
          {source === 'gitlab' && !gl.checked ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Spinner className="size-5" />
            </div>
          ) : !connected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
              {source === 'github' ? (
                <Github className="size-10" />
              ) : (
                <GitLabIcon className="size-10" />
              )}
              <div className="text-[15px]">{t('{provider} is not connected', { provider })}</div>
              <Button
                variant="primary"
                onClick={source === 'github' ? onSignIn : () => setGlConnect(true)}
              >
                {t('Connect to {provider}', { provider })}
              </Button>
            </div>
          ) : (
            <>
              <h2 className="mb-6 text-[18px] font-semibold">{t('Clone a Repo')}</h2>
              <div className="grid grid-cols-[170px_1fr] items-center gap-x-4 gap-y-4">
                <Label>{t('Where to clone to')}</Label>
                <div className="flex gap-2">
                  <Input
                    value={parent}
                    onChange={(e) => setParent(e.target.value)}
                    spellCheck={false}
                  />
                  <Button
                    onClick={async () => {
                      const p = await pickFolder(t('Clone into'), parent);
                      if (p) setParent(p);
                    }}
                  >
                    {t('Browse')}
                  </Button>
                </div>

                {source === 'url' ? (
                  <>
                    <Label>URL</Label>
                    <Input
                      autoFocus
                      data-autofocus
                      placeholder="https://github.com/owner/repo.git"
                      value={urlInput}
                      onChange={(e) => {
                        setUrlInput(e.target.value);
                        setName(null);
                      }}
                      spellCheck={false}
                    />
                  </>
                ) : (
                  <>
                    <Label>{t('Repository to clone')}</Label>
                    <RepoCombobox
                      key={source}
                      repos={(source === 'github' ? gh.repos : gl.repos) ?? []}
                      loading={source === 'github' ? gh.reposLoading : gl.reposLoading}
                      value={picked[source]}
                      onPick={(r) => {
                        setPicked((p) => ({ ...p, [source]: r }));
                        setName(null);
                      }}
                    />
                  </>
                )}

                <Label>{t('Full path')}</Label>
                <div className="flex min-w-0 items-center gap-1 text-muted-foreground">
                  <span className="truncate">{parent ? joinPath(parent, '') : '—'}</span>
                  <Input
                    className="h-7 w-56 shrink-0 text-foreground"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('folder name')}
                    spellCheck={false}
                    aria-label={t('Folder name')}
                  />
                </div>

                <Label>{t('Options')}</Label>
                <div className="flex flex-col gap-3">
                  <CheckRow
                    checked={shallow}
                    onChange={setShallow}
                    label={t('Shallow Clone')}
                    help={t('Download only the latest commit of each branch.')}
                  />
                  <CheckRow
                    checked={sparse}
                    onChange={setSparse}
                    label={t('Sparse Checkout')}
                    help={t('Check out only the top-level files; add folders later.')}
                  />
                  {ws && (
                    <CheckRow
                      checked={toWorkspace}
                      onChange={setToWorkspace}
                      label={t('Add to workspace “{name}”', { name: ws.name })}
                      help={t('List the clone in this workspace once it is done.')}
                    />
                  )}
                </div>
              </div>

              <div className="mt-auto flex justify-end gap-2 pt-6">
                <Button onClick={onClose} disabled={busy}>
                  {t('Cancel')}
                </Button>
                <button
                  type="button"
                  onClick={clone}
                  disabled={busy || !url.trim() || !dest}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-success px-4 font-semibold whitespace-nowrap text-background transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy && <Spinner />} {busy ? t('Cloning…') : t('Clone the repo!')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <GitLabConnectDialog open={glConnect} onClose={() => setGlConnect(false)} />
    </Modal>
  );
}

function NavItem({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-9 items-center gap-2.5 rounded-md px-3 text-left',
        active ? 'bg-accent-soft font-medium text-foreground' : 'hover:bg-surface-hover',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

const Label = ({ children }: { children: ReactNode }) => (
  <div className="text-right text-muted-foreground">{children}</div>
);

function CheckRow({
  checked,
  onChange,
  label,
  help,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  help: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <Checkbox className="mt-0.5" checked={checked} onChange={(v) => onChange(v)} />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{help}</span>
      </span>
    </label>
  );
}

/** "Search Remotes" combobox: filters as you type, groups by owner / namespace. */
export function RepoCombobox({
  repos,
  loading,
  value,
  onPick,
}: {
  repos: GitHubRepo[];
  loading: boolean;
  value: GitHubRepo | null;
  onPick: (r: GitHubRepo) => void;
}) {
  const [query, setQuery] = useState(value?.fullName ?? '');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const q = query === value?.fullName ? '' : query.trim().toLowerCase();
    const list = repos.filter((r) => r.fullName.toLowerCase().includes(q));
    const owner = (r: GitHubRepo) => r.fullName.slice(0, r.fullName.lastIndexOf('/'));
    // Stable grouping: owners in first-seen order, repos keep their order within a group.
    const order = new Map<string, number>();
    for (const r of list) if (!order.has(owner(r))) order.set(owner(r), order.size);
    return list
      .map((r, i) => ({ r, i }))
      .sort((a, b) => order.get(owner(a.r))! - order.get(owner(b.r))! || a.i - b.i)
      .slice(0, 300)
      .map(({ r }) => ({ repo: r, owner: owner(r) }));
  }, [repos, query, value]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  const pick = (r: GitHubRepo) => {
    onPick(r);
    setQuery(r.fullName);
    setOpen(false);
  };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
      <Input
        autoFocus
        className="pr-8 pl-8"
        placeholder={t('Search Remotes')}
        value={query}
        role="combobox"
        aria-expanded={open}
        onFocus={(e) => {
          e.target.select();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQuery(e.target.value);
          setHi(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setHi((h) => Math.min(h + 1, shown.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && open && shown[hi]) {
            e.preventDefault();
            pick(shown[hi].repo);
          }
        }}
        spellCheck={false}
      />
      {loading ? (
        <Spinner className="absolute top-2 right-2.5 text-muted-foreground" />
      ) : (
        <ChevronDown className="pointer-events-none absolute top-2 right-2.5 size-4 text-muted-foreground" />
      )}
      {open && (
        <div
          ref={listRef}
          role="listbox"
          className="absolute top-full right-0 left-0 z-10 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-surface py-1 shadow-xl"
          // Keep focus in the input so the click lands before blur closes the list.
          onMouseDown={(e) => e.preventDefault()}
        >
          {loading && repos.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground">
              <Spinner /> {t('Loading repositories…')}
            </div>
          )}
          {!loading && shown.length === 0 && (
            <div className="px-3 py-2 text-muted-foreground">{t('No repositories match.')}</div>
          )}
          {shown.map(({ repo, owner }, i) => (
            <div key={repo.fullName}>
              {(i === 0 || shown[i - 1]?.owner !== owner) && (
                <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {owner}
                </div>
              )}
              <div
                role="option"
                data-idx={i}
                aria-selected={i === hi}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(repo)}
                className={cn(
                  'flex h-7 cursor-default items-center gap-2 px-3 pl-5',
                  i === hi && 'bg-accent text-accent-foreground',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{repo.name}</span>
                {repo.private && <Lock className="size-3 shrink-0 opacity-70" />}
                {value?.fullName === repo.fullName && <Check className="size-3.5 shrink-0" />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

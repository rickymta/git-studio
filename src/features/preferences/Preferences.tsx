import {
  ArrowLeft,
  Brush,
  Check,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  Plug,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldCheck,
  Trash2,
  User,
  Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Avatar, Button, Github, Input, Spinner, cn } from '@/components/ui';
import { GitKrakenImport } from '@/features/welcome/Welcome';
import { useViewMode } from '@/features/panel/FileList';
import { useZoom } from '@/features/toolbar/StatusBar';
import { api } from '@/lib/ipc';
import { copyText, openUrl, pickFile, pickFolder } from '@/lib/native';
import type { GitHubSshKey, LocalKey, Settings, SshInfo, SshTestResult } from '@/lib/types';
import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';
import { confirm, toast, useUi } from '@/stores/ui';

export type PrefSection =
  'general' | 'profile' | 'ssh' | 'integrations' | 'ui' | 'tools' | 'import';

const SECTIONS: { id: PrefSection; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'General', icon: <SettingsIcon className="size-[18px]" /> },
  { id: 'profile', label: 'Profile', icon: <User className="size-[18px]" /> },
  { id: 'ssh', label: 'SSH', icon: <ShieldCheck className="size-[18px]" /> },
  { id: 'integrations', label: 'Integrations', icon: <Plug className="size-[18px]" /> },
  { id: 'ui', label: 'UI Customization', icon: <Brush className="size-[18px]" /> },
  { id: 'tools', label: 'External Tools', icon: <Wrench className="size-[18px]" /> },
  { id: 'import', label: 'Import', icon: <Download className="size-[18px]" /> },
];

/** Full-page preferences, saved as you change them. */
export function Preferences({
  section,
  onSection,
  onExit,
  onSignIn,
}: {
  section: PrefSection;
  onSection: (s: PrefSection) => void;
  onExit: () => void;
  onSignIn: () => void;
}) {
  const user = useGitHub((s) => s.user);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useUi.getState().prompt) onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  return (
    <div className="flex min-h-0 flex-1">
      <nav className="flex w-[280px] shrink-0 flex-col border-r border-border bg-surface">
        <button
          type="button"
          onClick={onExit}
          className="flex h-12 items-center gap-2 px-4 text-[17px] font-medium hover:bg-surface-hover"
        >
          <ArrowLeft className="size-5" /> Exit Preferences
        </button>
        <div className="px-4 pt-2 pb-1 text-xs text-muted-foreground">Account</div>
        <div className="mx-2 flex items-center gap-2.5 rounded-md bg-surface-muted px-2.5 py-2">
          {user ? (
            <>
              <Avatar name={user.login} url={user.avatarUrl} size={24} />
              <span className="truncate">{user.name ?? user.login}</span>
            </>
          ) : (
            <>
              <Github className="size-5 text-muted-foreground" />
              <button type="button" className="text-accent hover:underline" onClick={onSignIn}>
                Connect GitHub
              </button>
            </>
          )}
        </div>
        <div className="px-4 pt-4 pb-1 text-xs text-muted-foreground">Preferences</div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSection(s.id)}
            className={cn(
              'flex h-11 items-center gap-3 px-5 text-left text-[16px]',
              section === s.id
                ? 'bg-accent-soft text-foreground'
                : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
            )}
          >
            {s.icon}
            {s.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="max-w-4xl px-14 py-8">
          {section === 'general' && <General />}
          {section === 'profile' && <Profile />}
          {section === 'ssh' && <Ssh />}
          {section === 'integrations' && <Integrations onSignIn={onSignIn} />}
          {section === 'ui' && <UiPrefs />}
          {section === 'tools' && <Tools />}
          {section === 'import' && (
            <>
              <Title>Import</Title>
              <Row label="GitKraken Desktop">
                <GitKrakenImport compact />
                <ImportFallback />
              </Row>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- layout helpers -----------------------------------------------------------------------------

const Title = ({ children }: { children: ReactNode }) => (
  <h1 className="mb-6 text-[26px] font-semibold">{children}</h1>
);

function Row({
  label,
  help,
  warn,
  children,
}: {
  label: string;
  help?: ReactNode;
  warn?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mb-7 grid grid-cols-[220px_1fr] items-start gap-x-8">
      <div className="pt-1.5 text-right text-[14px]">{label}</div>
      <div className="min-w-0">
        {children}
        {help && <div className="mt-1.5 text-xs text-muted-foreground">{help}</div>}
        {warn && <div className="mt-1 text-xs text-warning">⚠ {warn}</div>}
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <label className="flex items-center gap-2 pt-1.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-[var(--accent)]"
      />
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </label>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-9 w-80 rounded-md border border-border bg-background px-2"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Text field that saves on blur / Enter. */
function Field({
  value,
  onSave,
  placeholder,
  type = 'text',
  className,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  const [v, setV] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    // Follow external changes (e.g. after an import).
    setLast(value);
    setV(value);
  }
  return (
    <Input
      type={type}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={cn('h-9 w-80', className)}
      spellCheck={false}
    />
  );
}

/** Settings + an `update` that saves immediately. */
function useSettings(): [Settings | null, (patch: Partial<Settings>) => Promise<void>] {
  const settings = useRepo((s) => s.settings);
  const setSettings = useRepo((s) => s.setSettings);
  const update = useCallback(
    async (patch: Partial<Settings>) => {
      const cur = useRepo.getState().settings;
      if (!cur) return;
      const next = { ...cur, ...patch };
      setSettings(next);
      try {
        setSettings(await api.saveSettings(next));
      } catch (e) {
        toast('error', 'Could not save preferences', (e as Error).message);
      }
    },
    [setSettings],
  );
  return [settings, update];
}

function useGitConfig(keys: string[]) {
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const keyStr = keys.join(',');
  useEffect(() => {
    api
      .gitConfig(keyStr.split(','))
      .then(setValues)
      .catch(() => setValues({}));
  }, [keyStr]);
  const set = async (key: string, value: string | null) => {
    try {
      await api.setGitConfig(key, value);
      setValues((v) => ({ ...(v ?? {}), [key]: value ?? '' }));
    } catch (e) {
      toast('error', `Could not set ${key}`, (e as Error).message);
    }
  };
  return [values, set] as const;
}

// ---- sections -----------------------------------------------------------------------------------

function General() {
  const [s, update] = useSettings();
  const [git, setGit] = useGitConfig(['core.longpaths', 'core.autocrlf']);
  const [version, setVersion] = useState('');
  useEffect(() => {
    api
      .gitVersion()
      .then(setVersion)
      .catch(() => setVersion('Git was not found on PATH'));
  }, []);
  if (!s) return null;
  return (
    <>
      <Title>General</Title>
      <Row
        label="Auto-Fetch Interval"
        help="In minutes, between 0 and 60 (0 disables auto-fetch). Fetches the remotes of the open repository in the background."
      >
        <Field
          value={String(s.autoFetchMinutes)}
          onSave={(v) => update({ autoFetchMinutes: Math.max(0, Math.min(60, Number(v) || 0)) })}
        />
      </Row>
      <Row
        label="Auto-Prune"
        help="Remove remote-tracking branches that were deleted on the remote when fetching."
      >
        <Toggle checked={s.autoPrune} onChange={(v) => update({ autoPrune: v })} />
      </Row>
      <Row label="Default Branch Name" help="Initial branch name when creating new repositories.">
        <Field
          value={s.defaultBranch}
          onSave={(v) => update({ defaultBranch: v.trim() || 'main' })}
        />
      </Row>
      <Row
        label="Pull Strategy"
        help="What the Pull button does when your branch and its upstream have both changed."
      >
        <Select
          value={s.pullMode}
          onChange={(v) => update({ pullMode: v })}
          options={[
            { value: 'merge', label: 'Merge (fast-forward if possible)' },
            { value: 'rebase', label: 'Rebase' },
            { value: 'ff-only', label: 'Fast-forward only' },
          ]}
        />
      </Row>
      <Row
        label="Initial Commits in Graph"
        help="Minimum 500. More commits load when you scroll to the end of the graph."
        warn="Increasing this value may slow down large repositories."
      >
        <Field
          value={String(s.initialCommits)}
          onSave={(v) =>
            update({ initialCommits: Math.max(500, Math.min(20000, Number(v) || 2000)) })
          }
        />
      </Row>
      <Row label="Remember Tabs" help="Reopen the repository tabs of your last session.">
        <Toggle checked={s.rememberTabs} onChange={(v) => update({ rememberTabs: v })} />
      </Row>
      <Row label="Default Clone Folder">
        <div className="flex gap-1">
          <Field value={s.cloneDir} onSave={(v) => update({ cloneDir: v })} className="w-[420px]" />
          <Button
            onClick={async () => {
              const p = await pickFolder('Default clone folder', s.cloneDir);
              if (p) await update({ cloneDir: p });
            }}
          >
            Browse
          </Button>
        </div>
      </Row>
      <Row
        label="Git Executable"
        help="GitStudio runs the git found on PATH, so hooks, credential helpers and LFS behave as in your terminal."
      >
        <div className="pt-1.5 font-mono text-[13px]">{version || '…'}</div>
      </Row>
      <Row
        label="Longpaths"
        help="Sets core.longpaths in your global Git config. Windows only supports paths under 260 characters without it."
      >
        {git && (
          <Toggle
            checked={git['core.longpaths'] === 'true'}
            onChange={(v) => setGit('core.longpaths', v ? 'true' : null)}
          />
        )}
      </Row>
      <Row label="Line Endings" help="core.autocrlf in your global Git config.">
        {git && (
          <Select
            value={(git['core.autocrlf'] || 'unset') as string}
            onChange={(v) => setGit('core.autocrlf', v === 'unset' ? null : v)}
            options={[
              { value: 'unset', label: 'Not set (Git default)' },
              { value: 'true', label: 'true — CRLF in working tree, LF in repo' },
              { value: 'input', label: 'input — convert CRLF to LF on commit' },
              { value: 'false', label: 'false — never convert' },
            ]}
          />
        )}
      </Row>
    </>
  );
}

function Profile() {
  const [git, setGit] = useGitConfig(['user.name', 'user.email', 'commit.gpgsign']);
  if (!git) return <Spinner />;
  return (
    <>
      <Title>Profile</Title>
      <Row label="Author Name" help="user.name in your global Git config; used for every commit.">
        <Field
          value={git['user.name'] ?? ''}
          onSave={(v) => setGit('user.name', v.trim() || null)}
        />
      </Row>
      <Row
        label="Author Email"
        help="user.email in your global Git config. Use an email GitHub knows so commits link to your account."
      >
        <Field
          value={git['user.email'] ?? ''}
          onSave={(v) => setGit('user.email', v.trim() || null)}
        />
      </Row>
      <Row
        label="Sign Commits"
        help="commit.gpgsign in your global Git config. Requires a signing key already configured for git."
      >
        <Toggle
          checked={git['commit.gpgsign'] === 'true'}
          onChange={(v) => setGit('commit.gpgsign', v ? 'true' : null)}
        />
      </Row>
    </>
  );
}

function Ssh() {
  const [info, setInfo] = useState<SshInfo | null>(null);
  const [test, setTest] = useState<SshTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [gen, setGen] = useState({ name: 'id_ed25519_github', comment: '', passphrase: '' });
  const [generating, setGenerating] = useState(false);
  const user = useGitHub((s) => s.user);
  const [, update] = useSettings();
  const preferSsh = useRepo((s) => s.settings?.preferSsh ?? false);

  const reload = useCallback(() => {
    api
      .sshInfo()
      .then(setInfo)
      .catch((e) => toast('error', 'Could not read SSH settings', (e as Error).message));
  }, []);
  useEffect(reload, [reload]);

  if (!info) return <Spinner />;
  const s = info.settings;
  const save = async (patch: Partial<SshInfo['settings']>) => {
    try {
      setInfo(await api.saveSsh({ ...s, ...patch }));
      setTest(null);
    } catch (e) {
      toast('error', 'Could not save SSH settings', (e as Error).message);
    }
  };
  const chooseKey = (k: LocalKey) =>
    save({ mode: 'key', privateKey: k.privatePath ?? '', publicKey: k.publicPath });

  const runTest = async () => {
    setTesting(true);
    try {
      setTest(await api.sshTest('github.com'));
    } catch (e) {
      setTest({ ok: false, user: null, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const k = await api.sshGenerate(gen.name, gen.comment || user?.login || '', gen.passphrase);
      await chooseKey(k);
      reload();
      toast('success', `Generated ${k.name}`, k.publicPath);
      setGen((g) => ({ ...g, passphrase: '' }));
    } catch (e) {
      toast('error', 'Could not generate key', (e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const current = info.current;

  return (
    <>
      <Title>SSH</Title>
      <Row label="Authentication" help={info.sshVersion ? `Using ${info.sshVersion}` : undefined}>
        <div className="flex flex-col gap-2 pt-1">
          <label className="flex items-start gap-2">
            <input
              type="radio"
              checked={s.mode === 'system'}
              onChange={() => save({ mode: 'system' })}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span>
              Use local SSH setup
              <span className="block text-xs text-muted-foreground">
                ~/.ssh/config, default keys and ssh-agent — exactly what `git` in a terminal uses.
                Best for passphrase-protected keys loaded in an agent.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              checked={s.mode === 'key'}
              onChange={() => save({ mode: 'key' })}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span>
              Use a specific key
              <span className="block text-xs text-muted-foreground">
                GitStudio passes this key to git for every SSH remote.
              </span>
            </span>
          </label>
        </div>
      </Row>

      {s.mode === 'key' && (
        <>
          <Row label="SSH Private Key">
            <PathField
              value={s.privateKey}
              onPick={async () => {
                const p = await pickFile('SSH private key', s.privateKey || info.sshDir);
                if (p) await save({ privateKey: p, publicKey: `${p}.pub` });
              }}
              onSave={(v) => save({ privateKey: v })}
            />
          </Row>
          <Row label="SSH Public Key">
            <PathField
              value={s.publicKey}
              onPick={async () => {
                const p = await pickFile('SSH public key', s.publicKey || info.sshDir);
                if (p) await save({ publicKey: p });
              }}
              onSave={(v) => save({ publicKey: v })}
            />
          </Row>
          {current && (
            <Row label="Public Key">
              <KeyCard k={current} />
            </Row>
          )}
        </>
      )}

      <Row
        label="Test Connection"
        help="Connects to git@github.com with the settings above. Accepts GitHub's host key on first use."
      >
        <div className="flex items-center gap-3">
          <Button onClick={runTest} disabled={testing}>
            {testing ? <Spinner /> : <RefreshCw className="size-4" />} Test GitHub SSH
          </Button>
          {test && (
            <span className={cn('text-[13px]', test.ok ? 'text-success' : 'text-danger')}>
              {test.ok ? `✓ Authenticated as ${test.user}` : '✕ Not authenticated'}
            </span>
          )}
        </div>
        {test && !test.ok && (
          <pre className="selectable mt-2 max-h-40 overflow-auto rounded-md bg-surface-muted p-2 font-mono text-xs whitespace-pre-wrap">
            {test.message}
          </pre>
        )}
      </Row>

      <Row
        label="Remote URLs"
        help="Use SSH instead of HTTPS URLs when cloning or adding GitHub repositories."
      >
        <Toggle checked={preferSsh} onChange={(v) => update({ preferSsh: v })} />
      </Row>

      <Row label="Keys in ~/.ssh" help={info.sshDir}>
        <div className="flex flex-col gap-2">
          {info.keys.length === 0 && (
            <span className="pt-1.5 text-muted-foreground">No keys found.</span>
          )}
          {info.keys.map((k) => {
            const active =
              s.mode === 'key' && !!k.privatePath && samePath(k.privatePath, s.privateKey);
            return (
              <div
                key={k.publicPath}
                className={cn(
                  'flex items-center gap-3 rounded-md border px-3 py-2',
                  active ? 'border-accent bg-accent-soft' : 'border-border',
                )}
              >
                <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {k.name} <span className="text-xs text-muted-foreground">{k.keyType}</span>
                  </div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {k.fingerprint ?? k.publicPath} {k.comment && `· ${k.comment}`}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    copyText(k.publicKey).then(() => toast('success', 'Public key copied'))
                  }
                >
                  <Copy className="size-3.5" /> Copy
                </Button>
                {active ? (
                  <span className="flex items-center gap-1 text-xs text-accent">
                    <Check className="size-3.5" /> In use
                  </span>
                ) : (
                  <Button size="sm" disabled={!k.privatePath} onClick={() => chooseKey(k)}>
                    Use
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Row>

      <Row
        label="Generate New Key"
        help="Creates an ed25519 key pair in ~/.ssh and switches GitStudio to it. Then add the public key to GitHub (Integrations or the button on the key)."
      >
        <div className="grid w-[420px] grid-cols-[110px_1fr] items-center gap-2">
          <span className="text-xs text-muted-foreground">File name</span>
          <Input
            value={gen.name}
            onChange={(e) => setGen({ ...gen, name: e.target.value })}
            spellCheck={false}
          />
          <span className="text-xs text-muted-foreground">Comment</span>
          <Input
            value={gen.comment}
            placeholder={user?.login ?? 'you@example.com'}
            onChange={(e) => setGen({ ...gen, comment: e.target.value })}
          />
          <span className="text-xs text-muted-foreground">Passphrase</span>
          <Input
            type="password"
            value={gen.passphrase}
            placeholder="Optional"
            onChange={(e) => setGen({ ...gen, passphrase: e.target.value })}
          />
        </div>
        {gen.passphrase && (
          <div className="mt-1.5 text-xs text-warning">
            ⚠ GitStudio cannot type a passphrase for git. Load the key into ssh-agent and use the
            local SSH setup.
          </div>
        )}
        <Button
          className="mt-3"
          variant="primary"
          onClick={generate}
          disabled={generating || !gen.name.trim()}
        >
          {generating && <Spinner />} Generate key
        </Button>
      </Row>
    </>
  );
}

const samePath = (a: string, b: string) =>
  a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();

function PathField({
  value,
  onPick,
  onSave,
}: {
  value: string;
  onPick: () => void;
  onSave: (v: string) => void;
}) {
  return (
    <div className="flex gap-1">
      <Button onClick={onPick}>Browse</Button>
      <Field
        value={value}
        onSave={onSave}
        className="w-[460px] font-mono text-xs"
        placeholder="Not set"
      />
    </div>
  );
}

/** A public key with copy and "add to GitHub". */
function KeyCard({ k }: { k: LocalKey }) {
  const user = useGitHub((s) => s.user);
  const [adding, setAdding] = useState(false);
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <pre className="selectable max-h-24 overflow-auto font-mono text-xs break-all whitespace-pre-wrap">
        {k.publicKey}
      </pre>
      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          onClick={() => copyText(k.publicKey).then(() => toast('success', 'Public key copied'))}
        >
          <Copy className="size-3.5" /> Copy public key
        </Button>
        {user && (
          <Button
            size="sm"
            disabled={adding}
            onClick={async () => {
              setAdding(true);
              try {
                const title = `GitStudio · ${k.comment || k.name}`;
                await api.ghAddKey(title, k.publicKey);
                toast('success', 'Key added to GitHub', title);
              } catch (e) {
                toast('error', 'Could not add the key to GitHub', (e as Error).message);
              } finally {
                setAdding(false);
              }
            }}
          >
            {adding ? <Spinner /> : <Github className="size-3.5" />} Add to GitHub
          </Button>
        )}
      </div>
    </div>
  );
}

function Integrations({ onSignIn }: { onSignIn: () => void }) {
  const { user, signOut, check } = useGitHub();
  const [, update] = useSettings();
  const clientId = useRepo((s) => s.settings?.githubClientId ?? '');
  const [keys, setKeys] = useState<GitHubSshKey[] | null>(null);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [local, setLocal] = useState<SshInfo | null>(null);

  const loadKeys = useCallback(() => {
    api
      .ghKeys()
      .then((k) => {
        setKeys(k);
        setKeysError(null);
      })
      .catch((e) => setKeysError((e as Error).message));
  }, []);

  useEffect(() => {
    if (!user) return;
    loadKeys();
    api
      .sshInfo()
      .then(setLocal)
      .catch(() => {});
  }, [user, loadKeys]);

  const importFrom = async (source: 'gh' | 'git') => {
    try {
      const u = await api.ghImportToken(source);
      useGitHub.getState().setUser(u);
      toast('success', `Connected to GitHub as ${u.login}`);
    } catch (e) {
      toast('error', 'Could not reuse existing credentials', (e as Error).message);
    }
  };

  const body = (k: string) => k.trim().split(/\s+/).slice(0, 2).join(' ');
  const localBodies = new Map((local?.keys ?? []).map((k) => [body(k.publicKey), k.name]));
  const scopes = user?.scopes;
  const canManageKeys = !scopes || scopes.some((x) => x.includes('public_key'));

  return (
    <>
      <Title>Integrations</Title>
      <div className="mb-6 flex items-center gap-3 border-b border-border pb-4">
        <Github className="size-7" />
        <h2 className="text-[20px] font-semibold">GitHub</h2>
      </div>

      {user ? (
        <>
          <Row label="Account">
            <div className="flex items-center gap-3">
              <Avatar name={user.login} url={user.avatarUrl} size={40} />
              <div className="min-w-0">
                <div className="font-medium">{user.name ?? user.login}</div>
                <button
                  type="button"
                  className="text-xs text-accent hover:underline"
                  onClick={() => openUrl(user.htmlUrl)}
                >
                  @{user.login}
                </button>
              </div>
              <Button
                className="ml-6"
                variant="ghost"
                onClick={async () => {
                  if (
                    await confirm(
                      'Disconnect GitHub',
                      'Remove the stored GitHub token from this computer?',
                      'Disconnect',
                      true,
                    )
                  ) {
                    await signOut();
                    setKeys(null);
                  }
                }}
              >
                Disconnect
              </Button>
            </div>
          </Row>
          <Row
            label="Token Permissions"
            help={
              scopes === null || scopes === undefined
                ? 'Fine-grained token: permissions are set per repository on GitHub.'
                : undefined
            }
            warn={
              !canManageKeys
                ? 'This token cannot manage SSH keys (admin:public_key). Reconnect with a token that has it to add keys from GitStudio.'
                : undefined
            }
          >
            <div className="flex flex-wrap gap-1 pt-1">
              {(scopes ?? []).map((sc) => (
                <span key={sc} className="rounded bg-surface-muted px-2 py-0.5 font-mono text-xs">
                  {sc}
                </span>
              ))}
              <Button size="sm" variant="ghost" onClick={() => check()}>
                <RefreshCw className="size-3.5" /> Recheck
              </Button>
            </div>
          </Row>
          <Row
            label="SSH Keys on GitHub"
            help="Keys marked “this computer” match a key in your ~/.ssh folder."
          >
            {keysError && (
              <div className="mb-2 text-xs whitespace-pre-wrap text-danger">{keysError}</div>
            )}
            {!keys && !keysError && <Spinner />}
            {keys && keys.length === 0 && (
              <div className="pt-1.5 text-muted-foreground">No SSH keys on your account.</div>
            )}
            <div className="flex flex-col gap-2">
              {keys?.map((k) => {
                const mine = localBodies.get(body(k.key));
                return (
                  <div
                    key={k.id}
                    className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
                  >
                    <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{k.title}</div>
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {k.key.split(' ')[0]} …{k.key.split(' ')[1]?.slice(-16)}
                        {k.createdAt && ` · added ${new Date(k.createdAt).toLocaleDateString()}`}
                      </div>
                    </div>
                    {mine && (
                      <span className="rounded bg-accent-soft px-2 py-0.5 text-xs text-accent">
                        this computer · {mine}
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete ${k.title}`}
                      onClick={async () => {
                        if (
                          !(await confirm(
                            'Delete SSH key',
                            `Delete “${k.title}” from your GitHub account? Machines using it will lose SSH access.`,
                            'Delete',
                            true,
                          ))
                        )
                          return;
                        try {
                          await api.ghDeleteKey(k.id);
                          loadKeys();
                        } catch (e) {
                          toast('error', 'Could not delete key', (e as Error).message);
                        }
                      }}
                    >
                      <Trash2 className="size-3.5 text-danger" />
                    </Button>
                  </div>
                );
              })}
            </div>
            {local && local.keys.length > 0 && (
              <AddLocalKey
                keys={local.keys.filter(
                  (k) => !keys?.some((g) => body(g.key) === body(k.publicKey)),
                )}
                onAdded={loadKeys}
              />
            )}
          </Row>
        </>
      ) : (
        <Row
          label="Connect"
          help="The token is stored in the Windows Credential Manager and used for GitHub API calls and HTTPS git operations."
        >
          <div className="flex w-[460px] flex-col gap-2">
            <Button variant="primary" className="h-10 justify-start" onClick={onSignIn}>
              <Github className="size-4" /> Sign in with browser or token…
            </Button>
            <Button className="h-10 justify-start" onClick={() => importFrom('gh')}>
              <KeyRound className="size-4" /> Use GitHub CLI login (gh)
            </Button>
            <Button className="h-10 justify-start" onClick={() => importFrom('git')}>
              <KeyRound className="size-4" /> Use Git Credential Manager login
            </Button>
          </div>
        </Row>
      )}

      <Row
        label="OAuth App Client ID"
        help={
          <>
            Needed only for “Sign in with browser”. Create an OAuth App on GitHub (Settings →
            Developer settings → OAuth Apps), tick “Enable Device Flow”, and paste its Client ID.{' '}
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => openUrl('https://github.com/settings/applications/new')}
            >
              Create one <ExternalLink className="inline size-3" />
            </button>
          </>
        }
      >
        <Field
          value={clientId}
          onSave={(v) => update({ githubClientId: v.trim() })}
          placeholder="Ov23li…"
        />
      </Row>
    </>
  );
}

function AddLocalKey({ keys, onAdded }: { keys: LocalKey[]; onAdded: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (keys.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Add a key from this computer:</span>
      {keys.map((k) => (
        <Button
          key={k.publicPath}
          size="sm"
          disabled={busy !== null}
          onClick={async () => {
            setBusy(k.name);
            try {
              await api.ghAddKey(`GitStudio · ${k.comment || k.name}`, k.publicKey);
              toast('success', `Added ${k.name} to GitHub`);
              onAdded();
            } catch (e) {
              toast('error', 'Could not add the key to GitHub', (e as Error).message);
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === k.name ? <Spinner /> : <KeyRound className="size-3.5" />} {k.name}
        </Button>
      ))}
    </div>
  );
}

function UiPrefs() {
  const theme = useUi((s) => s.theme);
  const toggleTheme = useUi((s) => s.toggleTheme);
  const [zoom, setZoom] = useZoom();
  const [view, setView] = useViewMode();
  return (
    <>
      <Title>UI Customization</Title>
      <Row label="Theme">
        <Select
          value={theme}
          onChange={(v) => v !== theme && toggleTheme()}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
        />
      </Row>
      <Row label="Zoom" help="Ctrl + / Ctrl − / Ctrl 0 anywhere in the app.">
        <Select
          value={String(zoom)}
          onChange={(v) => setZoom(Number(v))}
          options={[0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5].map((z) => ({
            value: String(z),
            label: `${Math.round(z * 100)}%`,
          }))}
        />
      </Row>
      <Row label="File List" help="How changed files are listed in the right panel.">
        <Select
          value={view}
          onChange={setView}
          options={[
            { value: 'path', label: 'Path — full path on one line' },
            { value: 'tree', label: 'Tree — grouped by folder' },
          ]}
        />
      </Row>
    </>
  );
}

function Tools() {
  const [s, update] = useSettings();
  if (!s) return null;
  return (
    <>
      <Title>External Tools</Title>
      <Row
        label="External Editor"
        help="Command that opens a file or folder, e.g. code, cursor, subl, idea64. Used by “Open in editor”."
      >
        <Field
          value={s.externalEditor}
          onSave={(v) => update({ externalEditor: v.trim() })}
          placeholder="code"
        />
      </Row>
      <Row label="Terminal" help="Opened by the Terminal button in the toolbar and in workspaces.">
        <Select
          value={s.terminal}
          onChange={(v) => update({ terminal: v })}
          options={[
            { value: 'auto', label: 'Automatic (Windows Terminal, else Command Prompt)' },
            { value: 'wt', label: 'Windows Terminal' },
            { value: 'powershell', label: 'PowerShell' },
            { value: 'cmd', label: 'Command Prompt' },
            { value: 'gitbash', label: 'Git Bash' },
          ]}
        />
      </Row>
    </>
  );
}

function ImportFallback() {
  const [found, setFound] = useState<boolean | null>(null);
  useEffect(() => {
    api
      .gitkrakenDetect()
      .then((d) => setFound(!!d))
      .catch(() => setFound(false));
  }, []);
  if (found !== false) return null;
  return (
    <div className="pt-1.5 text-muted-foreground">
      GitKraken Desktop was not found on this computer.
    </div>
  );
}

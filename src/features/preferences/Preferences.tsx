import {
  ArrowLeft,
  Brush,
  Check,
  Copy,
  Database,
  Download,
  ExternalLink,
  FolderGit2,
  KeyRound,
  Plug,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldCheck,
  User,
  Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Avatar, Button, Github, Input, Spinner, cn } from '@/components/ui';
import { GitLabConnectOptions, GitLabIcon } from '@/features/gitlab/GitLab';
import { GitKrakenImport } from '@/features/welcome/Welcome';
import { useViewMode } from '@/features/panel/FileList';
import { useZoom } from '@/features/toolbar/StatusBar';
import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  BRIGHTNESS_STEP,
  useBrightness,
  type ThemeName,
} from '@/lib/brightness';
import { LANGUAGES, t, useLang, useLangStore } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { copyText, openUrl, pickFile, pickFolder } from '@/lib/native';
import type { GitHubSshKey, LocalKey, Settings, SshInfo, SshTestResult } from '@/lib/types';
import { useActivity } from '@/stores/activity';
import { useGitHub } from '@/stores/github';
import { ensureGitLabChecked, useGitLab } from '@/stores/gitlab';
import { CredentialsPrefs } from './Credentials';
import { RepoPrefs } from './RepoPrefs';
import { useRepo } from '@/stores/repo';
import { confirm, toast, useUi } from '@/stores/ui';

export type PrefSection =
  | 'general'
  | 'profile'
  | 'ssh'
  | 'credentials'
  | 'integrations'
  | 'ui'
  | 'tools'
  | 'import'
  | 'data'
  | 'repo';

const SECTIONS: { id: PrefSection; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'General', icon: <SettingsIcon className="size-[18px]" /> },
  { id: 'profile', label: 'Profile', icon: <User className="size-[18px]" /> },
  { id: 'ssh', label: 'SSH', icon: <ShieldCheck className="size-[18px]" /> },
  { id: 'credentials', label: 'Credentials', icon: <KeyRound className="size-[18px]" /> },
  { id: 'integrations', label: 'Integrations', icon: <Plug className="size-[18px]" /> },
  { id: 'ui', label: 'UI Customization', icon: <Brush className="size-[18px]" /> },
  { id: 'tools', label: 'External Tools', icon: <Wrench className="size-[18px]" /> },
  { id: 'import', label: 'Import', icon: <Download className="size-[18px]" /> },
  { id: 'data', label: 'Data & History', icon: <Database className="size-[18px]" /> },
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
  const repoPath = useRepo((s) => s.path);
  const repoName = useRepo((s) => s.info?.name);

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
          <ArrowLeft className="size-5" /> {t('Exit Preferences')}
        </button>
        <div className="px-4 pt-2 pb-1 text-xs text-muted-foreground">{t('Account')}</div>
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
                {t('Connect GitHub')}
              </button>
            </>
          )}
        </div>
        <div className="px-4 pt-4 pb-1 text-xs text-muted-foreground">{t('Preferences')}</div>
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
            {t(s.label)}
          </button>
        ))}
        {repoPath && (
          <>
            <div className="px-4 pt-4 pb-1 text-xs text-muted-foreground">
              {t('Repo-Specific Preferences')}
            </div>
            <button
              type="button"
              onClick={() => onSection('repo')}
              className={cn(
                'flex h-11 items-center gap-3 px-5 text-left text-[16px]',
                section === 'repo'
                  ? 'bg-accent-soft text-foreground'
                  : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
              )}
            >
              <FolderGit2 className="size-[18px]" />
              <span className="truncate">{t('Repo: {name}', { name: repoName ?? '' })}</span>
            </button>
          </>
        )}
      </nav>
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="max-w-4xl px-14 py-8">
          {section === 'general' && <General />}
          {section === 'data' && <DataPrefs />}
          {section === 'profile' && <Profile />}
          {section === 'ssh' && <Ssh />}
          {section === 'credentials' && <CredentialsPrefs />}
          {section === 'repo' && repoPath && <RepoPrefs repo={repoPath} />}
          {section === 'integrations' && <Integrations onSignIn={onSignIn} />}
          {section === 'ui' && <UiPrefs />}
          {section === 'tools' && <Tools />}
          {section === 'import' && (
            <>
              <Title>{t('Import')}</Title>
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

/** Brightness of one theme: a slider (live preview), the value, and a reset to 100%. */
function BrightnessSlider({ theme }: { theme: ThemeName }) {
  const [value, setValue] = useBrightness(theme);
  return (
    <div className="flex h-9 w-full max-w-[460px] items-center gap-3">
      <span className="text-xs text-muted-foreground" aria-hidden>
        {t('Darker')}
      </span>
      <input
        type="range"
        min={BRIGHTNESS_MIN}
        max={BRIGHTNESS_MAX}
        step={BRIGHTNESS_STEP}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        aria-label={theme === 'dark' ? t('Brightness — dark theme') : t('Brightness — light theme')}
        aria-valuetext={`${value}%`}
        className="min-w-0 flex-1 accent-[var(--accent)]"
      />
      <span className="text-xs text-muted-foreground" aria-hidden>
        {t('Brighter')}
      </span>
      <span className="w-10 text-right font-mono text-xs tabular-nums">{value}%</span>
      <Button
        variant="ghost"
        size="sm"
        disabled={value === 100}
        onClick={() => setValue(100)}
        title={t('Reset to 100%')}
      >
        {t('Reset')}
      </Button>
    </div>
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
        toast('error', t('Could not save preferences'), (e as Error).message);
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
      toast('error', t('Could not set {key}', { key }), (e as Error).message);
    }
  };
  return [values, set] as const;
}

// ---- sections -----------------------------------------------------------------------------------

const fmtBytes = (n: number) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;

/** Where the activity history and UI state are kept, and how much of it. */
function DataPrefs() {
  const [s, update] = useSettings();
  const stats = useActivity((a) => a.stats);
  const clear = useActivity((a) => a.clear);
  if (!s) return null;
  const pct = stats ? Math.min(100, (stats.bytes / stats.maxBytes) * 100) : 0;
  return (
    <>
      <Title>{t('Data & History')}</Title>
      <Row
        label={t('Activity history file')}
        help={t(
          'Every operation (pull, push, commit, …) is appended to this file and read back when GitStudio starts.',
        )}
      >
        <div className="selectable pt-1.5 font-mono text-[12.5px] break-all">
          {stats?.path ?? '…'}
        </div>
        {stats && (
          <div className="mt-2">
            <div className="flex items-center gap-3 text-[13px]">
              <span>
                {t('{size} · {n} entries', { size: fmtBytes(stats.bytes), n: stats.entries })}
              </span>
              {stats.level !== 'ok' && (
                <span className={stats.level === 'full' ? 'text-danger' : 'text-warning'}>
                  ⚠{' '}
                  {stats.level === 'full'
                    ? t('At the size limit: the oldest entries are being dropped')
                    : t('Over the warning size')}
                </span>
              )}
            </div>
            <div className="mt-1.5 h-1.5 w-80 overflow-hidden rounded-full bg-surface-muted">
              <div
                className={cn(
                  'h-full',
                  stats.level === 'full'
                    ? 'bg-danger'
                    : stats.level === 'warn'
                      ? 'bg-warning'
                      : 'bg-success',
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </Row>
      <Row
        label={t('Delete history after (days)')}
        help={t('Older entries are removed when GitStudio starts. 0 keeps everything.')}
      >
        <Field
          value={String(s.historyRetentionDays)}
          onSave={(v) =>
            update({
              historyRetentionDays: Math.max(0, Math.min(3650, Math.round(Number(v) || 0))),
            })
          }
        />
      </Row>
      <Row label={t('Warn when larger than (MB)')}>
        <Field
          value={String(s.historyWarnMb)}
          onSave={(v) =>
            update({
              historyWarnMb: Math.max(1, Math.min(s.historyMaxMb, Math.round(Number(v) || 5))),
            })
          }
        />
      </Row>
      <Row
        label={t('Maximum size (MB)')}
        help={t('Past this size the oldest entries are dropped automatically.')}
      >
        <Field
          value={String(s.historyMaxMb)}
          onSave={(v) => {
            const max = Math.max(1, Math.min(1024, Math.round(Number(v) || 20)));
            return update({ historyMaxMb: max, historyWarnMb: Math.min(s.historyWarnMb, max) });
          }}
        />
      </Row>
      <Row
        label={t('Entries loaded at startup')}
        help={t('Only the most recent entries are loaded, so startup stays fast.')}
      >
        <Field
          value={String(s.historyLoadLimit)}
          onSave={(v) =>
            update({
              historyLoadLimit: Math.max(100, Math.min(100000, Math.round(Number(v) || 2000))),
            })
          }
        />
      </Row>
      <Row label={t('Clear history')}>
        <Button
          variant="danger"
          onClick={async () => {
            if (
              await confirm(
                t('Clear history'),
                t('Delete every entry of the activity history? This cannot be undone.'),
                t('Delete'),
                true,
              )
            )
              clear('all');
          }}
        >
          {t('Delete all history')}
        </Button>
      </Row>
    </>
  );
}

function General() {
  const [s, update] = useSettings();
  const [git, setGit] = useGitConfig(['core.longpaths', 'core.autocrlf']);
  const [version, setVersion] = useState('');
  useEffect(() => {
    api
      .gitVersion()
      .then(setVersion)
      .catch(() => setVersion(t('Git was not found on PATH')));
  }, []);
  if (!s) return null;
  return (
    <>
      <Title>{t('General')}</Title>
      <Row
        label={t('Auto-Fetch Interval')}
        help={t(
          'In minutes, between 0 and 60 (0 disables auto-fetch). Fetches the remotes of the open repository in the background.',
        )}
      >
        <Field
          value={String(s.autoFetchMinutes)}
          onSave={(v) => update({ autoFetchMinutes: Math.max(0, Math.min(60, Number(v) || 0)) })}
        />
      </Row>
      <Row
        label={t('Auto-Prune')}
        help={t('Remove remote-tracking branches that were deleted on the remote when fetching.')}
      >
        <Toggle checked={s.autoPrune} onChange={(v) => update({ autoPrune: v })} />
      </Row>
      <Row
        label={t('Default Branch Name')}
        help={t('Initial branch name when creating new repositories.')}
      >
        <Field
          value={s.defaultBranch}
          onSave={(v) => update({ defaultBranch: v.trim() || 'main' })}
        />
      </Row>
      <Row
        label={t('Pull Strategy')}
        help={t('What the Pull button does when your branch and its upstream have both changed.')}
      >
        <Select
          value={s.pullMode}
          onChange={(v) => update({ pullMode: v })}
          options={[
            { value: 'merge', label: t('Merge (fast-forward if possible)') },
            { value: 'rebase', label: t('Rebase') },
            { value: 'ff-only', label: t('Fast-forward only') },
          ]}
        />
      </Row>
      <Row
        label={t('Initial Commits in Graph')}
        help={t('Minimum 500. More commits load when you scroll to the end of the graph.')}
        warn={t('Increasing this value may slow down large repositories.')}
      >
        <Field
          value={String(s.initialCommits)}
          onSave={(v) =>
            update({ initialCommits: Math.max(500, Math.min(20000, Number(v) || 2000)) })
          }
        />
      </Row>
      <Row label={t('Remember Tabs')} help={t('Reopen the repository tabs of your last session.')}>
        <Toggle checked={s.rememberTabs} onChange={(v) => update({ rememberTabs: v })} />
      </Row>
      <Row label={t('Default Clone Folder')}>
        <div className="flex gap-1">
          <Field value={s.cloneDir} onSave={(v) => update({ cloneDir: v })} className="w-[420px]" />
          <Button
            onClick={async () => {
              const p = await pickFolder(t('Default clone folder'), s.cloneDir);
              if (p) await update({ cloneDir: p });
            }}
          >
            {t('Browse')}
          </Button>
        </div>
      </Row>
      <Row
        label={t('Git Executable')}
        help={t(
          'GitStudio runs the git found on PATH, so hooks, credential helpers and LFS behave as in your terminal.',
        )}
      >
        <div className="pt-1.5 font-mono text-[13px]">{version || '…'}</div>
      </Row>
      <Row
        label={t('Long Paths')}
        help={t(
          'core.longpaths in your global Git config. Without it Git for Windows fails on paths over 260 characters (“Filename too long”, e.g. deep node_modules) when checking out, removing worktrees or cleaning. On by default: GitStudio turns it on at start unless you turned it off here.',
        )}
      >
        {git && (
          <Toggle
            // Unset counts as on: GitStudio sets it at the next start.
            checked={git['core.longpaths'] !== 'false'}
            // Off is written as `false`, so the default does not turn it back on.
            onChange={(v) => setGit('core.longpaths', v ? 'true' : 'false')}
            label={
              git['core.longpaths'] === 'true'
                ? 'core.longpaths = true'
                : git['core.longpaths'] === 'false'
                  ? 'core.longpaths = false'
                  : t('Not set yet (turned on at the next start)')
            }
          />
        )}
      </Row>
      <Row label={t('Line Endings')} help={t('core.autocrlf in your global Git config.')}>
        {git && (
          <Select
            value={(git['core.autocrlf'] || 'unset') as string}
            onChange={(v) => setGit('core.autocrlf', v === 'unset' ? null : v)}
            options={[
              { value: 'unset', label: t('Not set (Git default)') },
              { value: 'true', label: t('true — CRLF in working tree, LF in repo') },
              { value: 'input', label: t('input — convert CRLF to LF on commit') },
              { value: 'false', label: t('false — never convert') },
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
      <Title>{t('Profile')}</Title>
      <Row
        label={t('Author Name')}
        help={t('user.name in your global Git config; used for every commit.')}
      >
        <Field
          value={git['user.name'] ?? ''}
          onSave={(v) => setGit('user.name', v.trim() || null)}
        />
      </Row>
      <Row
        label={t('Author Email')}
        help={t(
          'user.email in your global Git config. Use an email GitHub knows so commits link to your account.',
        )}
      >
        <Field
          value={git['user.email'] ?? ''}
          onSave={(v) => setGit('user.email', v.trim() || null)}
        />
      </Row>
      <Row
        label={t('Sign Commits')}
        help={t(
          'commit.gpgsign in your global Git config. Requires a signing key already configured for git.',
        )}
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
      .catch((e) => toast('error', t('Could not read SSH settings'), (e as Error).message));
  }, []);
  useEffect(reload, [reload]);

  if (!info) return <Spinner />;
  const s = info.settings;
  const save = async (patch: Partial<SshInfo['settings']>) => {
    try {
      setInfo(await api.saveSsh({ ...s, ...patch }));
      setTest(null);
    } catch (e) {
      toast('error', t('Could not save SSH settings'), (e as Error).message);
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
      toast('success', t('Generated {name}', { name: k.name }), k.publicPath);
      setGen((g) => ({ ...g, passphrase: '' }));
    } catch (e) {
      toast('error', t('Could not generate key'), (e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const current = info.current;

  return (
    <>
      <Title>SSH</Title>
      <Row
        label={t('Authentication')}
        help={info.sshVersion ? t('Using {version}', { version: info.sshVersion }) : undefined}
      >
        <div className="flex flex-col gap-2 pt-1">
          <label className="flex items-start gap-2">
            <input
              type="radio"
              checked={s.mode === 'system'}
              onChange={() => save({ mode: 'system' })}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span>
              {t('Use local SSH setup')}
              <span className="block text-xs text-muted-foreground">
                {t(
                  '~/.ssh/config, default keys and ssh-agent — exactly what `git` in a terminal uses. Best for passphrase-protected keys loaded in an agent.',
                )}
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
              {t('Use a specific key')}
              <span className="block text-xs text-muted-foreground">
                {t('GitStudio passes this key to git for every SSH remote.')}
              </span>
            </span>
          </label>
        </div>
      </Row>

      {s.mode === 'key' && (
        <>
          <Row label={t('SSH Private Key')}>
            <PathField
              value={s.privateKey}
              onPick={async () => {
                const p = await pickFile(t('SSH private key'), s.privateKey || info.sshDir);
                if (p) await save({ privateKey: p, publicKey: `${p}.pub` });
              }}
              onSave={(v) => save({ privateKey: v })}
            />
          </Row>
          <Row label={t('SSH Public Key')}>
            <PathField
              value={s.publicKey}
              onPick={async () => {
                const p = await pickFile(t('SSH public key'), s.publicKey || info.sshDir);
                if (p) await save({ publicKey: p });
              }}
              onSave={(v) => save({ publicKey: v })}
            />
          </Row>
          {current && (
            <Row label={t('Public Key')}>
              <KeyCard k={current} />
            </Row>
          )}
        </>
      )}

      <Row
        label={t('Test Connection')}
        help={t(
          "Connects to git@github.com with the settings above. Accepts GitHub's host key on first use.",
        )}
      >
        <div className="flex items-center gap-3">
          <Button onClick={runTest} disabled={testing}>
            {testing ? <Spinner /> : <RefreshCw className="size-4" />} {t('Test GitHub SSH')}
          </Button>
          {test && (
            <span className={cn('text-[13px]', test.ok ? 'text-success' : 'text-danger')}>
              {test.ok
                ? `✓ ${t('Authenticated as {user}', { user: test.user ?? '' })}`
                : `✕ ${t('Not authenticated')}`}
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
        label={t('Remote URLs')}
        help={t('Use SSH instead of HTTPS URLs when cloning or adding GitHub repositories.')}
      >
        <Toggle checked={preferSsh} onChange={(v) => update({ preferSsh: v })} />
      </Row>

      <Row label={t('Keys in ~/.ssh')} help={info.sshDir}>
        <div className="flex flex-col gap-2">
          {info.keys.length === 0 && (
            <span className="pt-1.5 text-muted-foreground">{t('No keys found.')}</span>
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
                    copyText(k.publicKey).then(() => toast('success', t('Public key copied')))
                  }
                >
                  <Copy className="size-3.5" /> {t('Copy')}
                </Button>
                {active ? (
                  <span className="flex items-center gap-1 text-xs text-accent">
                    <Check className="size-3.5" /> {t('In use')}
                  </span>
                ) : (
                  <Button size="sm" disabled={!k.privatePath} onClick={() => chooseKey(k)}>
                    {t('Use')}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Row>

      <Row
        label={t('Generate New Key')}
        help={t(
          'Creates an ed25519 key pair in ~/.ssh and switches GitStudio to it. Then add the public key to GitHub (Integrations or the button on the key).',
        )}
      >
        <div className="grid w-[420px] grid-cols-[110px_1fr] items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('File name')}</span>
          <Input
            value={gen.name}
            onChange={(e) => setGen({ ...gen, name: e.target.value })}
            spellCheck={false}
          />
          <span className="text-xs text-muted-foreground">{t('Comment')}</span>
          <Input
            value={gen.comment}
            placeholder={user?.login ?? 'you@example.com'}
            onChange={(e) => setGen({ ...gen, comment: e.target.value })}
          />
          <span className="text-xs text-muted-foreground">{t('Passphrase')}</span>
          <Input
            type="password"
            value={gen.passphrase}
            placeholder={t('Optional')}
            onChange={(e) => setGen({ ...gen, passphrase: e.target.value })}
          />
        </div>
        {gen.passphrase && (
          <div className="mt-1.5 text-xs text-warning">
            ⚠{' '}
            {t(
              'GitStudio cannot type a passphrase for git. Load the key into ssh-agent and use the local SSH setup.',
            )}
          </div>
        )}
        <Button
          className="mt-3"
          variant="primary"
          onClick={generate}
          disabled={generating || !gen.name.trim()}
        >
          {generating && <Spinner />} {t('Generate key')}
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
      <Button onClick={onPick}>{t('Browse')}</Button>
      <Field
        value={value}
        onSave={onSave}
        className="w-[460px] font-mono text-xs"
        placeholder={t('Not set')}
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
          onClick={() => copyText(k.publicKey).then(() => toast('success', t('Public key copied')))}
        >
          <Copy className="size-3.5" /> {t('Copy public key')}
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
                toast('success', t('Key added to GitHub'), title);
              } catch (e) {
                toast('error', t('Could not add the key to GitHub'), (e as Error).message);
              } finally {
                setAdding(false);
              }
            }}
          >
            {adding ? <Spinner /> : <Github className="size-3.5" />} {t('Add to GitHub')}
          </Button>
        )}
      </div>
    </div>
  );
}

type Provider = 'github' | 'gitlab';

const DANGER_OUTLINE =
  'inline-flex h-7 shrink-0 items-center rounded-md border border-danger px-2.5 text-xs font-medium whitespace-nowrap text-danger hover:bg-danger-soft disabled:opacity-50';

/** Sizes an element to fill the scrolling preferences pane (escaping its max-width wrapper). */
function useFillPane() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; minHeight: number } | null>(null);
  useEffect(() => {
    const pane = el?.parentElement?.parentElement;
    if (!pane) return;
    const measure = () => setSize({ width: pane.clientWidth, minHeight: pane.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(pane);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size ?? undefined] as const;
}

function Integrations({ onSignIn }: { onSignIn: () => void }) {
  const [provider, setProvider] = useState<Provider>('github');
  const [fillRef, fillStyle] = useFillPane();
  const items: { id: Provider; label: string; icon: ReactNode }[] = [
    { id: 'github', label: 'GitHub', icon: <Github className="size-[18px]" /> },
    { id: 'gitlab', label: 'GitLab', icon: <GitLabIcon className="size-[18px]" /> },
  ];

  return (
    <div ref={fillRef} style={fillStyle} className="-mx-14 -my-8 flex">
      <nav className="flex w-[250px] shrink-0 flex-col border-r border-border bg-surface py-4">
        <div className="px-5 pb-2 text-xs text-muted-foreground">{t('Integrations')}</div>
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => setProvider(it.id)}
            className={cn(
              'flex h-10 items-center gap-3 px-5 text-left text-[15px]',
              provider === it.id
                ? 'bg-accent-soft text-foreground'
                : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
            )}
          >
            {it.icon}
            {it.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 px-10 py-8">
        {provider === 'github' ? <GitHubIntegration onSignIn={onSignIn} /> : <GitLabIntegration />}
      </div>
    </div>
  );
}

const ProviderTitle = ({ children }: { children: ReactNode }) => (
  <h1 className="mb-6 text-[24px] font-semibold">{children}</h1>
);

/** Connected account card: avatar + login · “Connected” · Disconnect. */
function AccountCard({
  login,
  name,
  avatarUrl,
  htmlUrl,
  onDisconnect,
}: {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
  onDisconnect: () => void;
}) {
  return (
    <div className="mb-8 flex w-[500px] max-w-full items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={login} url={avatarUrl} size={36} />
        <div className="min-w-0">
          <div className="truncate font-medium">{name ?? login}</div>
          <button
            type="button"
            className="text-xs text-accent hover:underline"
            onClick={() => openUrl(htmlUrl)}
          >
            @{login}
          </button>
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-1 font-medium text-success">
        <Check className="size-4" /> {t('Connected')}
      </span>
      <div className="flex flex-1 justify-end">
        <button type="button" className={DANGER_OUTLINE} onClick={onDisconnect}>
          {t('Disconnect')}
        </button>
      </div>
    </div>
  );
}

/** Not-connected card: a short line and the connect options, centred. */
function ConnectCard({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="mb-8 flex w-[500px] max-w-full flex-col items-center gap-4 rounded-lg border border-border bg-surface px-6 py-6 text-center">
      <div className="text-muted-foreground">{text}</div>
      {children}
    </div>
  );
}

function GitHubIntegration({ onSignIn }: { onSignIn: () => void }) {
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
      toast('success', t('Connected to GitHub as {login}', { login: u.login }));
    } catch (e) {
      toast('error', t('Could not reuse existing credentials'), (e as Error).message);
    }
  };

  const body = (k: string) => k.trim().split(/\s+/).slice(0, 2).join(' ');
  const localBodies = new Map((local?.keys ?? []).map((k) => [body(k.publicKey), k.name]));
  const scopes = user?.scopes;
  const canManageKeys = !scopes || scopes.some((x) => x.includes('public_key'));

  return (
    <>
      <ProviderTitle>GitHub</ProviderTitle>
      {user ? (
        <>
          <AccountCard
            login={user.login}
            name={user.name}
            avatarUrl={user.avatarUrl}
            htmlUrl={user.htmlUrl}
            onDisconnect={async () => {
              if (
                await confirm(
                  t('Disconnect GitHub'),
                  t('Remove the stored GitHub token from this computer?'),
                  t('Disconnect'),
                  true,
                )
              ) {
                await signOut();
                setKeys(null);
              }
            }}
          />
          <Row
            label={t('Token Permissions')}
            help={
              scopes === null || scopes === undefined
                ? t('Fine-grained token: permissions are set per repository on GitHub.')
                : undefined
            }
            warn={
              !canManageKeys
                ? t(
                    'This token cannot manage SSH keys (admin:public_key). Reconnect with a token that has it to add keys from GitStudio.',
                  )
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
                <RefreshCw className="size-3.5" /> {t('Recheck')}
              </Button>
            </div>
          </Row>
          <Row
            label={t('SSH Key')}
            help={t('Keys marked “this computer” match a key in your ~/.ssh folder.')}
          >
            {keysError && (
              <div className="mb-2 text-xs whitespace-pre-wrap text-danger">{keysError}</div>
            )}
            {!keys && !keysError && <Spinner />}
            {keys && keys.length === 0 && (
              <div className="pt-1.5 text-muted-foreground">
                {t('No SSH keys on your account.')}
              </div>
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
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{k.title}</span>
                        {mine && (
                          <span className="rounded bg-accent-soft px-2 py-0.5 text-xs text-accent">
                            {t('this computer')} · {mine}
                          </span>
                        )}
                      </div>
                      {k.createdAt && (
                        <div className="text-xs text-muted-foreground">
                          {t('added {date}', {
                            date: new Date(k.createdAt).toLocaleDateString(),
                          })}
                        </div>
                      )}
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {k.key.split(' ')[0]} …{k.key.split(' ')[1]?.slice(-16)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={DANGER_OUTLINE}
                      onClick={async () => {
                        if (
                          !(await confirm(
                            t('Delete SSH key'),
                            t(
                              'Delete “{title}” from your GitHub account? Machines using it will lose SSH access.',
                              { title: k.title },
                            ),
                            t('Delete'),
                            true,
                          ))
                        )
                          return;
                        try {
                          await api.ghDeleteKey(k.id);
                          loadKeys();
                        } catch (e) {
                          toast('error', t('Could not delete key'), (e as Error).message);
                        }
                      }}
                    >
                      {t('Remove and Delete')}
                    </button>
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
        <ConnectCard
          text={t(
            'The token is stored in the Windows Credential Manager and used for GitHub API calls and HTTPS git operations.',
          )}
        >
          <div className="flex w-full max-w-[420px] flex-col gap-2">
            <Button variant="primary" className="h-10 justify-start" onClick={onSignIn}>
              <Github className="size-4" /> {t('Sign in with browser or token…')}
            </Button>
            <Button className="h-10 justify-start" onClick={() => importFrom('gh')}>
              <KeyRound className="size-4" /> {t('Use GitHub CLI login (gh)')}
            </Button>
            <Button className="h-10 justify-start" onClick={() => importFrom('git')}>
              <KeyRound className="size-4" /> {t('Use Git Credential Manager login')}
            </Button>
          </div>
        </ConnectCard>
      )}

      <Row
        label={t('OAuth App Client ID')}
        help={
          <>
            {t(
              'Needed only for “Sign in with browser”. Create an OAuth App on GitHub (Settings → Developer settings → OAuth Apps), tick “Enable Device Flow”, and paste its Client ID.',
            )}{' '}
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => openUrl('https://github.com/settings/applications/new')}
            >
              {t('Create one')} <ExternalLink className="inline size-3" />
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

function GitLabIntegration() {
  const user = useGitLab((s) => s.user);
  const checked = useGitLab((s) => s.checked);
  useEffect(() => ensureGitLabChecked(), []);

  return (
    <>
      <ProviderTitle>GitLab</ProviderTitle>
      {!checked ? (
        <Spinner />
      ) : user ? (
        <AccountCard
          login={user.login}
          name={user.name}
          avatarUrl={user.avatarUrl}
          htmlUrl={user.htmlUrl}
          onDisconnect={async () => {
            if (
              await confirm(
                t('Disconnect GitLab'),
                t('Remove the stored GitLab token from this computer?'),
                t('Disconnect'),
                true,
              )
            ) {
              try {
                await useGitLab.getState().signOut();
              } catch (e) {
                toast('error', t('Could not disconnect GitLab'), (e as Error).message);
              }
            }
          }}
        />
      ) : (
        <ConnectCard
          text={t(
            'Connect GitLab.com to browse and clone your projects. The token is stored in the Windows Credential Manager.',
          )}
        >
          <div className="flex w-full justify-center text-left">
            <GitLabConnectOptions />
          </div>
        </ConnectCard>
      )}
    </>
  );
}

function AddLocalKey({ keys, onAdded }: { keys: LocalKey[]; onAdded: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (keys.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">{t('Add a key from this computer:')}</span>
      {keys.map((k) => (
        <Button
          key={k.publicPath}
          size="sm"
          disabled={busy !== null}
          onClick={async () => {
            setBusy(k.name);
            try {
              await api.ghAddKey(`GitStudio · ${k.comment || k.name}`, k.publicKey);
              toast('success', t('Added {name} to GitHub', { name: k.name }));
              onAdded();
            } catch (e) {
              toast('error', t('Could not add the key to GitHub'), (e as Error).message);
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
  const lang = useLang();
  const setLang = useLangStore((s) => s.setLang);
  const theme = useUi((s) => s.theme);
  const toggleTheme = useUi((s) => s.toggleTheme);
  const [zoom, setZoom] = useZoom();
  const [view, setView] = useViewMode();
  return (
    <>
      <Title>{t('UI Customization')}</Title>
      <Row label={t('Language')} help="Ngôn ngữ giao diện · Interface language">
        <Select
          value={lang}
          onChange={setLang}
          options={LANGUAGES.map((l) => ({
            value: l.id,
            label: l.native === l.label ? l.native : `${l.native} (${l.label})`,
          }))}
        />
      </Row>
      <Row label={t('Theme')}>
        <Select
          value={theme}
          onChange={(v) => v !== theme && toggleTheme()}
          options={[
            { value: 'dark', label: t('Dark') },
            { value: 'light', label: t('Light') },
          ]}
        />
      </Row>
      <Row
        label={t('Brightness — dark theme')}
        help={t(
          'Dims or brightens everything on screen while the dark theme is on. Saved for you only.',
        )}
      >
        <BrightnessSlider theme="dark" />
      </Row>
      <Row
        label={t('Brightness — light theme')}
        help={t('Same for the light theme; each theme keeps its own value.')}
      >
        <BrightnessSlider theme="light" />
      </Row>
      <Row label={t('Zoom')} help={t('Ctrl + / Ctrl − / Ctrl 0 anywhere in the app.')}>
        <Select
          value={String(zoom)}
          onChange={(v) => setZoom(Number(v))}
          options={[0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5].map((z) => ({
            value: String(z),
            label: `${Math.round(z * 100)}%`,
          }))}
        />
      </Row>
      <Row label={t('File List')} help={t('How changed files are listed in the right panel.')}>
        <Select
          value={view}
          onChange={setView}
          options={[
            { value: 'path', label: t('Path — full path on one line') },
            { value: 'tree', label: t('Tree — grouped by folder') },
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
      <Title>{t('External Tools')}</Title>
      <Row
        label={t('External Editor')}
        help={t(
          'Command that opens a file or folder, e.g. code, cursor, subl, idea64. Used by “Open in editor”.',
        )}
      >
        <Field
          value={s.externalEditor}
          onSave={(v) => update({ externalEditor: v.trim() })}
          placeholder="code"
        />
      </Row>
      <Row
        label={t('Terminal')}
        help={t('Opened by the Terminal button in the toolbar and in workspaces.')}
      >
        <Select
          value={s.terminal}
          onChange={(v) => update({ terminal: v })}
          options={[
            { value: 'auto', label: t('Automatic (Windows Terminal, else Command Prompt)') },
            { value: 'wt', label: 'Windows Terminal' },
            { value: 'powershell', label: 'PowerShell' },
            { value: 'cmd', label: t('Command Prompt') },
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
      {t('GitKraken Desktop was not found on this computer.')}
    </div>
  );
}

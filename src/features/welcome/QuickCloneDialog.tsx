import { ClipboardPaste, FolderOpen, GitBranch } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button, Input, Modal, Spinner, cn } from '@/components/ui';
import { joinPath, repoNameFromUrl } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { pickFolder } from '@/lib/native';
import { useRepo } from '@/stores/repo';
import { toast } from '@/stores/ui';

const HISTORY = 'gitstudio.cloneHistory';

function loadHistory(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function remember(url: string) {
  try {
    const next = [url, ...loadHistory().filter((u) => u !== url)].slice(0, 20);
    localStorage.setItem(HISTORY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/**
 * "Git Clone…" from the file manager's context menu, laid out like TortoiseGit's clone window:
 * URL (from the clipboard), target directory (the folder that was right-clicked + the repository
 * name) and every `git clone` option, in GitStudio's style.
 */
export function QuickCloneDialog({
  request,
  onClose,
}: {
  request: { dir: string; url: string | null } | null;
  onClose: () => void;
}) {
  // Mounted per request, so each opening starts from its own folder and link.
  return request ? (
    <QuickCloneBody key={`${request.dir}|${request.url}`} {...request} onClose={onClose} />
  ) : null;
}

function QuickCloneBody({
  dir,
  url: initialUrl,
  onClose,
}: {
  dir: string;
  url: string | null;
  onClose: () => void;
}) {
  const adopt = useRepo((s) => s.adopt);
  const [history] = useState(loadHistory);
  // Nothing usable on the clipboard when the menu was used: offer the last link cloned.
  const [url, setUrl] = useState(() => initialUrl ?? history[0] ?? '');
  const [parent, setParent] = useState(dir);
  const [customDest, setCustomDest] = useState<string | null>(null);
  const [depthOn, setDepthOn] = useState(false);
  const [depth, setDepth] = useState('1');
  const [recursive, setRecursive] = useState(false);
  const [bare, setBare] = useState(false);
  const [noCheckout, setNoCheckout] = useState(false);
  const [branchOn, setBranchOn] = useState(false);
  const [branch, setBranch] = useState('');
  const [originOn, setOriginOn] = useState(false);
  const [origin, setOrigin] = useState('origin');
  const [lfs, setLfs] = useState(false);
  const [openAfter, setOpenAfter] = useState(true);
  const [busy, setBusy] = useState(false);

  const name = repoNameFromUrl(url) + (bare ? '.git' : '');
  const dest = customDest ?? (parent && repoNameFromUrl(url) ? joinPath(parent, name) : '');

  const paste = async () => {
    const u = await api.clipboardGitUrl().catch(() => null);
    if (u) {
      setUrl(u);
      setCustomDest(null);
    } else toast('info', t('The clipboard does not hold a git link'));
  };

  const clone = async () => {
    setBusy(true);
    try {
      const res = await api.cloneAdvanced(url.trim(), dest, {
        depth: depthOn ? Math.max(1, Number(depth) || 1) : undefined,
        recursive,
        bare,
        noCheckout,
        branch: branchOn ? branch.trim() || undefined : undefined,
        origin: originOn ? origin.trim() || undefined : undefined,
        lfs,
      });
      remember(url.trim());
      toast('success', t('Cloned into {path}', { path: res.path }));
      onClose();
      if (res.info && openAfter) await adopt(res.info);
    } catch (e) {
      toast('error', t('Clone failed'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ready = !!url.trim() && !!dest && !busy && (!branchOn || !!branch.trim());

  return (
    <Modal open onClose={() => !busy && onClose()} title={t('Git Clone')} width={680}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void clone();
        }}
      >
        <Group title={t('Clone existing repository')}>
          <div className="grid grid-cols-[92px_1fr_auto] items-center gap-x-3 gap-y-3">
            <Label>URL</Label>
            <Input
              autoFocus
              list="gitstudio-clone-history"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setCustomDest(null);
              }}
              placeholder="https://github.com/owner/repo.git"
              spellCheck={false}
            />
            <datalist id="gitstudio-clone-history">
              {history.map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
            <Button onClick={paste} title={t('Paste the git link from the clipboard')}>
              <ClipboardPaste className="size-4" /> {t('Paste')}
            </Button>

            <Label>{t('Directory')}</Label>
            <Input
              value={dest}
              onChange={(e) => setCustomDest(e.target.value)}
              placeholder={joinPath(parent || '…', 'repo')}
              spellCheck={false}
            />
            <Button
              onClick={async () => {
                const p = await pickFolder(t('Clone into'), parent);
                if (p) {
                  setParent(p);
                  setCustomDest(null);
                }
              }}
            >
              <FolderOpen className="size-4" /> {t('Browse')}
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5">
            <Check checked={depthOn} onChange={setDepthOn} label={t('Depth')}>
              <Input
                type="number"
                min={1}
                className="h-7 w-20"
                disabled={!depthOn}
                value={depth}
                onChange={(e) => setDepth(e.target.value)}
              />
            </Check>
            <Check
              checked={recursive}
              onChange={setRecursive}
              label={t('Recursive (submodules)')}
            />
            <Check checked={branchOn} onChange={setBranchOn} label={t('Branch')}>
              <div className="relative">
                <GitBranch className="pointer-events-none absolute top-1.5 left-2 size-3.5 text-muted-foreground" />
                <Input
                  className="h-7 w-40 pl-7"
                  disabled={!branchOn}
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                  spellCheck={false}
                />
              </div>
            </Check>
            <Check
              checked={bare}
              onChange={(v) => {
                setBare(v);
                setCustomDest(null);
              }}
              label={t('Clone into bare repository')}
            />
            <Check checked={originOn} onChange={setOriginOn} label={t('Origin name')}>
              <Input
                className="h-7 w-40"
                disabled={!originOn}
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                spellCheck={false}
              />
            </Check>
            <Check
              checked={noCheckout}
              onChange={setNoCheckout}
              label={t('No checkout')}
              disabled={bare}
            />
            <Check
              checked={lfs}
              onChange={setLfs}
              label={t('Download Git LFS files')}
              disabled={bare}
            />
          </div>
        </Group>

        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={openAfter && !bare}
            disabled={bare}
            onChange={(e) => setOpenAfter(e.target.checked)}
          />
          {t('Open in GitStudio after cloning')}
        </label>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>
            {t('Cancel')}
          </Button>
          <button
            type="submit"
            disabled={!ready}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-success px-5 font-semibold whitespace-nowrap text-background transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Spinner />} {busy ? t('Cloning…') : t('Clone')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-border px-4 pt-2 pb-4">
      <legend className="px-1.5 text-[13px] font-medium text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

const Label = ({ children }: { children: ReactNode }) => (
  <div className="text-[13px] text-muted-foreground">{children}</div>
);

function Check({
  checked,
  onChange,
  label,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={cn('flex h-7 items-center gap-3', disabled && 'opacity-50')}>
      <label className="flex min-w-32 cursor-pointer items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          className="size-4 accent-[var(--accent)]"
          checked={checked && !disabled}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
      {children}
    </div>
  );
}

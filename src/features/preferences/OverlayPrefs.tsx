import {
  CheckCircle2,
  CircleAlert,
  CircleDot,
  RefreshCw,
  RotateCcw,
  SquareTerminal,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button, Modal, Spinner } from '@/components/ui';
import { attach, closeSession, openSession, runInSession } from '@/features/terminal/runtime';
import { relativeTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { appResourceDir } from '@/lib/native';
import type { OverlayInfo, QuickCommand } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { toast } from '@/stores/ui';
import { Row, Title, Toggle } from './prefsKit';

const FILE_MANAGER = {
  windows: 'Explorer',
  macos: 'Finder',
  linux: 'Nautilus / Nemo / Caja',
} as const;

/** Preferences → File manager icons: git status badges on folders, like TortoiseGit. */
export function OverlayPrefs() {
  const [info, setInfo] = useState<OverlayInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [cmd, setCmd] = useState<QuickCommand | null>(null);
  const resource = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      resource.current = await appResourceDir();
      setInfo(await api.overlayInfo(resource.current));
    } catch (e) {
      toast('error', t('Could not read the file manager icon status'), (e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      const next = on
        ? await api.overlayEnable(resource.current)
        : await api.overlayDisable(resource.current);
      setInfo(next);
      const s = await api.settings();
      useRepo.getState().setSettings(s);
      toast(
        'success',
        on ? t('File manager icons turned on') : t('File manager icons turned off'),
        next.platform === 'windows'
          ? t('Restart Explorer if the icons do not change right away.')
          : undefined,
      );
    } catch (e) {
      toast('error', t('Could not change the file manager icons'), (e as Error).message);
      void load();
    } finally {
      setBusy(false);
    }
  };

  if (!info)
    return (
      <>
        <Title>{t('File manager icons')}</Title>
        <Spinner className="text-muted-foreground" />
      </>
    );

  const fm = FILE_MANAGER[info.platform];
  return (
    <>
      <Title>{t('File manager icons')}</Title>
      <Row
        label={t('Status icons on folders')}
        help={t(
          'Shows a badge on every repository folder in {fm}, like TortoiseGit. GitStudio keeps the status fresh in the background, also when it is closed.',
          { fm },
        )}
      >
        <div className="flex items-center gap-3">
          <Toggle checked={info.enabled} onChange={(v) => void toggle(v)} />
          {busy && <Spinner className="text-muted-foreground" />}
          {info.enabled && !busy && (
            <span className="text-[13px] text-muted-foreground">
              {info.installed
                ? t('Active in {fm}', { fm })
                : t('Turned on, but {fm} has not loaded it yet', { fm })}
            </span>
          )}
        </div>
        {info.platform === 'windows' && (
          <div className="mt-1.5 text-xs text-muted-foreground">
            {t(
              'Windows asks for administrator permission: overlay handlers are installed for the whole computer.',
            )}
          </div>
        )}
      </Row>

      <ContextMenuRow fm={fm} />

      <Row label={t('Legend')}>
        <div className="flex flex-col gap-1.5 pt-1 text-[13px]">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-success" />{' '}
            {t('Clean: tracked, nothing to commit, in sync')}
          </span>
          <span className="flex items-center gap-2">
            <CircleDot className="size-4 text-warning" />
            {t('Changes: uncommitted work, or commits to push / pull')}
          </span>
          <span className="flex items-center gap-2">
            <CircleAlert className="size-4 text-danger" />
            {t('Attention: conflicts, unfinished merge / rebase, or upstream deleted')}
          </span>
        </div>
      </Row>

      <Row
        label={t('Repositories')}
        help={t(
          'Recent repositories, workspace members and the other repositories in the same folders.',
        )}
      >
        <div className="flex items-center gap-3 pt-1 text-[13px]">
          <span>
            {info.updated
              ? t('{n} repositories · updated {when}', {
                  n: info.repos,
                  when: relativeTime(Math.floor(info.updated / 1000)),
                })
              : t('Not refreshed yet')}
          </span>
          <Button
            size="sm"
            onClick={async () => {
              await api.overlayRefresh().catch(() => {});
              void load();
            }}
          >
            <RefreshCw className="size-3.5" /> {t('Refresh now')}
          </Button>
        </div>
        <div className="selectable mt-1 font-mono text-[12px] break-all text-muted-foreground">
          {info.statusFile}
        </div>
      </Row>

      {info.notes.length > 0 && (
        <Row label={t('Notes')}>
          <ul className="flex list-disc flex-col gap-1 pt-1 pl-4 text-[13px] text-warning">
            {info.notes.map((n) => (
              <li key={n}>{t(n)}</li>
            ))}
          </ul>
        </Row>
      )}

      <Row
        label={t('Quick actions')}
        help={
          info.platform === 'windows'
            ? undefined
            : t(
                'Commands open in a terminal here; those marked sudo ask for your password in that terminal.',
              )
        }
      >
        <div className="flex flex-col items-start gap-2">
          <Button
            onClick={() =>
              api
                .overlayRestartFileManager()
                .then(() => toast('success', t('{fm} restarted', { fm })))
                .catch((e) => toast('error', t('Could not restart {fm}', { fm }), e.message))
            }
          >
            <RotateCcw className="size-4" /> {t('Restart {fm}', { fm })}
          </Button>
          {info.commands.map((c) => (
            <div key={c.command} className="flex max-w-full items-center gap-2">
              <Button onClick={() => setCmd(c)}>
                <SquareTerminal className="size-4" /> {t(c.label)}
                {c.sudo && (
                  <span className="rounded bg-danger-soft px-1 text-[10.5px] font-semibold text-danger">
                    sudo
                  </span>
                )}
              </Button>
              <code className="selectable truncate font-mono text-[12px] text-muted-foreground">
                {c.command}
              </code>
            </div>
          ))}
        </div>
      </Row>

      {cmd && <CommandTerminal cwd={info.home} command={cmd} onClose={() => setCmd(null)} />}
    </>
  );
}

/** "Open with GitStudio" in the file manager's context menu. */
function ContextMenuRow({ fm }: { fm: string }) {
  const enabled = useRepo((s) => s.settings?.contextMenu ?? true);
  const [busy, setBusy] = useState(false);
  return (
    <Row
      label={t('Context menu')}
      help={t('Adds "Open with GitStudio" when you right-click a folder in {fm}.', { fm })}
    >
      <div className="flex items-center gap-3">
        <Toggle
          checked={enabled}
          disabled={busy}
          onChange={async (v) => {
            setBusy(true);
            try {
              await api.shellMenuSet(v);
              useRepo.getState().setSettings(await api.settings());
            } catch (e) {
              toast('error', t('Could not change the context menu'), (e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
        {busy && <Spinner className="text-muted-foreground" />}
      </div>
    </Row>
  );
}

/** A terminal in a dialog that runs one command (the user answers sudo's password prompt). */
function CommandTerminal({
  cwd,
  command,
  onClose,
}: {
  cwd: string;
  command: QuickCommand;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [id, setId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    let sid: number | null = null;
    void openSession(cwd, { show: false }).then((n) => {
      if (n === null) return;
      if (!alive) {
        closeSession(n);
        return;
      }
      sid = n;
      setId(n);
      void runInSession(n, command.command);
    });
    return () => {
      alive = false;
      if (sid !== null) closeSession(sid);
    };
  }, [cwd, command.command]);

  useEffect(() => {
    if (id === null || !host.current) return;
    return attach(id, host.current);
  }, [id]);

  return (
    <Modal
      open
      onClose={onClose}
      title={t(command.label)}
      description={
        command.sudo ? t('Type your password in the terminal when sudo asks for it.') : undefined
      }
      width={820}
    >
      <div ref={host} className="h-[360px] overflow-hidden rounded-md bg-background p-1">
        {id === null && <Spinner className="m-3 text-muted-foreground" />}
      </div>
      <div className="mt-3 flex justify-end">
        <Button onClick={onClose}>{t('Close')}</Button>
      </div>
    </Modal>
  );
}

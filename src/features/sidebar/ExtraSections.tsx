import { Boxes, HardDrive, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ContextMenuWrap, Dropdown, type MenuItem } from '@/components/ui';
import { cn } from '@/lib/cn';
import { joinPath, short } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { copyText, revealPath } from '@/lib/native';
import type { LfsInfo, Submodule } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import * as R from '../repoTools';
import { Section } from './Section';

/** Sidebar sections for submodules and the other less common features. */
export function ExtraSections() {
  return (
    <>
      <SubmodulesSection />
      <LfsSection />
    </>
  );
}

/** Reload `load` whenever the repository changes (commit, checkout, refresh…). */
function useRepoData<T>(load: (path: string) => Promise<T>, fallback: T): T | null {
  const path = useRepo((s) => s.path);
  const info = useRepo((s) => s.info);
  const refs = useRepo((s) => s.refs);
  const [data, setData] = useState<{ path: string; value: T } | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    load(path)
      .then((value) => live && setData({ path, value }))
      .catch(() => live && setData({ path, value: fallback }));
    return () => {
      live = false;
    };
    // `load` and `fallback` are constants of the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, info, refs]);
  return data && data.path === path ? data.value : null;
}

const NO_SUBMODULES: Submodule[] = [];

const STATE_LABEL: Record<Submodule['state'], () => string> = {
  clean: () => t('Up to date'),
  uninitialized: () => t('Not initialised'),
  modified: () => t('Checked out at another commit than recorded'),
  conflict: () => t('Merge conflict'),
};

function submoduleMenu(s: Submodule): MenuItem[] {
  const path = useRepo.getState().path ?? '';
  return [
    {
      label: t('Open submodule'),
      disabled: s.state === 'uninitialized',
      onSelect: () => R.openSubmodule(s),
    },
    {
      label:
        s.state === 'uninitialized' ? t('Initialise and update') : t('Update to recorded commit'),
      onSelect: () => R.updateSubmodules([s]),
    },
    'sep',
    { label: t('Copy path'), onSelect: () => copyText(s.path) },
    { label: t('Copy URL'), onSelect: () => copyText(s.url) },
    { label: t('Show in file manager'), onSelect: () => revealPath(joinPath(path, s.path)) },
    'sep',
    {
      label: t('Deinitialise…'),
      danger: true,
      disabled: s.state === 'uninitialized',
      onSelect: () => R.deinitSubmodule(s),
    },
  ];
}

function SubmodulesSection() {
  const subs = useRepoData(api.submodules, NO_SUBMODULES);
  const dirty = (subs ?? []).filter((s) => s.state !== 'clean').length;
  return (
    <Section
      id="submodules"
      title={t('Submodules')}
      icon={<Boxes className="size-3.5" />}
      count={subs?.length}
      actions={
        <Dropdown
          items={[
            { label: t('Add submodule…'), onSelect: () => R.addSubmodule() },
            {
              label: t('Update all submodules'),
              disabled: !subs?.length,
              onSelect: () => R.updateSubmodules(),
            },
            {
              label: t('Sync URLs from .gitmodules'),
              disabled: !subs?.length,
              onSelect: () => R.syncSubmodules(),
            },
          ]}
        >
          <button
            type="button"
            aria-label={t('Submodule actions')}
            title={t('Submodule actions')}
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        </Dropdown>
      }
    >
      {!subs ? (
        <div className="h-7 pl-6 text-xs leading-7 text-muted-foreground">…</div>
      ) : subs.length === 0 ? (
        <div className="h-7 pl-6 text-xs leading-7 text-muted-foreground">
          {t('No submodules.')}
        </div>
      ) : (
        <>
          {dirty > 0 && (
            <button
              type="button"
              onClick={() => void R.updateSubmodules(subs.filter((s) => s.state !== 'clean'))}
              className="ml-6 text-xs text-accent hover:underline"
            >
              {t('Update {n} out-of-date submodule(s)', { n: dirty })}
            </button>
          )}
          {subs.map((s) => (
            <ContextMenuWrap key={s.path} items={() => submoduleMenu(s)}>
              <div
                onDoubleClick={() => s.state !== 'uninitialized' && void R.openSubmodule(s)}
                title={`${s.path}\n${s.url}${s.branch ? `\n${t('Branch')}: ${s.branch}` : ''}\n${STATE_LABEL[s.state]()}`}
                className="flex h-7 cursor-default items-center gap-1.5 pr-2 pl-6 hover:bg-surface-hover"
              >
                <Boxes
                  className={cn(
                    'size-3.5 shrink-0',
                    s.state === 'clean' ? 'text-muted-foreground' : 'text-warning',
                    s.state === 'conflict' && 'text-danger',
                  )}
                />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    s.state === 'uninitialized' && 'text-muted-foreground italic',
                  )}
                >
                  {s.path}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {s.current ? short(s.current) : s.recorded ? short(s.recorded) : ''}
                </span>
              </div>
            </ContextMenuWrap>
          ))}
        </>
      )}
    </Section>
  );
}

const NO_LFS: LfsInfo = { available: false, version: null, patterns: [], files: [] };

const actionsButton = (label: string) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground"
  >
    <Plus className="size-3.5" />
  </button>
);

/** Git LFS: tracked patterns and files; hidden while git-lfs is not installed. */
function LfsSection() {
  const lfs = useRepoData(api.lfsInfo, NO_LFS);
  if (!lfs?.available) return null;
  const missing = lfs.files.filter((f) => !f.downloaded).length;
  return (
    <Section
      id="lfs"
      title={t('Git LFS')}
      icon={<HardDrive className="size-3.5" />}
      count={lfs.files.length || undefined}
      actions={
        <Dropdown
          items={[
            { label: t('Track pattern…'), onSelect: () => R.lfsTrack() },
            'sep',
            { label: t('Download LFS files (pull)'), onSelect: () => R.lfsOp('pull') },
            { label: t('Fetch LFS objects'), onSelect: () => R.lfsOp('fetch') },
            { label: t('Prune old LFS objects'), onSelect: () => R.lfsOp('prune') },
            'sep',
            { label: t('Set up LFS for this repository'), onSelect: () => R.lfsInstall() },
          ]}
        >
          {actionsButton(t('LFS actions'))}
        </Dropdown>
      }
    >
      <div className="pl-6 text-[11px] text-muted-foreground" title={lfs.version ?? ''}>
        {lfs.patterns.length === 0 ? t('No patterns tracked with LFS.') : t('Tracked patterns')}
      </div>
      {lfs.patterns.map((p) => (
        <ContextMenuWrap
          key={p}
          items={() => [
            { label: t('Stop tracking with LFS'), onSelect: () => R.lfsUntrack(p) },
            { label: t('Copy pattern'), onSelect: () => copyText(p) },
          ]}
        >
          <div className="flex h-6 cursor-default items-center pr-2 pl-8 font-mono text-xs hover:bg-surface-hover">
            {p}
          </div>
        </ContextMenuWrap>
      ))}
      {missing > 0 && (
        <button
          type="button"
          onClick={() => void R.lfsOp('pull')}
          className="mt-1 ml-6 text-xs text-accent hover:underline"
        >
          {t('{n} file(s) are only pointers: download them', { n: missing })}
        </button>
      )}
    </Section>
  );
}

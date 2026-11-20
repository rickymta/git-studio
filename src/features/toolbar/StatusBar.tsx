import {
  CircleHelp,
  GitPullRequest,
  Keyboard,
  ListChecks,
  Minus,
  Plus,
  ZoomIn,
} from 'lucide-react';
import { useState } from 'react';

import { HelpDialog } from '@/features/help/HelpDialog';
import { GlobalShortcuts } from '@/features/shortcuts/GlobalShortcuts';
import { ActivityWindow, ShortcutsWindow } from '@/features/shortcuts/Windows';
import { TokenExpiry } from '@/features/tokens/TokenExpiry';
import { t } from '@/lib/i18n';
import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';

export function StatusBar({ zoom, setZoom }: { zoom: number; setZoom: (z: number) => void }) {
  const [win, setWindow] = useState<'activity' | 'shortcuts' | 'help' | null>(null);
  const path = useRepo((s) => s.path);
  const refs = useRepo((s) => s.refs);
  const pulls = useGitHub((s) => s.pulls);
  const user = useGitHub((s) => s.user);
  const hasGitHub = refs?.remotes.some((r) => r.github);
  const n = pulls?.length ?? 0;

  return (
    <div className="flex h-[26px] shrink-0 items-center gap-[12.6px] border-t border-border bg-surface px-[12.6px] text-[14.2px] text-muted-foreground">
      {path && hasGitHub && (
        <span className="flex items-center gap-[6.3px]">
          <GitPullRequest className="size-[15.3px]" />
          {!user
            ? t('GitHub not connected')
            : n === 0
              ? t('No Pull Requests')
              : n === 1
                ? t('{n} Pull Request', { n })
                : t('{n} Pull Requests', { n })}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{path ?? ''}</span>
      <TokenExpiry />
      <button
        type="button"
        title={`${t('Activity Logs')} (Ctrl+Shift+L)`}
        aria-label={t('Activity Logs')}
        onClick={() => setWindow('activity')}
        className="flex h-full items-center px-[4.5px] hover:text-foreground"
      >
        <ListChecks className="size-[15.3px]" />
      </button>
      <button
        type="button"
        title={`${t('Keyboard Shortcuts')} (Ctrl+/)`}
        aria-label={t('Keyboard Shortcuts')}
        onClick={() => setWindow('shortcuts')}
        className="flex h-full items-center px-[4.5px] hover:text-foreground"
      >
        <Keyboard className="size-[15.3px]" />
      </button>
      <GlobalShortcuts
        onShortcuts={() => setWindow((w) => (w === 'shortcuts' ? null : 'shortcuts'))}
        onActivity={() => setWindow((w) => (w === 'activity' ? null : 'activity'))}
      />
      <ShortcutsWindow open={win === 'shortcuts'} onClose={() => setWindow(null)} />
      <ActivityWindow open={win === 'activity'} onClose={() => setWindow(null)} />
      <span className="flex items-center gap-[4.5px]">
        <button
          type="button"
          aria-label={t('Zoom out')}
          onClick={() => setZoom(zoom - 0.1)}
          className="hover:text-foreground"
        >
          <Minus className="size-[13px]" />
        </button>
        <button
          type="button"
          title={t('Reset zoom (Ctrl+0)')}
          onClick={() => setZoom(1)}
          className="flex items-center gap-[4.5px] hover:text-foreground"
        >
          <ZoomIn className="size-[15.3px]" />
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          aria-label={t('Zoom in')}
          onClick={() => setZoom(zoom + 0.1)}
          className="hover:text-foreground"
        >
          <Plus className="size-[13px]" />
        </button>
      </span>
      <button
        type="button"
        title={t('Help & Support')}
        onClick={() => setWindow('help')}
        className="flex h-full items-center gap-[4.5px] px-[4.5px] hover:text-foreground"
      >
        <CircleHelp className="size-[15.3px]" />
        {t('Help')}
      </button>
      <HelpDialog open={win === 'help'} onClose={() => setWindow(null)} />
    </div>
  );
}

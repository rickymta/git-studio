import { useEffect } from 'react';

import * as A from '@/features/actions';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { useRepo } from '@/stores/repo';
import { toast, useUi } from '@/stores/ui';
import { useLaunchpad } from '@/stores/launchpad';

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.isContentEditable ||
      !!el.closest('.cm-editor, .xterm'))
  );
};

/** Move the graph selection one row (WIP row first when there are changes). */
function step(dir: 1 | -1) {
  const r = useRepo.getState();
  const st = r.info?.status;
  const dirty = !!st && st.staged.length + st.unstaged.length + st.conflicted.length > 0;
  const rows: ({ type: 'wip' } | { type: 'commit'; hash: string })[] = [
    ...(dirty ? [{ type: 'wip' as const }] : []),
    ...r.commits.map((c) => ({ type: 'commit' as const, hash: c.hash })),
  ];
  const sel = r.selection;
  const cur = rows.findIndex((x) =>
    sel?.type === 'wip'
      ? x.type === 'wip'
      : x.type === 'commit' && sel?.type === 'commit' && x.hash === sel.hash,
  );
  const next = rows[Math.max(0, Math.min(rows.length - 1, (cur < 0 ? -1 : cur) + dir))];
  if (next) void r.select(next);
}

/**
 * App-wide shortcuts that are not tied to one panel (the rest live where they apply, e.g.
 * Ctrl+Enter in the commit box). Mounted once, from the status bar.
 */
export function GlobalShortcuts({
  onShortcuts,
  onActivity,
}: {
  onShortcuts: () => void;
  onActivity: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().prompt) return;
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      const r = useRepo.getState();

      if (ctrl && !e.shiftKey && key === '/') {
        e.preventDefault();
        onShortcuts();
        return;
      }
      if (ctrl && e.shiftKey && key === 'l') {
        e.preventDefault();
        onActivity();
        return;
      }
      // The Launchpad has its own keys (J/K, S, …) while it covers the repository.
      if (!r.path || useLaunchpad.getState().open) return;

      if (ctrl && e.shiftKey && key === 'm') {
        e.preventDefault();
        if (r.selection?.type !== 'wip') void r.select({ type: 'wip' });
        setTimeout(() => document.getElementById('commit-summary')?.focus(), 0);
        return;
      }
      if (ctrl && e.shiftKey && key === 'h') {
        e.preventDefault();
        void A.goToHead();
        return;
      }
      if (ctrl && e.shiftKey && key === 's') {
        e.preventDefault();
        void r.run('Stage', (p) => api.stage(p, []));
        return;
      }
      if (ctrl && e.shiftKey && key === 'u') {
        e.preventDefault();
        void r.run('Unstage', (p) => api.unstage(p, []));
        return;
      }
      if (typing(e)) return;
      if (ctrl && !e.shiftKey && key === 'b') {
        e.preventDefault();
        void A.newBranch();
      } else if (ctrl && !e.shiftKey && key === 'l') {
        e.preventDefault();
        void A.fetchAll();
      } else if (e.altKey && !ctrl && key === 't') {
        e.preventDefault();
        api
          .openTerminal(r.path)
          .catch((err) => toast('error', t('Could not open terminal'), (err as Error).message));
      } else if (!ctrl && !e.altKey && (key === 'j' || key === 'k')) {
        e.preventDefault();
        step(key === 'j' ? 1 : -1);
      } else if (!ctrl && !e.altKey && (key === 's' || key === 'u') && r.diff) {
        const { source, path } = r.diff.request;
        if (key === 's' && source === 'unstaged') {
          e.preventDefault();
          void r.run('Stage', (p) => api.stage(p, [path]));
        } else if (key === 'u' && source === 'staged') {
          e.preventDefault();
          void r.run('Unstage', (p) => api.unstage(p, [path]));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onShortcuts, onActivity]);
  return null;
}

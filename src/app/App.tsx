import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { PromptDialog, Toasts } from '@/components/Overlays';
import { Button, Spinner } from '@/components/ui';
import { DiffView } from '@/features/diff/DiffView';
import { GitHubSignIn } from '@/features/github/GitHubSignIn';
import { CommitGraph } from '@/features/graph/CommitGraph';
import { CommitPanel } from '@/features/panel/CommitPanel';
import { WipPanel } from '@/features/panel/WipPanel';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { Sidebar } from '@/features/sidebar/Sidebar';
import { Toolbar } from '@/features/toolbar/Toolbar';
import { CloneDialog } from '@/features/welcome/CloneDialog';
import { Welcome } from '@/features/welcome/Welcome';
import * as A from '@/features/actions';
import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';
import { useUi } from '@/stores/ui';

const STATE_LABEL = {
  merging: 'Merge in progress',
  rebasing: 'Rebase in progress',
  cherryPicking: 'Cherry-pick in progress',
  reverting: 'Revert in progress',
} as const;

export function App() {
  const path = useRepo((s) => s.path);
  const info = useRepo((s) => s.info);
  const loading = useRepo((s) => s.loading);
  const selection = useRepo((s) => s.selection);
  const diff = useRepo((s) => s.diff);
  const theme = useUi((s) => s.theme);
  const [signIn, setSignIn] = useState(false);
  const [clone, setClone] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    (async () => {
      const repo = useRepo.getState();
      await repo.loadSettings();
      void useGitHub.getState().check();
      let last: string | null = null;
      try {
        last = localStorage.getItem('gitstudio.lastRepo');
      } catch {
        /* ignore */
      }
      if (last) await repo.open(last);
      setBooted(true);
    })();
  }, []);

  // Pick up changes made outside the app: on focus and every few seconds while visible.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void useRepo.getState().refreshStatus();
    };
    const onFocus = () => void useRepo.getState().refresh();
    window.addEventListener('focus', onFocus);
    const id = setInterval(tick, 4000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
        e.preventDefault();
        void useRepo.getState().refresh();
      }
      if (e.key === 'Escape' && useRepo.getState().diff && !useUi.getState().prompt) {
        useRepo.getState().closeDiff();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  let body;
  if (!booted || (loading && !info)) {
    body = (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Spinner className="size-6" />
      </div>
    );
  } else if (!path || !info) {
    body = <Welcome onClone={() => setClone(true)} onSignIn={() => setSignIn(true)} />;
  } else {
    body = (
      <div className="flex h-full flex-col">
        <Toolbar onSignIn={() => setSignIn(true)} onSettings={() => setSettingsOpen(true)} />
        {info.state !== 'clean' && (
          <div className="flex shrink-0 items-center gap-3 border-b border-warning/40 bg-warning-soft px-4 py-2">
            <AlertTriangle className="size-4 text-warning" />
            <span className="flex-1">
              <b>{STATE_LABEL[info.state]}.</b>{' '}
              {info.status.conflicted.length > 0
                ? `Resolve ${info.status.conflicted.length} conflicted file(s), stage them, then continue.`
                : 'All conflicts resolved. Continue to finish.'}
            </span>
            <Button size="sm" onClick={() => A.abortOp()}>
              Abort
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={info.status.conflicted.length > 0}
              onClick={() => A.continueOp()}
            >
              Continue
            </Button>
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <aside className="w-64 shrink-0 border-r border-border bg-surface">
            <Sidebar />
          </aside>
          <main className="min-w-0 flex-1">{diff ? <DiffView /> : <CommitGraph />}</main>
          <aside className="w-[360px] shrink-0 border-l border-border bg-surface">
            {selection?.type === 'commit' ? <CommitPanel hash={selection.hash} /> : <WipPanel />}
          </aside>
        </div>
      </div>
    );
  }

  return (
    <>
      {body}
      <GitHubSignIn open={signIn} onClose={() => setSignIn(false)} />
      <CloneDialog
        open={clone}
        onClose={() => setClone(false)}
        onSignIn={() => {
          setClone(false);
          setSignIn(true);
        }}
      />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <PromptDialog />
      <Toasts />
    </>
  );
}

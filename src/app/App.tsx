import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { PromptDialog, Toasts } from '@/components/Overlays';
import { Button, ResizeHandle, Spinner, usePersistentWidth } from '@/components/ui';
import * as A from '@/features/actions';
import { DiffView } from '@/features/diff/DiffView';
import { GitHubSignIn } from '@/features/github/GitHubSignIn';
import { CommitGraph } from '@/features/graph/CommitGraph';
import { CommitPanel } from '@/features/panel/CommitPanel';
import { WipPanel } from '@/features/panel/WipPanel';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { Sidebar } from '@/features/sidebar/Sidebar';
import { StatusBar, applyZoom, useZoom } from '@/features/toolbar/StatusBar';
import { TabBar } from '@/features/toolbar/TabBar';
import { Toolbar } from '@/features/toolbar/Toolbar';
import { CloneDialog } from '@/features/welcome/CloneDialog';
import { Welcome } from '@/features/welcome/Welcome';
import { NewWorkspaceDialog } from '@/features/workspace/WorkspaceDialogs';
import { WorkspaceView } from '@/features/workspace/WorkspaceView';
import { useGitHub } from '@/stores/github';
import { useRepo } from '@/stores/repo';
import { useUi } from '@/stores/ui';
import { useWorkspaces } from '@/stores/workspace';

const STATE_LABEL = {
  merging: 'Merge in progress',
  rebasing: 'Rebase in progress',
  cherryPicking: 'Cherry-pick in progress',
  reverting: 'Revert in progress',
} as const;

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
};

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
  const [zoom, setZoom] = useZoom();
  const [newWs, setNewWs] = useState(false);
  const [sideW, setSideW] = usePersistentWidth('sidebar', 270, 180, 520);
  const [panelW, setPanelW] = usePersistentWidth('panel', 380, 280, 760);
  const ws = useWorkspaces((s) => s.active());

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => applyZoom(zoom), [zoom]);

  useEffect(() => {
    (async () => {
      const repo = useRepo.getState();
      await Promise.all([repo.loadSettings(), useWorkspaces.getState().load()]);
      void useGitHub.getState().check();
      const active = useWorkspaces.getState().data.active;
      if (active) {
        await repo.setScope(active);
        setBooted(true);
        return;
      }
      let last: string | null = null;
      try {
        last = localStorage.getItem('gitstudio.lastRepo');
      } catch {
        /* ignore */
      }
      const target = last ?? repo.tabs[0]?.path;
      if (target) await repo.open(target);
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
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (e.key === 'F5' || (mod && key === 'r')) {
        e.preventDefault();
        void useRepo.getState().refresh();
      } else if (e.key === 'Escape' && useRepo.getState().diff && !useUi.getState().prompt) {
        useRepo.getState().closeDiff();
      } else if (mod && !typing(e) && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        void A.undo();
      } else if (mod && !typing(e) && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        void A.redo();
      } else if (mod && (key === '=' || key === '+')) {
        e.preventDefault();
        setZoom(zoom + 0.1);
      } else if (mod && key === '-') {
        e.preventDefault();
        setZoom(zoom - 0.1);
      } else if (mod && key === '0') {
        e.preventDefault();
        setZoom(1);
      } else if (mod && key === 't') {
        e.preventDefault();
        useRepo.getState().newTab();
      } else if (mod && key === 'w' && useRepo.getState().path) {
        e.preventDefault();
        useRepo.getState().close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom, setZoom]);

  let body;
  if (!booted || (loading && !info)) {
    body = (
      <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
        <Spinner className="size-6" />
      </div>
    );
  } else if ((!path || !info) && ws) {
    body = (
      <div className="min-h-0 flex-1">
        <WorkspaceView onClone={() => setClone(true)} />
      </div>
    );
  } else if (!path || !info) {
    body = (
      <div className="min-h-0 flex-1">
        <Welcome
          onClone={() => setClone(true)}
          onSignIn={() => setSignIn(true)}
          onNewWorkspace={() => setNewWs(true)}
        />
      </div>
    );
  } else {
    body = (
      <>
        <Toolbar />
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
          <aside
            className="relative shrink-0 border-r border-border bg-surface"
            style={{ width: sideW }}
          >
            <Sidebar />
            <ResizeHandle width={sideW} onResize={setSideW} onReset={() => setSideW(270)} />
          </aside>
          <main className="min-w-0 flex-1 bg-background">
            {diff ? <DiffView /> : <CommitGraph />}
          </main>
          <aside
            className="relative shrink-0 border-l border-border bg-surface"
            style={{ width: panelW }}
          >
            <ResizeHandle
              side="left"
              width={panelW}
              onResize={setPanelW}
              onReset={() => setPanelW(380)}
            />
            {selection?.type === 'commit' ? <CommitPanel hash={selection.hash} /> : <WipPanel />}
          </aside>
        </div>
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TabBar
        onSignIn={() => setSignIn(true)}
        onSettings={() => setSettingsOpen(true)}
        onNewWorkspace={() => setNewWs(true)}
      />
      {body}
      <StatusBar zoom={zoom} setZoom={setZoom} />
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
      <NewWorkspaceDialog open={newWs} onClose={() => setNewWs(false)} />
      <PromptDialog />
      <Toasts />
    </div>
  );
}

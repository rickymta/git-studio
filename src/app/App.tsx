import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { PromptDialog, Toasts } from '@/components/Overlays';
import { Button, ResizeHandle, Spinner, usePersistentWidth } from '@/components/ui';
import * as A from '@/features/actions';
import { DiffView } from '@/features/diff/DiffView';
import { GitHubSignIn } from '@/features/github/GitHubSignIn';
import { RemotePanel } from '@/features/remotes/RemotePanel';
import { CommitGraph } from '@/features/graph/CommitGraph';
import { CommitPanel } from '@/features/panel/CommitPanel';
import { ComparePanel } from '@/features/panel/ComparePanel';
import { WipPanel } from '@/features/panel/WipPanel';
import { Preferences, type PrefSection } from '@/features/preferences/Preferences';
import { Sidebar } from '@/features/sidebar/Sidebar';
import { TerminalPanel } from '@/features/terminal/TerminalPanel';
import { toggleTerminal } from '@/features/terminal/runtime';
import { StatusBar, applyZoom, useZoom } from '@/features/toolbar/StatusBar';
import { TabBar } from '@/features/toolbar/TabBar';
import { Toolbar } from '@/features/toolbar/Toolbar';
import { CloneDialog } from '@/features/welcome/CloneDialog';
import { Welcome } from '@/features/welcome/Welcome';
import { NewWorkspaceDialog, ScanDialog } from '@/features/workspace/WorkspaceDialogs';
import { WorkspaceView } from '@/features/workspace/WorkspaceView';
import { logActivity } from '@/stores/activity';
import { useGitHub } from '@/stores/github';
import { ensureGitLabChecked } from '@/stores/gitlab';
import { useRepo } from '@/stores/repo';
import { useTokens } from '@/stores/tokens';
import { useUi } from '@/stores/ui';
import { useWorkspaces } from '@/stores/workspace';
import { t, useLang, useLangStore } from '@/lib/i18n';
import { LanguagePicker } from '@/features/preferences/LanguagePicker';
import { api } from '@/lib/ipc';
import { applyBrightness, useBrightnessStore } from '@/lib/brightness';

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
  const dialog = useUi((s) => s.dialog);
  const openDialog = useUi((s) => s.openDialog);
  const [prefs, setPrefs] = useState<PrefSection | null>(null);
  const [booted, setBooted] = useState(false);
  const [zoom, setZoom] = useZoom();
  const lang = useLang();
  const langChosen = useLangStore((s) => s.chosen);
  const [newWs, setNewWs] = useState(false);
  const [sideW, setSideW] = usePersistentWidth('sidebar', 300, 180, 520);
  const [panelW, setPanelW] = usePersistentWidth('panel', 400, 280, 760);
  const ws = useWorkspaces((s) => s.active());

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => applyZoom(zoom), [zoom]);

  // Token indicator / warning → Preferences → Integrations (the provider is picked there).
  useEffect(
    () =>
      useTokens.subscribe((s, prev) => {
        if (s.openRequest && s.openRequest !== prev.openRequest) setPrefs('integrations');
      }),
    [],
  );

  const brightness = useBrightnessStore((s) => s[theme]);
  useEffect(() => applyBrightness(brightness), [brightness]);

  useEffect(() => {
    (async () => {
      const repo = useRepo.getState();
      await Promise.all([repo.loadSettings(), useWorkspaces.getState().load()]);
      void useGitHub.getState().check();
      // Also reads both tokens' expiry for the status bar (and warns when it is close).
      ensureGitLabChecked();
      // Long paths on by default (Windows), unless the user already chose either way.
      void api
        .ensureGitDefaults()
        .then((keys) => {
          for (const key of keys)
            logActivity({
              repo: null,
              label: 'Turned on {key} in your global Git config',
              vars: { key: `${key}=true` },
              status: 'info',
            });
        })
        .catch(() => {});
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
      const remember = useRepo.getState().settings?.rememberTabs ?? true;
      const target = last ?? repo.tabs[0]?.path;
      if (remember && target) await repo.open(target);
      setBooted(true);
    })();
  }, []);

  // Background fetch of the open repository (Preferences → General → Auto-Fetch Interval).
  const autoFetch = useRepo((s) => s.settings?.autoFetchMinutes ?? 0);
  useEffect(() => {
    if (!autoFetch) return;
    const id = setInterval(async () => {
      const r = useRepo.getState();
      if (!r.path || r.busy || document.visibilityState !== 'visible') return;
      try {
        await api.fetch(r.path);
        await r.refresh();
      } catch {
        // Offline or no remote: stay quiet; manual Fetch shows the error.
      }
    }, autoFetch * 60_000);
    return () => clearInterval(id);
  }, [autoFetch]);

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
      if (mod && e.code === 'Backquote') {
        e.preventDefault();
        toggleTerminal();
      } else if (e.key === 'F5' || (mod && key === 'r')) {
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
  if (prefs) {
    body = (
      <Preferences
        section={prefs}
        onSection={setPrefs}
        onExit={() => setPrefs(null)}
        onSignIn={() => setSignIn(true)}
      />
    );
  } else if (!booted || (loading && !info)) {
    body = (
      <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
        <Spinner className="size-6" />
      </div>
    );
  } else if ((!path || !info) && ws) {
    body = (
      <div className="min-h-0 flex-1">
        <WorkspaceView />
      </div>
    );
  } else if (!path || !info) {
    body = (
      <div className="min-h-0 flex-1">
        <Welcome
          onClone={() => openDialog('clone')}
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
              <b>{t(STATE_LABEL[info.state])}.</b>{' '}
              {info.status.conflicted.length > 0
                ? t('Resolve {n} conflicted file(s), stage them, then continue.', {
                    n: info.status.conflicted.length,
                  })
                : t('All conflicts resolved. Continue to finish.')}
            </span>
            <Button size="sm" onClick={() => A.abortOp()}>
              {t('Abort')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={info.status.conflicted.length > 0}
              onClick={() => A.continueOp()}
            >
              {t('Continue')}
            </Button>
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <aside
            className="relative shrink-0 border-r border-border bg-surface"
            style={{ width: sideW }}
          >
            <Sidebar />
            <ResizeHandle width={sideW} onResize={setSideW} onReset={() => setSideW(300)} />
          </aside>
          <div className="relative flex min-w-0 flex-1 flex-col">
            <main className="min-h-0 min-w-0 flex-1 bg-background">
              {diff ? <DiffView /> : <CommitGraph />}
            </main>
            <TerminalPanel />
            <RemotePanel onSignIn={() => setSignIn(true)} />
          </div>
          <aside
            className="relative shrink-0 border-l border-border bg-surface"
            style={{ width: panelW }}
          >
            <ResizeHandle
              side="left"
              width={panelW}
              onResize={setPanelW}
              onReset={() => setPanelW(400)}
            />
            {selection?.type === 'commit' ? (
              <CommitPanel hash={selection.hash} />
            ) : selection?.type === 'compare' ? (
              <ComparePanel base={selection.base} target={selection.target} />
            ) : (
              <WipPanel />
            )}
          </aside>
        </div>
      </>
    );
  }

  if (!langChosen) {
    return (
      <>
        <LanguagePicker />
        <Toasts />
      </>
    );
  }

  return (
    // Re-keyed on language change so every component re-renders its text.
    <div key={lang} className="flex h-full flex-col">
      <TabBar
        onSignIn={() => setSignIn(true)}
        onSettings={() => setPrefs((p) => (p ? null : 'general'))}
        onNavigate={() => setPrefs(null)}
        prefsOpen={!!prefs}
        onNewWorkspace={() => setNewWs(true)}
      />
      {body}
      <StatusBar zoom={zoom} setZoom={setZoom} />
      <GitHubSignIn open={signIn} onClose={() => setSignIn(false)} />
      <CloneDialog
        open={dialog === 'clone'}
        onClose={() => openDialog(null)}
        onSignIn={() => {
          openDialog(null);
          setSignIn(true);
        }}
      />
      <NewWorkspaceDialog open={newWs} onClose={() => setNewWs(false)} />
      <ScanDialog open={dialog === 'scanWorkspace'} onClose={() => openDialog(null)} />
      <PromptDialog />
      <Toasts />
    </div>
  );
}

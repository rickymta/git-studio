import { AlertTriangle } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';

import { PromptDialog, Toasts } from '@/components/Overlays';
import { Button, ResizeHandle, Spinner } from '@/components/ui';
import { usePersistentWidth } from '@/components/usePersistentWidth';
import * as A from '@/features/actions';
import { BisectBanner } from '@/features/bisect/BisectBanner';
import { DiffView } from '@/features/diff/DiffView';
import { GitHubSignIn } from '@/features/github/GitHubSignIn';
import { LaunchpadView } from '@/features/launchpad/LaunchpadView';
import { ensureOverlaySetup } from '@/features/preferences/overlaySetup';
import { listenLaunchActions, processLaunchActions } from '@/features/launchActions';
import { RemotePanel } from '@/features/remotes/RemotePanel';
import { CommitGraph } from '@/features/graph/CommitGraph';
import { CommitPanel } from '@/features/panel/CommitPanel';
import { ComparePanel } from '@/features/panel/ComparePanel';
import { CleanDialog } from '@/features/panel/CleanDialog';
import { MaintenanceDialog } from '@/features/maintenance/MaintenanceDialog';
import { MultiCommitPanel } from '@/features/panel/MultiCommitPanel';
import { WipPanel } from '@/features/panel/WipPanel';
import { Preferences, type PrefSection } from '@/features/preferences/Preferences';
import { MergePreviewHost } from '@/features/merge/MergePreview';
import { PullMergeDialog } from '@/features/merge/PullMergeDialog';
import { RebaseDialog } from '@/features/rebase/RebaseDialog';
import { Sidebar } from '@/features/sidebar/Sidebar';
import { Spotlight } from '@/features/spotlight/Spotlight';
import { TerminalPanel } from '@/features/terminal/TerminalPanel';
import { toggleTerminal } from '@/features/terminal/runtime';
import { StatusBar } from '@/features/toolbar/StatusBar';
import { applyZoom, useZoom } from '@/features/toolbar/zoom';
import { TabBar } from '@/features/toolbar/TabBar';
import { Toolbar } from '@/features/toolbar/Toolbar';
import { CloneDialog } from '@/features/welcome/CloneDialog';
import { Welcome } from '@/features/welcome/Welcome';
import { NewWorkspaceDialog, ScanDialog } from '@/features/workspace/WorkspaceDialogs';
import { WorkspaceView } from '@/features/workspace/WorkspaceView';
import { logActivity } from '@/stores/activity';
import { useGitHub } from '@/stores/github';
import { ensureGitLabChecked } from '@/stores/gitlab';
import { startLaunchpadPolling, useLaunchpad } from '@/stores/launchpad';
import { useRepo } from '@/stores/repo';
import { useSpotlight } from '@/stores/spotlight';
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

/** How often the open repository is checked for changes made outside the app. */
const CHECK_EVERY_MS = 5000;

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
};

// The big panes read the stores themselves; memo keeps App's own re-renders (a selection, a
// dialog, a diff opening) from re-rendering all of them.
const MemoSidebar = memo(Sidebar);

/** A dragged side's width, straight on its element (no render until the drag ends). */
function setWidth(el: HTMLElement | null, w: number, min: number, max: number) {
  if (el) el.style.width = `${Math.round(Math.min(max, Math.max(min, w)))}px`;
}
const MemoCommitGraph = memo(CommitGraph);
const MemoToolbar = memo(Toolbar);
const MemoTerminalPanel = memo(TerminalPanel);

export function App() {
  const path = useRepo((s) => s.path);
  // Primitives, not the whole `info`: App re-rendering re-renders everything under it, and the
  // status is read again every few seconds.
  const hasInfo = useRepo((s) => !!s.info);
  const opState = useRepo((s) => s.info?.state ?? 'clean');
  const conflicts = useRepo((s) => s.info?.status.conflicted.length ?? 0);
  const loading = useRepo((s) => s.loading);
  const selection = useRepo((s) => s.selection);
  // Whether a diff is open (and the view it was opened in), not the diff itself: it changes twice
  // per file opened (loading, loaded), and App re-rendering re-renders everything under it.
  const hasDiff = useRepo((s) => !!s.diff);
  const diffKey = useRepo((s) => s.diff?.view?.id ?? 0);
  const theme = useUi((s) => s.theme);
  const [signIn, setSignIn] = useState(false);
  const dialog = useUi((s) => s.dialog);
  const openDialog = useUi((s) => s.openDialog);
  const [prefs, setPrefs] = useState<PrefSection | null>(null);
  // Later context-menu launches ("Open with GitStudio").
  useEffect(() => listenLaunchActions(() => setPrefs(null)), []);
  const [booted, setBooted] = useState(false);
  const [zoom, setZoom] = useZoom();
  const lang = useLang();
  const langChosen = useLangStore((s) => s.chosen);
  const [newWs, setNewWs] = useState(false);
  const [sideW, setSideW] = usePersistentWidth('sidebar', 300, 180, 520);
  const [panelW, setPanelW] = usePersistentWidth('panel', 400, 280, 760);
  // Dragging a side resizes its element directly; the width is saved (one render) on release.
  const sideRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const ws = useWorkspaces((s) => s.active());
  const launchpad = useLaunchpad((s) => s.open);

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
      // Folder status icons are on by default: finish their setup on first launch.
      void ensureOverlaySetup();
      // Launched from the file manager's context menu ("Open with GitStudio").
      void processLaunchActions(() => setPrefs(null));
      void useGitHub.getState().check();
      // Also reads both tokens' expiry for the status bar (and warns when it is close).
      ensureGitLabChecked();
      // Launchpad's items (and the badge on its tab) refresh in the background.
      startLaunchpadPolling();
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

  // Pick up changes made outside the app (a merge in a terminal, another Git tool, a fetch).
  // Only the repository on screen is checked, never the other tabs; switching tabs starts the
  // cycle again for the new one (its own load just brought it up to date).
  useEffect(() => {
    if (!path) return;
    // Every visible window, focused or not, checks the change stamp every 5 s: a few file
    // reads, no git process, so a merge shows within seconds. Edited files only show in
    // `git status`, which costs a process: every check in the focused window, every 20 s in
    // the others (several windows each running it every few seconds slowed them all).
    let n = 0;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      n++;
      const status = document.hasFocus() || n % 4 === 0;
      void useRepo.getState().checkChanges({ status });
    };
    const onFocus = () => void useRepo.getState().refreshOnFocus();
    window.addEventListener('focus', onFocus);
    const id = setInterval(tick, CHECK_EVERY_MS);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(id);
    };
  }, [path]);

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
      } else if (mod && e.shiftKey && key === 'k') {
        e.preventDefault();
        setPrefs(null);
        useLaunchpad.getState().setOpen(!useLaunchpad.getState().open);
      } else if (mod && !e.shiftKey && key === 'k' && useRepo.getState().path) {
        // Spotlight over the open repository.
        e.preventDefault();
        useSpotlight.getState().setOpen(!useSpotlight.getState().open);
      } else if (mod && !e.shiftKey && key === 't') {
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
  } else if (launchpad) {
    body = (
      <div className="min-h-0 flex-1">
        <LaunchpadView onSignIn={() => setSignIn(true)} />
      </div>
    );
  } else if (!booted || (loading && !hasInfo)) {
    body = (
      <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
        <Spinner className="size-6" />
      </div>
    );
  } else if ((!path || !hasInfo) && ws) {
    body = (
      <div className="min-h-0 flex-1">
        <WorkspaceView />
      </div>
    );
  } else if (!path || !hasInfo) {
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
        <MemoToolbar />
        {opState !== 'clean' && (
          <div className="flex shrink-0 items-center gap-3 border-b border-warning/40 bg-warning-soft px-4 py-2">
            <AlertTriangle className="size-4 text-warning" />
            <span className="flex-1">
              <b>{t(STATE_LABEL[opState])}.</b>{' '}
              {conflicts > 0
                ? t('Resolve {n} conflicted file(s), stage them, then continue.', {
                    n: conflicts,
                  })
                : t('All conflicts resolved. Continue to finish.')}
            </span>
            <Button size="sm" onClick={() => A.abortOp()}>
              {t('Abort')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={conflicts > 0}
              onClick={() => A.continueOp()}
            >
              {t('Continue')}
            </Button>
          </div>
        )}
        <BisectBanner />
        <div className="flex min-h-0 flex-1">
          <aside
            ref={sideRef}
            className="relative shrink-0 border-r border-border bg-surface"
            style={{ width: sideW }}
          >
            <MemoSidebar />
            <ResizeHandle
              width={sideW}
              onResize={setSideW}
              onLive={(w) => setWidth(sideRef.current, w, 180, 520)}
              onReset={() => setSideW(300)}
            />
          </aside>
          <div className="relative flex min-w-0 flex-1 flex-col">
            <main className="min-h-0 min-w-0 flex-1 bg-background">
              {/* The graph stays mounted under an open diff: closing the diff shows it again
                  as it was (same scroll position) instead of building it again. */}
              <div className={hasDiff ? 'hidden' : 'h-full'}>
                <MemoCommitGraph />
              </div>
              {hasDiff && <DiffView key={diffKey} />}
            </main>
            <MemoTerminalPanel />
            <RemotePanel onSignIn={() => setSignIn(true)} />
          </div>
          <aside
            ref={panelRef}
            className="relative shrink-0 border-l border-border bg-surface"
            style={{ width: panelW }}
          >
            <ResizeHandle
              side="left"
              width={panelW}
              onResize={setPanelW}
              onLive={(w) => setWidth(panelRef.current, w, 280, 760)}
              onReset={() => setPanelW(400)}
            />
            {selection?.type === 'commit' ? (
              <CommitPanel hash={selection.hash} />
            ) : selection?.type === 'compare' ? (
              <ComparePanel base={selection.base} target={selection.target} />
            ) : selection?.type === 'commits' ? (
              <MultiCommitPanel hashes={selection.hashes} />
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
        onNavigate={() => {
          setPrefs(null);
          useLaunchpad.getState().setOpen(false);
        }}
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
      <RebaseDialog />
      <MergePreviewHost />
      <PullMergeDialog />
      <Spotlight />
      <CleanDialog open={dialog === 'clean'} onClose={() => openDialog(null)} />
      <MaintenanceDialog open={dialog === 'maintenance'} onClose={() => openDialog(null)} />
      <PromptDialog />
      <Toasts />
    </div>
  );
}

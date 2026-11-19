// Live terminal sessions: one xterm instance per backend PTY, kept outside React so sessions
// survive the panel being hidden, repository tabs switching and the language re-key in App.
// Output is polled (works in Tauri and in the browser dev bridge).

import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { useRepo } from '@/stores/repo';
import { useTerminal } from '@/stores/terminal';
import { toast } from '@/stores/ui';

import { systemFont } from './font';

interface Live {
  term: Terminal;
  fit: FitAddon;
  /** Element xterm renders into; moved between panel mounts. */
  host: HTMLDivElement;
  opened: boolean;
  stopped: boolean;
  /** Last time the session produced output or received input (ms). */
  lastActivity: number;
  /** Cuts the current poll wait short (after the user types). */
  wake: (() => void) | null;
}

const live = new Map<number, Live>();

const FAST_MS = 40;
const IDLE_MS = 250;
const HIDDEN_MS = 1000;
const ACTIVE_WINDOW_MS = 1500;

// ---- theme ---------------------------------------------------------------------------------------

let ctx: CanvasRenderingContext2D | null = null;

/** Resolves any CSS colour (the tokens are oklch) to rgba(), which xterm understands. */
function toRgba(color: string): string | undefined {
  if (!color) return undefined;
  ctx ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return color;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = '#000';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 255] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

function theme(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => toRgba(css.getPropertyValue(name).trim());
  return {
    background: v('--background'),
    foreground: v('--foreground'),
    cursor: v('--accent'),
    cursorAccent: v('--background'),
    selectionBackground: v('--selection'),
  };
}

let themeWatch: MutationObserver | null = null;

/** Re-themes every terminal when the `.dark` class on <html> flips. */
function watchTheme() {
  if (themeWatch) return;
  themeWatch = new MutationObserver(() => {
    const th = theme();
    for (const l of live.values()) l.term.options.theme = th;
  });
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

// ---- polling -------------------------------------------------------------------------------------

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function isShown(id: number): boolean {
  const st = useTerminal.getState();
  if (!st.visible) return false;
  const s = st.sessions.find((x) => x.id === id);
  return !!s && s.repo === useRepo.getState().path && st.active[s.repo] === id;
}

function delay(id: number, l: Live): number {
  if (!isShown(id)) return HIDDEN_MS;
  return Date.now() - l.lastActivity < ACTIVE_WINDOW_MS ? FAST_MS : IDLE_MS;
}

async function pump(id: number) {
  for (;;) {
    const l = live.get(id);
    if (!l || l.stopped) return;
    const entry: Live = l;
    let exited: boolean;
    try {
      const out = await api.terminalRead(id);
      if (out.data) {
        l.term.write(decode(out.data));
        l.lastActivity = Date.now();
      }
      exited = out.exited;
    } catch {
      // The backend no longer knows the session.
      exited = true;
    }
    if (l.stopped) return;
    if (exited) {
      l.stopped = true;
      l.term.write(`\r\n\x1b[2m${t('[Process exited]')}\x1b[0m\r\n`);
      useTerminal.getState().markExited(id);
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, delay(id, l));
      function done() {
        clearTimeout(timer);
        entry.wake = null;
        resolve();
      }
      l.wake = done;
    });
  }
}

// ---- sessions ------------------------------------------------------------------------------------

const shellName = (shell: string) =>
  shell
    .split(/[\\/]/)
    .pop()!
    .replace(/\.exe$/i, '') || shell;

const isToggleKey = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && e.code === 'Backquote';

export async function openSession(repo: string): Promise<void> {
  const font = systemFont();
  let opened;
  try {
    opened = await api.terminalOpen(repo, 80, 24);
  } catch (e) {
    toast('error', t('Could not start terminal'), (e as Error).message);
    return;
  }
  const { id } = opened;
  watchTheme();
  const term = new Terminal({
    ...(await font),
    cursorBlink: true,
    scrollback: 5000,
    theme: theme(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);

  const host = document.createElement('div');
  host.style.width = '100%';
  host.style.height = '100%';
  // Keep app-wide shortcuts (Ctrl+W, Ctrl+Z, F5, Esc…) from firing while typing in the shell;
  // only the panel toggle reaches the window.
  host.addEventListener('keydown', (e) => {
    if (!isToggleKey(e)) e.stopPropagation();
  });

  term.attachCustomKeyEventHandler((e) => {
    if (isToggleKey(e)) return false;
    if (e.type !== 'keydown') return true;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    // Copy: Ctrl+Shift+C, or Ctrl+C with a selection (otherwise Ctrl+C interrupts).
    if (mod && key === 'c' && (e.shiftKey || term.hasSelection())) {
      void navigator.clipboard.writeText(term.getSelection()).catch(() => {});
      term.clearSelection();
      e.preventDefault();
      return false;
    }
    // Paste: let the browser fire a paste event, which xterm forwards to the shell.
    if (mod && key === 'v') return false;
    return true;
  });

  const l: Live = {
    term,
    fit,
    host,
    opened: false,
    stopped: false,
    lastActivity: Date.now(),
    wake: null,
  };
  live.set(id, l);

  // Everything xterm emits goes to the PTY, including its answers to queries such as ConPTY's
  // cursor-position request (ESC[6n), without which Windows shells don't start.
  term.onData((data) => {
    l.lastActivity = Date.now();
    api.terminalWrite(id, data).catch(() => {});
    l.wake?.();
  });
  term.onResize(({ cols, rows }) => {
    api.terminalResize(id, cols, rows).catch(() => {});
  });

  const st = useTerminal.getState();
  st.add({ id, repo, shell: shellName(opened.shell), exited: false });
  st.setVisible(true);
  void pump(id);
}

export function closeSession(id: number) {
  const l = live.get(id);
  if (l) {
    l.stopped = true;
    l.wake?.();
    l.term.dispose();
    l.host.remove();
    live.delete(id);
  }
  api.terminalClose(id).catch(() => {});
  const st = useTerminal.getState();
  const repo = st.sessions.find((s) => s.id === id)?.repo;
  st.remove(id);
  if (repo && !useTerminal.getState().sessions.some((s) => s.repo === repo)) st.setVisible(false);
}

/** Kills every session of `repo`. */
export function killAll(repo: string) {
  for (const s of useTerminal.getState().sessions) if (s.repo === repo) closeSession(s.id);
}

/** Shows or hides the panel for the current repository, starting a session if it has none. */
export function toggleTerminal() {
  const repo = useRepo.getState().path;
  const st = useTerminal.getState();
  if (!repo) return;
  if (st.visible) {
    st.setVisible(false);
    return;
  }
  if (st.sessions.some((s) => s.repo === repo)) st.setVisible(true);
  else void openSession(repo);
}

/** Mounts session `id` into `container`; returns a cleanup that detaches it again. */
export function attach(id: number, container: HTMLElement): () => void {
  const l = live.get(id);
  if (!l) return () => {};
  container.appendChild(l.host);
  if (!l.opened) {
    l.term.open(l.host);
    l.opened = true;
  }
  const refit = () => {
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      try {
        l.fit.fit();
      } catch {
        /* not measurable yet */
      }
    }
  };
  refit();
  l.term.focus();
  let frame = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(refit);
  });
  ro.observe(container);
  // Speed the poll up right away now that the session is on screen.
  l.wake?.();
  return () => {
    ro.disconnect();
    cancelAnimationFrame(frame);
    if (l.host.parentElement === container) container.removeChild(l.host);
  };
}

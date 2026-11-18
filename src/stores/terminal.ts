import { create } from 'zustand';

export interface TermSession {
  id: number;
  /** Repository path the session was opened in (its cwd). */
  repo: string;
  /** Shell display name, e.g. "pwsh". */
  shell: string;
  exited: boolean;
}

interface TerminalStore {
  /** Whether the bottom terminal panel is shown. Sessions stay alive while it is hidden. */
  visible: boolean;
  sessions: TermSession[];
  /** Active session id per repository path. */
  active: Record<string, number>;
  setVisible: (v: boolean) => void;
  add: (s: TermSession) => void;
  remove: (id: number) => void;
  markExited: (id: number) => void;
  setActive: (repo: string, id: number) => void;
}

export const useTerminal = create<TerminalStore>((set) => ({
  visible: false,
  sessions: [],
  active: {},
  setVisible: (visible) => set({ visible }),
  add: (s) =>
    set((st) => ({ sessions: [...st.sessions, s], active: { ...st.active, [s.repo]: s.id } })),
  remove: (id) =>
    set((st) => {
      const gone = st.sessions.find((s) => s.id === id);
      const sessions = st.sessions.filter((s) => s.id !== id);
      if (!gone || st.active[gone.repo] !== id) return { sessions };
      const idx = st.sessions.filter((s) => s.repo === gone.repo).findIndex((s) => s.id === id);
      const left = sessions.filter((s) => s.repo === gone.repo);
      const active = { ...st.active };
      const next = left[Math.min(idx, left.length - 1)];
      if (next) active[gone.repo] = next.id;
      else delete active[gone.repo];
      return { sessions, active };
    }),
  markExited: (id) =>
    set((st) => ({ sessions: st.sessions.map((s) => (s.id === id ? { ...s, exited: true } : s)) })),
  setActive: (repo, id) => set((st) => ({ active: { ...st.active, [repo]: id } })),
}));

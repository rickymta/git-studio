// Keyboard shortcuts shown in the Keyboard Shortcuts window. English labels are i18n keys.

export interface Shortcut {
  label: string;
  /** Alternatives, each a list of keys pressed together. */
  keys: string[][];
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Repo Actions',
    items: [
      { label: 'Create Branch', keys: [['Ctrl', 'B']] },
      { label: 'Fetch All', keys: [['Ctrl', 'L']] },
      { label: 'Commit (when in message input)', keys: [['Ctrl', 'Enter']] },
      { label: 'Stage All + Commit (when in message input)', keys: [['Ctrl', 'Shift', 'Enter']] },
      { label: 'Stage Current File', keys: [['S']] },
      { label: 'Unstage Current File', keys: [['U']] },
      { label: 'Stage All Files', keys: [['Ctrl', 'Shift', 'S']] },
      { label: 'Unstage All Files', keys: [['Ctrl', 'Shift', 'U']] },
      { label: 'Focus commit message', keys: [['Ctrl', 'Shift', 'M']] },
      { label: 'Undo', keys: [['Ctrl', 'Z']] },
      {
        label: 'Redo',
        keys: [
          ['Ctrl', 'Y'],
          ['Ctrl', 'Shift', 'Z'],
        ],
      },
      { label: 'Open in default terminal', keys: [['Alt', 'T']] },
      { label: 'Toggle in-app terminal', keys: [['Ctrl', '`']] },
    ],
  },
  {
    title: 'Navigation',
    items: [
      { label: 'Select Previous Item', keys: [['↑'], ['K']] },
      { label: 'Select Next Item', keys: [['↓'], ['J']] },
      { label: 'Close diff / dialog', keys: [['Esc']] },
      { label: 'Search commits', keys: [['Ctrl', 'F']] },
      { label: 'Go to HEAD', keys: [['Ctrl', 'Shift', 'H']] },
      { label: 'Filter branches and repositories', keys: [['Ctrl', 'Alt', 'F']] },
    ],
  },
  {
    title: 'Tabs and Window',
    items: [
      { label: 'New tab', keys: [['Ctrl', 'T']] },
      { label: 'Close tab', keys: [['Ctrl', 'W']] },
      { label: 'Refresh', keys: [['F5'], ['Ctrl', 'R']] },
      { label: 'Zoom in', keys: [['Ctrl', '+']] },
      { label: 'Zoom out', keys: [['Ctrl', '-']] },
      { label: 'Reset zoom', keys: [['Ctrl', '0']] },
      { label: 'Keyboard Shortcuts', keys: [['Ctrl', '/']] },
      { label: 'Activity Logs', keys: [['Ctrl', 'Shift', 'L']] },
    ],
  },
];

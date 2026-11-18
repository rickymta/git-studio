import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import { hydrateUiState } from './lib/persist';

// ui-state.json is restored into localStorage before the app (and its stores) load.
async function start() {
  await hydrateUiState();
  const [{ App }, { t }, { toast }, { loadActivity }] = await Promise.all([
    import('./app/App'),
    import('./lib/i18n'),
    import('./stores/ui'),
    import('./stores/activity'),
  ]);
  void loadActivity().then((stats) => {
    if (stats && stats.level !== 'ok')
      toast(
        stats.level === 'full' ? 'error' : 'info',
        t('Activity history is {size} MB', { size: (stats.bytes / 1024 / 1024).toFixed(1) }),
        t('Lower the retention period or clear it in Preferences → Data & History.'),
      );
  });

  // Click handlers are often `async` with no catch; surface their failures instead of
  // letting the button look dead.
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string } | undefined;
    toast('error', t('Something went wrong'), r?.message ?? String(e.reason));
  });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();

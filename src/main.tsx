import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import './index.css';
import { t } from './lib/i18n';
import { toast } from './stores/ui';

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

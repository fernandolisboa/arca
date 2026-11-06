import { createI18n, defaultLocale } from '@arca/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { startAppearance } from './appearance/store.js';
import { Failure, NotFound } from './fallbacks.js';
import { reportCaught, reportUncaught, startMonitoring } from './monitoring.js';
import { recoverOnce } from './pwa/recover.js';
import { registerServiceWorker } from './pwa/register.js';
import { routeTree } from './routeTree.gen.js';
import { sessionQuery } from './api.js';
import { guardVault } from './vault-guard.js';
import './styles.css';

startMonitoring();

// A new version's worker takes over open tabs at once and drops the old files, so a page left
// open across a deploy can no longer load its lazy chunks: load the new version instead. Offline,
// a reload would not bring them back.
window.addEventListener('vite:preloadError', (event) => {
  if (!navigator.onLine) return;
  recoverOnce(
    'chunk',
    () => sessionStorage,
    Date.now(),
    () => {
      event.preventDefault();
      location.reload();
    },
  );
});

const i18n = await createI18n({
  // The e2e suite fails on any console error, so a missing message fails a test.
  onMissingKey: (key) => {
    console.error(`Missing message: ${key}`);
  },
});

const router = createRouter({
  routeTree,
  defaultNotFoundComponent: NotFound,
  defaultErrorComponent: Failure,
  defaultOnCatch: reportCaught,
  // Page changes cross-fade; motion off zeroes the animations in CSS (spec 0006, R6). The first load
  // and same-page updates skip the transition, which would block input while it runs. Browsers
  // without view-transition types transition every load instead.
  defaultViewTransition: {
    types: ({ fromLocation, pathChanged }) =>
      fromLocation !== undefined && pathChanged ? [] : false,
  },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient();
guardVault(window, queryClient, sessionQuery.queryKey);

startAppearance();
document.documentElement.lang = defaultLocale;
document.title = i18n.t('app.name');

const container = document.getElementById('root');
if (container === null) throw new Error('the #root element is missing from index.html');

createRoot(container, { onUncaughtError: reportUncaught }).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  </StrictMode>,
);

registerServiceWorker();

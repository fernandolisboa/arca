import { createI18n, defaultLocale } from '@arca/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { Failure, NotFound } from './fallbacks.js';
import { registerServiceWorker } from './pwa/register.js';
import { routeTree } from './routeTree.gen.js';
import './styles.css';

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
  // Motion off zeroes the view-transition animations in CSS, so the swap is instant (spec 0006, R6).
  defaultViewTransition: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient();

document.documentElement.lang = defaultLocale;
document.title = i18n.t('app.name');

const container = document.getElementById('root');
if (container === null) throw new Error('the #root element is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  </StrictMode>,
);

registerServiceWorker();

import { apiPathSegments, webPathSegments } from '@arca/api-contract/client';
import {
  sentryDataCollection,
  sentryProject,
  sentryScrubbers,
  tunnelPath,
  urlReducer,
} from '@arca/telemetry';
import * as Sentry from '@sentry/react';

/**
 * Errors only, sent to our own origin, which scrubs them again before Sentry sees them (spec 0004,
 * R5). No tracing, replay, console or DOM breadcrumbs: fetch and page changes are the only trail,
 * reduced to route patterns. The server decides whether anything is forwarded, so a local build
 * reports to a tunnel that is not there.
 */
export function startMonitoring(): void {
  if (!import.meta.env.PROD || sentryProject.dsn === null) return;
  const scrub = sentryScrubbers({
    reduce: urlReducer({
      segments: [...apiPathSegments, ...webPathSegments],
      hosts: [window.location.host],
    }),
    tables: [],
  });
  Sentry.init({
    dsn: sentryProject.dsn,
    tunnel: tunnelPath,
    defaultIntegrations: false,
    integrations: [
      Sentry.eventFiltersIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
      Sentry.globalHandlersIntegration(),
      Sentry.breadcrumbsIntegration({
        dom: false,
        xhr: false,
        sentry: false,
        fetch: true,
        history: true,
      }),
    ],
    dataCollection: sentryDataCollection,
    sendClientReports: false,
    beforeSend: (event) => scrub.event(event) as typeof event | null,
    beforeBreadcrumb: (breadcrumb) => scrub.breadcrumb(breadcrumb),
  });
}

/** Reports an error a React or route error boundary caught; a no-op before monitoring starts. */
export const reportCaught = (error: unknown): void => {
  Sentry.captureException(error);
};

const handleUncaught = Sentry.reactErrorHandler((error: unknown) => {
  console.error(error);
});

/** React's handler for an error no boundary caught: reported, then logged as React would. */
export const reportUncaught = (
  error: unknown,
  { componentStack }: { readonly componentStack?: string | undefined },
): void => {
  handleUncaught(error, { componentStack: componentStack ?? null });
};

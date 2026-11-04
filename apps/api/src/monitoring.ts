import { apiPathSegments } from '@arca/api-contract/routes';
import { registry } from '@arca/db/registry';
import { fallbackExclusions } from '@arca/security-policy';
import {
  sentryProject,
  sentryScrubbers,
  urlReducer,
  type SentryEnvironment,
  type SentryProject,
} from '@arca/telemetry';
import * as Sentry from '@sentry/hono/node';
import type { Env, Hono, MiddlewareHandler } from 'hono';
import type { DeploymentEnvironment } from './config.js';

/** The static segments of the paths the API serves outside the contract. */
export const internalPathSegments = [
  ...fallbackExclusions.map((prefix) => prefix.slice(1)),
  'cron',
  'heartbeat',
  'retention',
  'account-erasure',
  'rate-limit-sweep',
  'outbox',
  'monitoring-check',
  'security.txt',
  // The Workflow SDK's routes.
  'workflow',
  'flow',
  'step',
  'webhook',
  'manifest',
] as const;

/**
 * Errors and request traces only. The SDK's defaults would add console breadcrumbs, local
 * variables, source lines, module lists and the AI integrations; none of them is wanted, and the
 * list is pinned by a test (spec 0004 R4, R6).
 */
const integrations = () => [
  Sentry.eventFiltersIntegration(),
  Sentry.linkedErrorsIntegration(),
  Sentry.dedupeIntegration(),
  Sentry.onUncaughtExceptionIntegration(),
  Sentry.onUnhandledRejectionIntegration(),
  Sentry.httpIntegration(),
];

/** SDK 11 collects these by default; every one is off, and the scrubber drops them anyway. */
const noDataCollection: NonNullable<Sentry.NodeOptions['dataCollection']> = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 0,
};

const reportsFrom = (environment: DeploymentEnvironment): environment is SentryEnvironment =>
  Object.hasOwn(sentryProject.tracesSampleRate, environment);

export interface MonitoringSettings {
  readonly environment: DeploymentEnvironment;
  /** The deployment's own origin, the only host a reported URL keeps. */
  readonly origin: string | undefined;
  readonly project?: SentryProject;
}

/** Sentry's options for this deployment, or undefined where nothing is reported. */
export function sentryOptions({
  environment,
  origin,
  project = sentryProject,
}: MonitoringSettings): Sentry.NodeOptions | undefined {
  if (project.dsn === null || !reportsFrom(environment)) return undefined;
  const scrub = sentryScrubbers({
    reduce: urlReducer({
      segments: [...apiPathSegments, ...internalPathSegments],
      hosts: origin === undefined ? [] : [new URL(origin).host],
    }),
    tables: [...registry.entries, ...registry.unowned].map(({ table }) => table),
  });
  return {
    dsn: project.dsn,
    environment,
    tracesSampleRate: project.tracesSampleRate[environment],
    // Whole transactions, so `beforeSendTransaction` scrubs every span before anything leaves.
    traceLifecycle: 'static',
    defaultIntegrations: false,
    integrations: integrations(),
    // No load-time rewriting of third-party modules: none of the listed integrations needs it.
    enableRuntimeChannelInjection: false,
    dataCollection: noDataCollection,
    sendClientReports: false,
    // The scrubbers rebuild each payload from allow-listed fields only, in Sentry's own shapes.
    beforeSend: (event) => scrub.event(event) as typeof event | null,
    beforeSendTransaction: (event) => scrub.event(event) as typeof event | null,
    beforeBreadcrumb: (breadcrumb) => scrub.breadcrumb(breadcrumb),
  };
}

/** Starts Sentry once per instance, before the app is built; a no-op where nothing reports. */
export function startMonitoring(settings: MonitoringSettings): void {
  const options = sentryOptions(settings);
  if (options !== undefined) Sentry.init(options);
}

/** Reports an error the app handled itself; a no-op while Sentry is not started. */
export function reportError(error: unknown, errorCode: string): void {
  Sentry.captureException(error, { tags: { errorCode } });
}

/** The Hono middleware that names each trace by its route pattern and reports 5xx errors. */
export const monitorRequests = <E extends Env>(app: Hono<E>): MiddlewareHandler =>
  Sentry.sentry(app);

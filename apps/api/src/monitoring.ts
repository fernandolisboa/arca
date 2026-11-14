import { apiPathSegments, webPathSegments } from '@arca/api-contract/routes';
import { registry } from '@arca/db/registry';
import { fallbackExclusions } from '@arca/security-policy';
import {
  sentryDataCollection,
  sentryProject,
  sentryScrubbers,
  urlReducer,
  type SentryEnvironment,
  type SentryProject,
} from '@arca/telemetry';
import * as Sentry from '@sentry/hono/node';
import type { Env, Hono, MiddlewareHandler } from 'hono';
import { behindAnswerOf } from './behind-answer.js';
import type { DeploymentEnvironment } from './config.js';
import { createTunnel, type SendToSentry, type Tunnel } from './monitoring-tunnel.js';

/** The static segments of the paths the API serves outside the contract. */
export const internalPathSegments = [
  ...fallbackExclusions.map((prefix) => prefix.slice(1)),
  'cron',
  'heartbeat',
  'retention',
  'account-erasure',
  'rate-limit-sweep',
  'rule-checks',
  'outbox',
  'monitoring-check',
  'monitoring',
  'envelope',
  'csp',
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

const reportsFrom = (environment: DeploymentEnvironment): environment is SentryEnvironment =>
  Object.hasOwn(sentryProject.tracesSampleRate, environment);

/**
 * The path segments and the one host a reported URL may keep; the rest become `:param`. The web
 * app's segments are here too, since its events come through the tunnel.
 */
const urlsFor = (origin: string | undefined) =>
  urlReducer({
    segments: [...apiPathSegments, ...webPathSegments, ...internalPathSegments],
    hosts: origin === undefined ? [] : [new URL(origin).host],
  });

const tables = [...registry.entries, ...registry.unowned].map(({ table }) => table);

export interface MonitoringSettings {
  readonly environment: DeploymentEnvironment;
  /** The deployment's own origin, the only host a reported URL keeps. */
  readonly origin: string | undefined;
  readonly project?: SentryProject;
  /** False samples no traces; errors are still reported. */
  readonly traced?: boolean;
}

/** Sentry's options for this deployment, or undefined where nothing is reported. */
export function sentryOptions({
  environment,
  origin,
  project = sentryProject,
  traced = true,
}: MonitoringSettings): Sentry.NodeOptions | undefined {
  if (project.dsn === null || !reportsFrom(environment)) return undefined;
  const scrub = sentryScrubbers({ reduce: urlsFor(origin), tables });
  return {
    dsn: project.dsn,
    environment,
    tracesSampleRate: traced ? project.tracesSampleRate[environment] : 0,
    // Whole transactions, so `beforeSendTransaction` scrubs every span before anything leaves.
    traceLifecycle: 'static',
    defaultIntegrations: false,
    integrations: integrations(),
    // No load-time rewriting of third-party modules: none of the listed integrations needs it.
    enableRuntimeChannelInjection: false,
    // No tracer provider, so other libraries' OpenTelemetry spans are never recorded.
    enableOpenTelemetrySetup: false,
    dataCollection: sentryDataCollection,
    sendClientReports: false,
    // The scrubbers rebuild each payload from allow-listed fields only, in Sentry's own shapes.
    beforeSend: (event) => scrub.event(event) as typeof event | null,
    beforeSendTransaction: (event) => scrub.event(event) as typeof event | null,
    beforeBreadcrumb: (breadcrumb) => scrub.breadcrumb(breadcrumb),
  };
}

/**
 * Starts Sentry once per instance, before the app is built; a no-op where nothing reports.
 * True when Sentry was started.
 */
export function startMonitoring(settings: MonitoringSettings): boolean {
  // A failing step starts it too, and must not replace the server's client.
  if (Sentry.isInitialized()) return true;
  const options = sentryOptions(settings);
  if (options === undefined) return false;
  Sentry.init(options);
  return true;
}

/** The browser's tunnel to Sentry, where this deployment reports; undefined elsewhere. */
export function tunnelFor({
  environment,
  origin,
  project = sentryProject,
  send,
}: Omit<MonitoringSettings, 'traced'> & { readonly send: SendToSentry }): Tunnel | undefined {
  if (project.dsn === null || !reportsFrom(environment)) return undefined;
  return createTunnel({ dsn: project.dsn, environment, reduce: urlsFor(origin), tables, send });
}

/** Thrown when Sentry does not take a forwarded payload; only its status is kept. */
export class SentryRefused extends Error {
  override name = 'SentryRefused';
}

const forwardTimeoutMs = 5000;

export const sendToSentry: SendToSentry = async (url, body, contentType) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
    signal: AbortSignal.timeout(forwardTimeoutMs),
  });
  await response.body?.cancel();
  if (!response.ok) throw new SentryRefused(String(response.status));
};

const flushMs = 2000;

/**
 * Reports an error the app handled itself and waits for it to be sent, since a serverless
 * instance may freeze once the caller returns; a no-op while Sentry is not started.
 */
export async function reportError(error: unknown, errorCode: string): Promise<void> {
  Sentry.captureException(error, { tags: { errorCode } });
  await Sentry.flush(flushMs);
}

/**
 * After a 5xx, sends what Sentry holds behind the answer, so the instance does not freeze with
 * the error still queued. It runs outside Sentry's middleware, which reports the error on its way
 * out.
 */
const flushAfterServerError: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.res.status < 500) return;
  behindAnswerOf(c.req.raw, () => undefined)(Sentry.flush(flushMs).then(() => undefined));
};

/** Names each trace by its route pattern and reports 5xx errors, in the order they must run. */
export const monitorRequests = <E extends Env>(app: Hono<E>): readonly MiddlewareHandler[] => [
  flushAfterServerError,
  Sentry.sentry(app),
];

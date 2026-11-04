import { apiPathSegments } from '@arca/api-contract/routes';
import { sentryProject, type Logger, type SentryProject } from '@arca/telemetry';
import * as Sentry from '@sentry/hono/node';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { internalPathSegments, monitorRequests, sentryOptions } from '../src/monitoring.js';

const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const project: SentryProject = {
  dsn: 'https://public@o1.ingest.de.sentry.io/2',
  tracesSampleRate: { production: 0.1, preview: 1 },
};
const origin = 'https://arca.example';
// The values SyntheticPersonalDataError carries; none may reach Sentry.
const synthetic = [
  'Maria Aparecida da Silva',
  'maria.silva@example.com',
  '123.456.789-09',
  'FZ123456',
  '91234-5678',
];

describe('Sentry options (spec 0004, R4)', () => {
  it('reports to the repository project, and nowhere while it names no DSN', () => {
    expect(sentryOptions({ environment: 'production', origin })?.dsn).toBe(sentryProject.dsn);
    expect(
      sentryOptions({ environment: 'production', origin, project: { ...project, dsn: null } }),
    ).toBeUndefined();
  });

  it('reports nothing from a development server', () => {
    expect(sentryOptions({ environment: 'development', origin, project })).toBeUndefined();
  });

  it.each([
    ['production', 0.1],
    ['preview', 1],
  ] as const)('samples %s traces at %s, whole transactions only', (environment, rate) => {
    expect(sentryOptions({ environment, origin, project })).toMatchObject({
      dsn: project.dsn,
      environment,
      tracesSampleRate: rate,
      traceLifecycle: 'static',
      sendClientReports: false,
      enableRuntimeChannelInjection: false,
      enableOpenTelemetrySetup: false,
    });
  });

  it('samples no traces when started from a failing step', () => {
    expect(
      sentryOptions({ environment: 'production', origin, project, traced: false })
        ?.tracesSampleRate,
    ).toBe(0);
  });

  it('collects no personal data of its own', () => {
    expect(sentryOptions({ environment: 'production', origin, project })?.dataCollection).toEqual({
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
    });
  });

  it('knows every static segment of the paths the API serves', () => {
    const app = createApp({
      checkDatabase: () => Promise.resolve('ok'),
      logger: silentLogger,
      outbox: () => Promise.resolve([]),
      syntheticError: true,
      cron: {
        readSecret: () => 'x'.repeat(32),
        startHeartbeat: () => Promise.resolve(),
        startRetention: () => Promise.resolve(),
        startDueErasures: () => Promise.resolve(),
        sweepRateLimits: () => Promise.resolve(0),
      },
    });
    const known = new Set([...apiPathSegments, ...internalPathSegments]);
    const served = app.routes
      .flatMap(({ path }) => path.split('/'))
      .filter((segment) => segment !== '' && !segment.startsWith(':') && !segment.includes('*'));
    expect(served.filter((segment) => !known.has(segment))).toEqual([]);
  });
});

// One client per test file: the SDK keeps it globally. The transport records instead of sending.
type Transport = ReturnType<NonNullable<Sentry.NodeOptions['transport']>>;
const envelopes: Parameters<Transport['send']>[0][] = [];
Sentry.init({
  ...sentryOptions({ environment: 'preview', origin, project }),
  transport: () => ({
    send: (envelope) => {
      envelopes.push(envelope);
      return Promise.resolve({});
    },
    flush: () => Promise.resolve(true),
  }),
});
const sentEvents = () =>
  envelopes.flatMap(([, items]) =>
    items.filter(([header]) => header.type === 'event').map(([, payload]) => payload),
  );

describe('Sentry on the server (spec 0004, R4)', () => {
  it('runs only the listed integrations: no AI, console, local variables or source lines', () => {
    expect(
      Sentry.getClient()
        ?.getOptions()
        .integrations.map(({ name }) => name),
    ).toEqual([
      'EventFilters',
      'LinkedErrors',
      'Dedupe',
      'OnUncaughtException',
      'OnUnhandledRejection',
      'Http',
    ]);
  });
});

describe('the preview-only monitoring check (spec 0004, R4)', () => {
  it('is a 404 unless the deployment is a preview, and only a 5xx waits for a flush', async () => {
    const app = createApp({
      checkDatabase: () => Promise.resolve('ok'),
      logger: silentLogger,
      monitor: monitorRequests,
    });
    const behind: Promise<void>[] = [];
    const request = Object.assign(new Request('http://arca.example/internal/monitoring-check'), {
      waitUntil: (work: Promise<void>) => behind.push(work),
    });
    expect((await app.request(request)).status).toBe(404);
    expect(behind).toEqual([]);
  });

  it('reports the synthetic error by class and frames, without its personal data', async () => {
    const app = createApp({
      checkDatabase: () => Promise.resolve('ok'),
      logger: silentLogger,
      monitor: monitorRequests,
      syntheticError: true,
    });

    const behind: Promise<void>[] = [];
    const request = Object.assign(
      new Request('http://arca.example/internal/monitoring-check?cpf=123.456.789-09'),
      { waitUntil: (work: Promise<void>) => behind.push(work) },
    );
    const response = await app.request(request);
    expect(behind).toHaveLength(1);
    await Promise.all(behind);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: 'internal_error' } });
    const events = sentEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      environment: 'preview',
      transaction: 'GET /internal/monitoring-check',
      exception: {
        values: expect.arrayContaining([
          expect.objectContaining({ type: 'SyntheticPersonalDataError' }),
        ]) as unknown,
      },
    });
    const json = JSON.stringify(events);
    expect(synthetic.filter((value) => json.includes(value))).toEqual([]);
  });
});

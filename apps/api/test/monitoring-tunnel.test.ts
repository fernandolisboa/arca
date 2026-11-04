import { cspReportPath } from '@arca/security-policy';
import { tunnelPath, type Logger, type SentryProject } from '@arca/telemetry';
import { describe, expect, it } from 'vitest';
import { createApp, type AuthLimits } from '../src/app.js';
import type { RateLimitRule } from '../src/auth/rate-limit.js';
import { tunnelFor } from '../src/monitoring.js';
import { ingestFor, type SendToSentry } from '../src/monitoring-tunnel.js';
import { noLimits } from './limits.js';

const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const project: SentryProject = {
  dsn: 'https://public@o1.ingest.us.sentry.io/2',
  tracesSampleRate: { production: 0.1, preview: 1 },
};
const dsn = project.dsn ?? '';
const origin = 'https://arca.example';
// Synthetic personal data only; none may reach Sentry.
const synthetic = ['Maria Aparecida da Silva', 'maria.silva@example.com', '123.456.789-09'];
const leaked = (text: string) => synthetic.filter((value) => text.includes(value));

const browserEvent = {
  event_id: '0123456789abcdef0123456789abcdef',
  timestamp: 1_767_000_000,
  level: 'error',
  platform: 'javascript',
  // The browser's claim; the tunnel stamps the server's own environment instead.
  environment: 'production',
  message: synthetic.join(' '),
  exception: {
    values: [
      {
        type: 'TypeError',
        value: `Cannot read ${synthetic[2] ?? ''}`,
        stacktrace: {
          frames: [
            {
              filename: 'https://arca.example/assets/index-B4x9Qe1z.js',
              function: 'onClick',
              lineno: 1,
              colno: 4242,
            },
          ],
        },
      },
    ],
  },
  request: { url: `https://arca.example/v1/health?email=${synthetic[1] ?? ''}` },
  user: { email: synthetic[1] },
};

const envelopeFor = (forDsn: string, event: object = browserEvent) =>
  [
    JSON.stringify({
      event_id: browserEvent.event_id,
      dsn: forDsn,
      sent_at: '2026-11-04T10:00:00Z',
    }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');

const cspReports = [
  {
    type: 'csp-violation',
    age: 3,
    url: `https://arca.example/v1/health?cpf=${synthetic[2] ?? ''}`,
    user_agent: synthetic[0],
    body: {
      documentURL: 'https://arca.example/',
      blockedURL: 'inline',
      effectiveDirective: 'script-src-elem',
      disposition: 'enforce',
      sample: synthetic[1],
      statusCode: 200,
    },
  },
];

interface Sent {
  readonly url: string;
  readonly body: string;
  readonly contentType: string;
}

function recorder() {
  const sent: Sent[] = [];
  const send: SendToSentry = (url, body, contentType) => {
    sent.push({ url, body, contentType });
    return Promise.resolve();
  };
  return { sent, send };
}

/** A limiter that allows `limit` hits per rule and subject, then refuses. */
function countingLimits(limit: number): AuthLimits {
  const hits = new Map<string, number>();
  return {
    clientAddress: () => '192.0.2.1',
    limiter: {
      hit: (rule: RateLimitRule, subject: string) => {
        const key = `${rule.name} ${subject}`;
        const count = (hits.get(key) ?? 0) + 1;
        hits.set(key, count);
        return Promise.resolve(
          count <= limit ? { allowed: true } : { allowed: false, retryAfterSeconds: 60 },
        );
      },
    },
  };
}

function tunnelApp({
  send = recorder().send,
  authLimits = noLimits,
}: { send?: SendToSentry; authLimits?: AuthLimits } = {}) {
  const tunnel = tunnelFor({ environment: 'preview', origin, project, send });
  return createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    authLimits,
    ...(tunnel === undefined ? {} : { tunnel }),
  });
}

/** A request whose work behind the answer is collected, as Nitro's `waitUntil` would run it. */
function post(path: string, body: string, headers: Record<string, string> = { origin }) {
  const behind: Promise<void>[] = [];
  const request = Object.assign(
    new Request(`${origin}${path}`, { method: 'POST', headers, body }),
    {
      waitUntil: (work: Promise<void>) => behind.push(work),
    },
  );
  return { request, behind };
}

describe('Sentry ingest URLs', () => {
  it('names the envelope and security endpoints of the DSN, with its key and environment', () => {
    expect(ingestFor(dsn, 'preview')).toEqual({
      envelope: 'https://o1.ingest.us.sentry.io/api/2/envelope/',
      security:
        'https://o1.ingest.us.sentry.io/api/2/security/?sentry_key=public&sentry_environment=preview',
    });
  });
});

describe('the monitoring tunnel (spec 0004, R5)', () => {
  it('exists only where the deployment reports', () => {
    expect(tunnelFor({ environment: 'development', origin, project, send: recorder().send })).toBe(
      undefined,
    );
    expect(
      tunnelFor({
        environment: 'preview',
        origin,
        project: { ...project, dsn: null },
        send: recorder().send,
      }),
    ).toBeUndefined();
  });

  it('is a 404 without a tunnel', async () => {
    const app = createApp({ checkDatabase: () => Promise.resolve('ok'), logger: silentLogger });
    expect((await app.request(post(tunnelPath, envelopeFor(dsn)).request)).status).toBe(404);
    expect((await app.request(post(cspReportPath, '[]').request)).status).toBe(404);
  });

  it('refuses to start without its rate limits', () => {
    const tunnel = tunnelFor({ environment: 'preview', origin, project, send: recorder().send });
    expect(() =>
      createApp({
        checkDatabase: () => Promise.resolve('ok'),
        logger: silentLogger,
        ...(tunnel === undefined ? {} : { tunnel }),
      }),
    ).toThrow('rate limits');
  });

  it('forwards an envelope for our DSN behind the answer, scrubbed and in the server environment', async () => {
    const { sent, send } = recorder();
    const { request, behind } = post(tunnelPath, envelopeFor(dsn));
    const response = await tunnelApp({ send }).request(request);
    expect(behind).toHaveLength(1);
    await Promise.all(behind);

    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://o1.ingest.us.sentry.io/api/2/envelope/');
    expect(sent[0]?.contentType).toBe('application/x-sentry-envelope');
    const [head, item, event] = (sent[0]?.body ?? '')
      .split('\n')
      .map((line) => JSON.parse(line) as unknown);
    expect(head).toMatchObject({ dsn });
    expect(item).toEqual({ type: 'event' });
    expect(event).toMatchObject({
      environment: 'preview',
      exception: { values: [{ type: 'TypeError' }] },
    });
    expect(leaked(sent[0]?.body ?? '')).toEqual([]);
  });

  it('refuses a foreign DSN and sends nothing', async () => {
    const { sent, send } = recorder();
    const { request, behind } = post(
      tunnelPath,
      envelopeFor('https://public@o9.ingest.sentry.io/9'),
    );
    const response = await tunnelApp({ send }).request(request);
    expect(response.status).toBe(400);
    expect(behind).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('refuses an envelope over 200 KB before reading it', async () => {
    const { sent, send } = recorder();
    const padded = { ...browserEvent, message: 'x'.repeat(200 * 1024) };
    const response = await tunnelApp({ send }).request(
      post(tunnelPath, envelopeFor(dsn, padded)).request,
    );
    expect(response.status).toBe(413);
    expect(sent).toEqual([]);
  });

  it('refuses another site, so the tunnel is not an open relay', async () => {
    const { sent, send } = recorder();
    const response = await tunnelApp({ send }).request(
      post(tunnelPath, envelopeFor(dsn), { origin: 'https://evil.example' }).request,
    );
    expect(response.status).toBe(403);
    expect(sent).toEqual([]);
  });

  it('refuses a burst over the per-IP limit', async () => {
    const { sent, send } = recorder();
    const app = tunnelApp({ send, authLimits: countingLimits(2) });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { request, behind } = post(tunnelPath, envelopeFor(dsn));
      const response = await app.request(request);
      await Promise.all(behind);
      statuses.push(response.status);
      if (response.status === 429) expect(response.headers.get('retry-after')).toBe('60');
    }
    expect(statuses).toEqual([204, 204, 429]);
    expect(sent).toHaveLength(2);
  });

  it('answers at once when Sentry refuses, and logs the failure by class only', async () => {
    const logged: unknown[] = [];
    const tunnel = tunnelFor({
      environment: 'preview',
      origin,
      project,
      send: () => Promise.reject(new Error(synthetic[0])),
    });
    const app = createApp({
      checkDatabase: () => Promise.resolve('ok'),
      logger: { info: () => undefined, error: (entry) => logged.push(entry) },
      origin,
      authLimits: noLimits,
      ...(tunnel === undefined ? {} : { tunnel }),
    });
    const { request, behind } = post(tunnelPath, envelopeFor(dsn));
    expect((await app.request(request)).status).toBe(204);
    await Promise.all(behind);
    expect(logged).toEqual([{ route: tunnelPath, errorName: 'Error' }]);
  });
});

describe('the CSP report path (spec 0004, R5)', () => {
  it('forwards violation reports to the security endpoint, scrubbed', async () => {
    const { sent, send } = recorder();
    // The Reporting API sends no Origin header.
    const { request, behind } = post(cspReportPath, JSON.stringify(cspReports), {
      'content-type': 'application/reports+json',
    });
    const response = await tunnelApp({ send }).request(request);
    expect(behind).toHaveLength(1);
    await Promise.all(behind);

    expect(response.status).toBe(204);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(ingestFor(dsn, 'preview').security);
    expect(sent[0]?.contentType).toBe('application/reports+json');
    expect(JSON.parse(sent[0]?.body ?? '')).toEqual([
      {
        type: 'csp-violation',
        age: 3,
        url: 'https://arca.example/v1/health',
        body: {
          documentURL: 'https://arca.example/',
          blockedURL: 'inline',
          effectiveDirective: 'script-src-elem',
          disposition: 'enforce',
          statusCode: 200,
        },
      },
    ]);
  });

  it.each([
    ['not JSON', 'not json'],
    ['no violation', JSON.stringify([{ type: 'deprecation', body: {} }])],
  ])('refuses a payload with %s', async (_, body) => {
    const { sent, send } = recorder();
    const response = await tunnelApp({ send }).request(post(cspReportPath, body, {}).request);
    expect(response.status).toBe(400);
    expect(sent).toEqual([]);
  });

  it('refuses a payload over 64 KB', async () => {
    const response = await tunnelApp().request(
      post(cspReportPath, JSON.stringify(['x'.repeat(64 * 1024)]), {}).request,
    );
    expect(response.status).toBe(413);
  });
});

import {
  cspScrubber,
  scrubEnvelope,
  sentryScrubbers,
  type SentryEnvironment,
  type UrlReducer,
} from '@arca/telemetry';

/** Posts one payload to Sentry; rejects when Sentry does not take it. */
export type SendToSentry = (url: string, body: string, contentType: string) => Promise<void>;

export interface TunnelSettings {
  /** The one DSN the tunnel forwards for. */
  readonly dsn: string;
  /** The server's own environment, stamped on every event: the browser's claim is not trusted. */
  readonly environment: SentryEnvironment;
  readonly reduce: UrlReducer;
  readonly tables: readonly string[];
  readonly send: SendToSentry;
}

/**
 * The browser's way to Sentry through our origin (spec 0004, R5). Each method scrubs a payload
 * again and starts forwarding it, or answers null when nothing in it may be forwarded.
 */
export interface Tunnel {
  envelope(body: string): Promise<void> | null;
  cspReports(payload: unknown): Promise<void> | null;
}

/** Sentry's ingest URLs for a DSN: the envelope endpoint and the security-report endpoint. */
export function ingestFor(dsn: string, environment: SentryEnvironment) {
  const { protocol, host, username, pathname } = new URL(dsn);
  const project = pathname.split('/').at(-1);
  const base = `${protocol}//${host}/api/${project ?? ''}`;
  const query = new URLSearchParams({ sentry_key: username, sentry_environment: environment });
  return { envelope: `${base}/envelope/`, security: `${base}/security/?${query.toString()}` };
}

export function createTunnel({ dsn, environment, reduce, tables, send }: TunnelSettings): Tunnel {
  const ingest = ingestFor(dsn, environment);
  const scrub = sentryScrubbers({ reduce, tables });
  const reports = cspScrubber(reduce);
  const event = (value: unknown) => {
    const scrubbed = scrub.event(value);
    return scrubbed === null ? null : { ...scrubbed, environment };
  };
  return {
    envelope(body) {
      const forwarded = scrubEnvelope(body, { dsn, event });
      return forwarded === null
        ? null
        : send(ingest.envelope, forwarded, 'application/x-sentry-envelope');
    },
    cspReports(payload) {
      const kept = reports(payload);
      return kept.length === 0
        ? null
        : send(ingest.security, JSON.stringify(kept), 'application/reports+json');
    },
  };
}

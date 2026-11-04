/**
 * The one Sentry project for the API and the web app (spec 0004 R4), changed only by a reviewed
 * pull request. The DSN is public: it lets a client send events, nothing more. While it is null,
 * nothing is sent. Only the environments listed here report, each at its own trace sample rate.
 */
export interface SentryProject {
  readonly dsn: string | null;
  readonly tracesSampleRate: Readonly<Record<'production' | 'preview', number>>;
}

export const sentryProject: SentryProject = {
  dsn: 'https://194e482c567260d542e3d01929877db7@o4511552692748288.ingest.us.sentry.io/4512374606921729',
  tracesSampleRate: { production: 0.1, preview: 1 },
};

export type SentryEnvironment = keyof SentryProject['tracesSampleRate'];

export const sentryEnvironments = Object.keys(
  sentryProject.tracesSampleRate,
) as readonly SentryEnvironment[];

/** Where the web app sends its Sentry envelopes: our own origin, never Sentry's (spec 0004, R5). */
export const tunnelPath = '/internal/monitoring/envelope';

/**
 * What Sentry's SDKs may collect on their own: nothing. SDK 11 collects most of it by default;
 * the scrubbers would drop it anyway (spec 0004, R4, R5).
 */
export const sentryDataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [] as never[],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 0,
};

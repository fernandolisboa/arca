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
  dsn: null,
  tracesSampleRate: { production: 0.1, preview: 1 },
};

export type SentryEnvironment = keyof SentryProject['tracesSampleRate'];

export const sentryEnvironments = Object.keys(
  sentryProject.tracesSampleRate,
) as readonly SentryEnvironment[];

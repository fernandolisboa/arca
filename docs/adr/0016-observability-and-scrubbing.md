# ADR-0016: Observability: Sentry in the EU through our own origin, one scrubber, Langfuse with the first model call

- Status: Accepted
- Date: 2026-11-02
- Amends: [ADR-0010](0010-stack-revised.md) (errors and traces, LLM tracing)
- Spec: [0004 real-data readiness](../specs/0004-real-data-readiness.md)

## Context

ADR-0010 chose Sentry for errors and OpenTelemetry traces, structured JSON logs, and Langfuse for LLM tracing, all with personal data scrubbing, "on from the first deploy" (ROADMAP). Spec 0001 shipped the allow-list logger and left the vendors for this slice. Open points:

- The CSP is `connect-src 'self'` and the app loads no third-party scripts. A browser SDK that posts to `sentry.io` would need the CSP widened, and ad blockers drop those requests.
- Sentry has no Brazilian region. Its organizations store data in the United States or in Germany ([Sentry changelog](https://sentry.io/changelog/data-storage-location-in-germany-is-generally-available/), checked 2026-11-02); the region is chosen when the organization is created, so it has to be right the first time.
- Langfuse exists to trace model calls. No model call exists until the consultancy core's intake.
- Scrubbing written separately for logs, Sentry and Langfuse would drift.

Facts checked on 2026-11-02:

- Sentry's German data storage location is generally available to every organization, the free Developer plan included, at the same price ([Sentry changelog](https://sentry.io/changelog/data-storage-location-in-germany-is-generally-available/)).
- Sentry's JavaScript SDK 11.10.0 adds a managed tunnel: `tunnel: true` in the browser SDK and a server handler (`serveTunnelIntegration()` for Nitro, or `handleTunnelRequestIfMatched`), with an `allowedDsns` option ([Sentry changelog](https://sentry.io/changelog/javascript-sdk-11100-managed-tunnel-clairic/)). `@sentry/node`, `@sentry/react` and `@sentry/hono` are at 11.10.0 (npm registry).
- The Developer plan keeps errors, spans and logs for 30 days ([Sentry: data retention periods](https://docs.sentry.io/security-legal-pii/security/data-retention-periods)).

## Decision

### One scrubber

- A small `packages/telemetry` holds the scrubbing rules every exporter uses: the structured logger, the Sentry `beforeSend`, `beforeSendTransaction` and `beforeBreadcrumb` hooks on server and client, the tunnel, and later the Langfuse masking function.
- The rules are allow-lists, as the logger's already are: an event keeps the fields the scrubber names, each checked for its expected shape, and loses everything else. Exception messages are dropped (the class name and our error code stay); URLs are reduced to route patterns; request bodies, cookies, headers other than an allow-list, query strings, local variables, user objects and IP addresses never leave. Stack frames keep file, function and line, each shape- and length-checked (path-like file names, identifier-like function names); anything else is truncated or dropped, so attacker-supplied events cannot carry free text through those fields either.
- A table-driven test suite feeds synthetic personal data (names, emails, CPF and passport-shaped numbers, addresses, free text) through every exporter path and asserts none of it survives.

### Sentry

- One Sentry organization, created by the owner in the **German** data region (amended 2026-11-04: the owner's existing organization, in the United States; see the amendment below), free Developer plan, owner account with a passkey. EU storage is the closest region to Brazil with a strong data-protection regime; the data-flow register records it.
- Server: the Sentry Node SDK with the Hono integration, errors and OpenTelemetry traces. `sendDefaultPii: false`, local variables off, profiling off. Traces sampled at 10% in production and 100% in previews. Span names use route patterns and generic workflow step names; database spans carry the operation and table name only; statement text is dropped. The only identifiers telemetry admits are the request ID, trace ID, release and environment: never account, case, document or session IDs. Telemetry holds no direct identifiers; it is pseudonymous only through our own audit log, which records the request ID, for Sentry's 30-day retention, so deletion has nothing to remove at Sentry.
- Client: the Sentry React SDK, bundled (no CDN script), errors only, **no session replay ever**, console breadcrumbs off, fetch breadcrumbs reduced to route patterns.
- **Browser events go through our own origin**: the managed tunnel, served by a Hono route in the API (not a Nitro integration, so the app stays testable without Nitro), accepts only our DSN, caps the envelope size, is rate-limited, and runs the scrubber again before forwarding. The CSP keeps `connect-src 'self'`. The tunnel path is excluded from the SPA fallback.
- CSP and Trusted Types violation reports (`report-to`) go to a second path on the same route, which validates the Reporting API payload against its own allow-list and forwards it to Sentry's security-report endpoint, so policy breaks show up in Sentry.
- The DSN is public by design (it ships in the bundle) and lives in a repository configuration file. The source-map upload token is a Sensitive Vercel variable for Production, on the lint list of variables only build scripts may read; source maps are uploaded and then deleted from the output, never served.
- Environments: `production` and `preview`; the release is the commit SHA.
- Alerts: Sentry emails the owner on a new issue and on a regression.
- **Residual, accepted:** the tunnel and the public DSN are unauthenticated ways to put events into Sentry; the DSN path skips the tunnel's limits. Sentry's per-key rate limit is set on the project, and the worst case is exhausted quota on the free plan during an attack, which the alert rule reports. For events sent through the tunnel, the fields that survive the allow-list are shape- and length-checked; events posted straight to the DSN skip our scrub entirely and may carry any text. Agent tooling that reads Sentry issues therefore uses a read-only token scoped to the one project, wraps issue content as delimited untrusted data, never instructions, and ships with an evaluation case that injects instructions through issue fields. CSP violation reports have their own allow-list case in the scrubber, and the scrubber suite has an adversarial case with instruction-like text in frames and report fields.
- Sentry also receives source maps from production builds; the data-flow register says so.

### Logs

- The allow-list logger stays the only logger. It gains the trace ID as an allowed field, so a log line can be matched to its Sentry trace. Vercel's runtime logs are the sink; no log drain.

### Langfuse

- Langfuse arrives with the first model call (consultancy core, intake), not before. Requirements fixed now: Langfuse Cloud in its EU region; the masking function from `packages/telemetry`, which exports no prompt or completion text at all: prompt version and hash, input and output lengths, token counts, model, latency, scores and error codes, plus only allow-listed, shape-checked fields; traces carry an ID generated per call on a new root trace that inherits no active (Sentry) trace context, never the request ID and never account, case or document IDs, so nothing in Langfuse links to a person, even through the audit log, and deletion needs no step there; a retention period is set at adoption and recorded in RETENTION.md; the data-flow register updated in the same change.
- The Sentry Node SDK's AI integrations are off, by an explicit integration list asserted by a test (not by a record-inputs option whose name can change), and span attributes are allow-listed in `beforeSendTransaction`, so the first model call cannot leak prompts through traces before Langfuse exists. The scrubber suite gets a model-call span case.

### Amendment, 2026-11-04: a smaller server setup

Made with the server ticket (#67), to keep the owner's part to one visit to Sentry's site.

- The owner creates the organization and its one project in Sentry's interface, keeps the default alert (email on a new issue), and hands over the public DSN. No setup token, so no agent holds write access to Sentry.
- The project lives in the owner's existing organization, whose data region is the **United States**, not Germany: the owner chose not to run a second organization. Since every event is scrubbed of personal data and identifiers before it leaves (above), the region holds no family data either way; the data-flow register and RETENTION.md say United States.
- No source maps are uploaded: the API's stack frames name its bundled server file, which is enough for a one-family app. There is no upload token, and Sentry's build tooling (`@sentry/bundler-plugins` and the Sentry CLI under FSL-1.1-Apache-2.0) is removed from the dependency tree by a pnpm override, since only the SDK's bundler entry points use it.
- No agent tooling reads Sentry issues yet; the owner reads them. The read-only token, the delimited untrusted wrapping and the evaluation case come with that tooling, if it is ever built.
- SDK 11 replaced `sendDefaultPii` with `dataCollection`, whose defaults collect headers, cookies, bodies and query strings; every field is turned off. Transactions are sent whole (`traceLifecycle: 'static'`) so `beforeSendTransaction` scrubs every span, and the SDK's load-time module rewriting is off. Database spans are not recorded, since no database integration is listed, and neither are the OpenTelemetry spans of other libraries (Better Auth, the Workflow SDK), since no tracer provider is registered.
- Workflow steps report their errors (class, frames and the step's error code). The server module starts Sentry when an instance loads it, so step requests are traced under the workflow routes' generic paths; a failing step also starts it, with tracing off, in case it runs where the server module has not loaded. Every report waits for its send, behind the answer for a 5xx and before a failing step rethrows, so a frozen instance does not lose it.

## Alternatives

| Option | Why not |
| --- | --- |
| Sentry in the United States | Same price; the German region keeps telemetry under GDPR, the regime closest to the LGPD. Chosen after all by the 2026-11-04 amendment, so the owner keeps one organization; events carry no personal data |
| Browser SDK posting to Sentry directly | Widens the CSP, loses events to ad blockers, and skips our second scrub |
| Self-hosted Sentry or GlitchTip in São Paulo | Another system to run, patch and back up for a one-family app |
| Vercel Observability only | No error grouping or alerting comparable to Sentry, and logs on Pro are kept for a short window |
| Langfuse from the first deploy | Nothing to trace yet; an unused vendor account is setup work with no value (YAGNI) |

## Consequences

- The owner creates the Sentry project once in an existing organization and hands over the DSN; an agent does the rest.
- Errors and traces leave Brazil, scrubbed, and are kept 30 days.
- The tunnel is a public endpoint that relays to a third party; its DSN allow-list, size cap, rate limit and scrub are security-critical.
- Every new data shape that could reach telemetry needs a scrubber case.

## Sources

- [Sentry changelog: data storage location in Germany is generally available](https://sentry.io/changelog/data-storage-location-in-germany-is-generally-available/) (checked 2026-11-02)
- [Sentry changelog: JavaScript SDK 11.10.0 managed tunnel](https://sentry.io/changelog/javascript-sdk-11100-managed-tunnel-clairic/) (checked 2026-11-02)
- [Sentry: data retention periods](https://docs.sentry.io/security-legal-pii/security/data-retention-periods) (checked 2026-11-02)
- npm registry: `@sentry/node`, `@sentry/react`, `@sentry/hono` 11.10.0 (checked 2026-11-02)

# Spec 0004: Real-data readiness

- Status: Ready for tickets
- Date: 2026-11-02
- Epic: cross-platform foundations ([ROADMAP.md](../ROADMAP.md#phase-1--family-mvp-web)), after [spec 0001](0001-foundations-scaffold.md)
- Decisions: [ADR-0017](../adr/0017-data-lifecycle-and-backups.md), [ADR-0016](../adr/0016-observability-and-scrubbing.md), [ADR-0012](../adr/0012-automation-first-setup.md), [ADR-0008](../adr/0008-database-security-and-environments.md), [ADR-0009](../adr/0009-background-jobs-guarantees.md); uses [spec 0003](0003-identity-and-access.md) for step-up and the audit log

## Goal

Everything SECURITY.md and ROADMAP.md require before the first real family data enters production: previews provably separate from production, a synthetic seed, error and trace reporting that cannot carry personal data, deletion and export that cover every table, retention enforced, an incident runbook, off-vendor backups, and the epic's threat model. It ends with a **real-data gate**: a checklist that must be complete before production accepts family data.

## Scope

**In:** the `development` branch and the lineage check; the synthetic seed; `packages/telemetry` and its scrubber; Sentry on server and client through our tunnel; the personal-data registry and its guard; export; account deletion; retention jobs; the incident response runbook and `security.txt`; off-vendor backups; the threat model for the epic; the real-data gate.

**Out:** Langfuse wiring (with the first model call, R6 records its requirements); the vault and field encryption (spec 0005); the designated-adult recovery factor and case-model registry entries (consultancy core).

**No case data.** Seed and tests are synthetic. Nothing here reads real data, except the backup job in production, which copies production rows into our own KMS-encrypted bucket in São Paulo.

## Requirements

### R1. Previews fork from `development`, and the build proves it

- **Owner, once, before the R1 change merges:** in the Neon console (Vercel › Storage › `arca` › Open in Neon), create branch `development` from `production`, then set it as the default branch. The production branch setting stays `production`. The ticket gives the exact clicks and links in one message.
- The production build writes a lineage mark (`"lineage": "production"`) into the database comment, alongside the endpoint mark of spec 0001 R9, in the bootstrap transaction. A preview build that finds the production lineage mark fails before migrations, with an error code that names the cause.
- Tests in `tooling/scripts` cover: a preview database with the mark fails; without it passes; production writes it idempotently.
- After merge, the first preview of any later pull request is the end-to-end proof; the ticket records it.

### R2. Synthetic seed

- `packages/db/seed/` holds synthetic data as typed fixtures with fixed UUIDs, and a seed command in `tooling/scripts` that applies them idempotently after migrations, in preview builds and in CI. The production build never runs it, checked by the database target of spec 0001 R9.
- The seed writes through the runtime roles (`app_auth` for accounts, `app_api` under each synthetic account's identity for case data later), so row-level security applies to the seed as to the app.
- Accounts use addresses at `example.com`. Each slice that adds tables adds seed data for them.

### R3. One scrubber

- New package `packages/telemetry`, with no workspace dependencies, usable from `apps/api` and `apps/web` (boundary matrix updated). It exports the field allow-lists and the scrub functions that every exporter uses: the existing logger (moved or re-exported, not duplicated), Sentry's hooks on server and client, the tunnel, and later Langfuse's masking function.
- Rules (ADR-0016): allow-listed fields with shape checks; exception messages dropped (class name and error code kept); URLs reduced to route patterns; no bodies, cookies, query strings, local variables, user objects or IP addresses; allow-listed headers only.
- A table-driven suite pushes synthetic personal data (names, emails, CPF-, RG- and passport-shaped values, phone numbers, addresses, free text) through every exporter path and asserts none survives.
- The logger gains `traceId` as an allowed field.

### R4. Sentry on the server

- `@sentry/node` with the Hono integration (11.x), initialized before the app, with `sendDefaultPii: false`, local variables off, profiling off, `beforeSend`, `beforeSendTransaction` and `beforeBreadcrumb` from `packages/telemetry`. Traces sampled at 10% in production and 100% in previews; spans named by route pattern; workflow steps traced under their generic names.
- The DSN and the environment names live in a repository configuration file. The source-map upload token is a Sensitive Vercel variable (`SENTRY_AUTH_TOKEN`, Production and Preview) read only by the build; source maps are uploaded and deleted from the output.
- **Owner, once:** create the Sentry organization in the German data region on the free Developer plan, with a passkey on the account; give the agent an organization token for setup. The agent creates the project, alert rules (new issue, regression, email to the owner) and the upload token through Sentry's API, and the Vercel variable after the owner's OK.
- A test endpoint that exists only in previews throws a synthetic error carrying synthetic personal data; the ticket shows the resulting Sentry event without it.

### R5. Sentry in the browser, through our origin

- `@sentry/react`, bundled, errors only; no session replay, no console breadcrumbs; fetch breadcrumbs reduced to route patterns; the same scrub hooks.
- `tunnel: true`; the API serves the tunnel, accepts only our DSN (`allowedDsns`), caps the envelope at 200 KB, rate-limits per IP, and scrubs again before forwarding. The tunnel path is excluded from the SPA fallback in `tooling/security-policy` and answers `Cache-Control: no-store`.
- CSP and Trusted Types violation reports (`report-to` and `Reporting-Endpoints`) go to the same tunnel. The CSP keeps `connect-src 'self'`.
- Playwright: an error in the web app reaches the tunnel, and no request leaves the origin.

### R6. Langfuse, when the first model call lands

Recorded here so the requirement is not lost; implemented by the consultancy core's first AI adapter.

- Langfuse Cloud, EU region; the masking function from `packages/telemetry` exports metadata, scores, token counts and redacted text only; prompts referenced by version; the data-flow table and RETENTION.md updated in the same change.

### R7. Personal-data registry

- `packages/db/src/registry.ts`: for each table in a user schema, an entry (owner column, erase strategy `delete` or `detach`, export projection, an i18n label key for the export) or a place on the "no personal data" list with a reason.
- A guard test reads `pg_catalog` after migrations and fails on any table in neither list, and on any registry entry for a table that does not exist. It runs in the `db` CI check.
- Initial entries: the `auth` tables and `audit.event` (spec 0003).

### R8. Export

- `POST /v1/account/export`, after a `data_export` step-up, returns one JSON document with `Content-Disposition: attachment` and `Cache-Control: no-store`: a schema version, the export time, and every registry entry the account owns, through each entry's projection. The response schema is in `packages/api-contract`.
- Built per request, never stored, logged or traced beyond the allow-listed fields. An audit event records it.

### R9. Account deletion

- `POST /v1/account/deletion` after an `account_deletion` step-up: revokes every session, marks the account `pending_deletion` with a due time 7 days ahead, and sends notices. While pending, sign-in shows only "cancel deletion" (`DELETE /v1/account/deletion`, which needs a fresh step-up).
- A daily workflow finds due accounts and starts `eraseAccount(accountId)` for each (identifiers only, through the shared start helper). Its steps, each idempotent: erase every registry entry the account owns (as `app_jobs` under the account's identity); erase the auth rows (as `app_auth`); write an `account_erased` audit event. Vault cleanup joins with spec 0005.
- `app_jobs` gains exactly the privileges the registry needs, through migrations reviewed by the data-access reviewer.
- Tests: a synthetic account with rows in every registered table is fully erased; the audit trail remains with identifiers only; a cancel inside the window keeps everything; running the workflow twice is harmless.

### R10. Retention jobs

- One daily workflow, `enforceRetention(runDate)`, runs every database rule in [RETENTION.md](../RETENTION.md): expired sessions, invites, step-up challenges, rate-limit rows, the non-production outbox, and the inactivity notice and deletion (3 years plus 60 days).
- A test seeds rows on both sides of each boundary and asserts which remain. A docs test fails if RETENTION.md lists a database rule with no job, or the job enforces one the document does not list.

### R11. Incident response

- `docs/runbooks/incident-response.md`: severity levels; who does what (the owner is controller and incident lead; agents assist); a first-hour checklist; containment steps with links and exact actions:
  - block the API at the edge with a Vercel Firewall deny rule on `/v1/*` (instant, no deploy);
  - roll back with Vercel Instant Rollback;
  - revoke every session by rotating `BETTER_AUTH_SECRET` and redeploying;
  - rotate each secret in the data-flow table and the Vercel and GitHub variables, with where and how;
  - stop crons;
  - restore the database with Neon point-in-time restore, or from the backup (R12).
- Evidence to keep, and where. Notification: under Resolução CD/ANPD 15/2024, the ANPD and affected people within 3 business days of learning that an incident affected personal data, with the official form's link and a pt-BR template for each notice. A post-incident review template.
- The quarterly restore drill (R12) and a yearly tabletop exercise, each with a results log in `docs/runbooks/drills.md`.
- `/.well-known/security.txt` served by the API, with the repository's private vulnerability reporting URL as `Contact`, `Expires` one year ahead, `Preferred-Languages: pt-BR, en`; a test fails 30 days before it expires.

### R12. Off-vendor backups

- `bootstrap.sql` creates `app_backup` (`NOBYPASSRLS`, `SELECT` only), with its password from `ARCA_DB_BACKUP_PASSWORD` (Production). Guard 3 adds it to the login roles; a new guard 10 fails on any row-level-security table without a `FOR SELECT TO app_backup USING (true)` policy, and on any policy naming `app_backup` that is not exactly that.
- `infra/aws/backup-account.yaml`, a CloudFormation template the owner launches once in a new AWS account dedicated to backups, in `sa-east-1`: the IAM identity provider for Vercel's OIDC issuer; a writer role trusting only `owner:<team>:project:arca:environment:production`, allowed `s3:PutObject` on the bucket and `kms:GenerateDataKey` on the key; a restore role for the owner with MFA; a customer-managed KMS key; the bucket with versioning, Object Lock (compliance, 35 days), default SSE-KMS, public access blocked, TLS required, and a lifecycle rule expiring objects after 35 days. The ticket gives the owner a quick-create link and one message of steps.
- A daily production cron starts `backupDatabase(runDate)`. Its step: `REPEATABLE READ, READ ONLY` transaction as `app_backup`; for each table in dependency order, `COPY … TO STDOUT` streamed to S3 multipart upload; then a manifest (migration journal head, tables, row counts, SHA-256 per object). AWS credentials come from Vercel OIDC; no static keys.
- Failure alerts through Sentry. The ticket proves one run in production and records the first restore drill in `docs/runbooks/drills.md`.

### R13. Threat model and the real-data gate

- `docs/threat-models/foundations.md`: STRIDE plus the LLM and agentic risks for the whole foundations epic (specs 0001, 0003, 0004, 0005), assets, trust boundaries and data flows, each threat mapped to its control and test, and the accepted residuals with the ADR that accepts them.
- **Real-data gate**, kept as a checklist in the epic issue and in `docs/runbooks/real-data-gate.md`. Production accepts family data only when all are true:
  1. Previews fork from `development`, proven by R1.
  2. Spec 0003 is done in production on the production domain, including recovery.
  3. Sentry reports from server and client, scrubbed (R3 to R5).
  4. Registry guard, export and deletion work (R7 to R9).
  5. Retention jobs run (R10).
  6. Runbook written and one tabletop done (R11).
  7. Backups run daily and one restore drill passed (R12).
  8. The threat model is written and reviewed (R13).
  9. The access-matrix suite covers every table with case data.

## Threat model for this slice

| Threat | Where | Control |
| --- | --- | --- |
| Information disclosure: production data in a preview | Neon branches | `development` default; production lineage mark fails any preview forked from production |
| Information disclosure: personal data in telemetry | Sentry, logs | One allow-list scrubber, applied twice for browser events; no replay; tests with synthetic personal data |
| Tampering: the tunnel used as an open relay | API | Our DSN only, size cap, rate limit, scrub |
| Elevation: deletion or export by someone holding a session | Account | Purpose-bound step-up; 7-day locked window with cancel; notices |
| Repudiation, and incomplete deletion | Registry | Guard fails on unregistered tables; audit events with identifiers only |
| Loss of data | Database | Neon point-in-time restore; daily off-vendor copy under Object Lock; quarterly drill |
| Information disclosure: backup read by a compromised API | Backups | Writer role cannot read, decrypt or delete; restore role outside Vercel with MFA |
| Elevation: `app_backup` misused | Database | `SELECT` only; Production-only password; policy shape guarded |
| Slow response to an incident | Operations | Runbook with exact steps; ANPD deadline and templates; drills |

## Definition of done

- Every requirement is covered by a test or a recorded proof (R1, R4, R12).
- The real-data gate checklist exists and is tracked in the epic.
- RETENTION.md, ARCHITECTURE.md's data-flow table and SECURITY.md match what was built.
- No personal data anywhere in the diff.

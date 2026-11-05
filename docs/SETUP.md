# Setup: keys, tokens and secrets

Every key, token and secret Arca uses: where it lives, who creates it, and what breaks while it is missing. It is for the project owner; relatives using the app never handle any of these. This file never holds a value, only names and places.

Why agents create most of them through APIs, and the owner only what an API cannot do: [ADR-0012](adr/0012-automation-first-setup.md). How to rotate each one is in the [incident-response runbook](runbooks/incident-response.md#rotate-secrets), the one place for those steps; this file links to it instead of repeating them. A pull request that adds, renames or removes a secret updates this file in the same change, and a test (`tooling/scripts/test/setup-guide.test.ts`) fails when code reads a secret-like variable this file does not name.

Where things live:

- **Vercel**: project `arca` › Settings › Environment Variables. Every secret there is of type Sensitive (checked through the Vercel API on 2026-11-05), so nobody, agents included, can read it back.
- **Agent session**: the cloud environment of the Claude Code sessions that work on this repository ([claude.ai/code](https://claude.ai/code), environment settings).
- **Repository**: public values committed in code, changed by pull request.

A new secret an agent creates is 64 hex characters (`openssl rand -hex 32`); database passwords must be, since the bootstrap refuses base64. The agent creates it through the Vercel API after the owner says OK once, without printing it.

## Runtime secrets (Vercel)

| Name | What it is for | Environments | Created by | While missing or wrong |
| --- | --- | --- | --- | --- |
| `ARCA_DB_MIGRATOR_PASSWORD`, `ARCA_DB_API_PASSWORD`, `ARCA_DB_JOBS_PASSWORD`, `ARCA_DB_AUTH_PASSWORD`, `ARCA_DB_AUDIT_PASSWORD` | Passwords of the database roles of [ADR-0008](adr/0008-database-security-and-environments.md); the build's bootstrap sets them on every deployment | Production and Preview, with the same values (residual R-2 in the [threat model](threat-models/foundations.md)) | Agent | The build fails at the bootstrap, so nothing deploys. A rotation takes the serving deployment off the database until the new one is live, so block the API first, as the runbook says |
| `BETTER_AUTH_SECRET` | Signs session cookies ([ADR-0006](adr/0006-auth.md)) | Production and Preview, distinct values | Agent | Sign-in and every signed-in route fail; after a rotation everyone signs in again with their passkey |
| `ARCA_RATE_LIMIT_KEY` | Keys the rate-limit counters without storing raw identifiers ([spec 0003 R10](specs/0003-identity-and-access.md#r10-rate-limits)) | Production and Preview, distinct values | Agent | Rate-limited routes, sign-in among them, fail; a rotation resets the counters. Monthly rotation is still open in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) |
| `CRON_SECRET` | Bearer token Vercel Cron sends to `/internal/cron/*` | Production | Agent | The daily jobs (heartbeat, retention, rate-limit sweep, account erasure) are refused |
| `ARCA_VAPID_PRIVATE_KEY` | Signs web push messages ([spec 0005 R7](specs/0005-vault-devices-and-notifications.md)): the 43-character base64url private scalar of a P-256 pair whose public half is committed | Production and Preview, distinct pairs | Agent | Push notifications are off. After a new pair, each device turns push on again from the notifications screen |
| `RESEND_API_KEY` | Sends invite, recovery and security email as `arca@filx.app` ([ADR-0015](adr/0015-identity-enrollment-step-up-and-recovery.md)); only production sends, every other environment writes to the outbox | Production. A Preview copy exists but nothing reads it; it should be deleted | Owner, once: [Resend › API Keys](https://resend.com/api-keys), sending access, domain `filx.app` | No email goes out and production closes enrollment and invites (503 `accounts_closed`) |

## Values the integrations write (Vercel)

Written by Vercel's own integrations or by the owner once. Only the build scripts in `tooling/scripts` may read the database owner's values; the `arca/no-owner-environment` lint rule enforces it.

| Name | What it is for | Environments | Created by | While missing or wrong |
| --- | --- | --- | --- | --- |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `PG*`, `POSTGRES_*`, `NEON_PROJECT_ID` | The Neon owner role of the production branch `main`, used only by the build to bootstrap and migrate | Production | The Vercel–Neon integration (Vercel › Storage) | Production builds fail |
| `PGHOST`, `PGHOST_UNPOOLED`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` | The owner role of the Neon `development` branch, which every preview shares ([spec 0004 R1](specs/0004-real-data-readiness.md#r1-previews-fork-from-development-and-the-build-proves-it)) | Preview | Owner, once (done 2026-11-05) | Preview builds fail |
| `BLOB_STORE_ID`, `BLOB_WEBHOOK_PUBLIC_KEY` | The private document store `arca-documents-production`, reached through Vercel OIDC with no stored token ([spec 0005 R3](specs/0005-vault-devices-and-notifications.md#r3-document-storage)); not secrets | Production | Owner, once, by connecting the store (done 2026-11-04) | Document upload and download fail |
| `BLOB_PREVIEW_STORE_ID`, `BLOB_PREVIEW_WEBHOOK_PUBLIC_KEY` | The same for `arca-documents-preview` | Preview | Owner, once (done 2026-11-04) | The same, on previews |

## Committed in the repository

Public by design; a pull request changes them.

| What | Where | Change |
| --- | --- | --- |
| Hash of the owner's enrollment code | `apps/api/src/auth/enrollment-code-hash.ts` | Not needed after enrollment; a new code means a new hash by pull request |
| Sentry DSN (project `arca`, US region) | `packages/telemetry/src/sentry-project.ts` | New client key in Sentry › Project settings › Client Keys, then a pull request |
| VAPID public keys | `apps/api/src/notification/vapid.ts` | Together with `ARCA_VAPID_PRIVATE_KEY` |

## Agent session and CI

| Name | What it is for | Where | Created by | While missing |
| --- | --- | --- | --- | --- |
| `VERCEL_TOKEN` | Agents read the project and write Sensitive variables after the owner's OK | Agent session | Owner: [Vercel › Account › Tokens](https://vercel.com/account/settings/tokens), scoped to the team, with an expiry | Agents cannot create variables or read build logs |
| `ARCA_GITHUB_TOKEN` | The owner's fine-grained token for this repository (ADR-0012). Sessions reach GitHub through the Claude GitHub App instead, so nothing uses it today; let it expire | Agent session | Owner: [GitHub › Fine-grained tokens](https://github.com/settings/personal-access-tokens) | Nothing |
| `GITHUB_TOKEN` | The staleness workflow posts its weekly issue | GitHub Actions, issued per run | GitHub | — |

CI creates throwaway role passwords, `BETTER_AUTH_SECRET` and `ARCA_RATE_LIMIT_KEY` for each run, so it needs no stored secret. A workflow may use only the secrets listed in [.github/policy/workflow-secrets.json](../.github/policy/workflow-secrets.json).

## Local development

Nothing hosted reaches a local machine: the Neon integration does not connect Development. The local database tests and end-to-end tests use a throwaway Postgres and values of your own (`ARCA_TEST_DB_ADMIN_PASSWORD`, the role passwords, `BETTER_AUTH_SECRET`, `ARCA_RATE_LIMIT_KEY`, and `ARCA_ENROLLMENT_CODE_HASH` for a local enrollment code). The steps are in [README.md](../README.md#development).

## If a secret leaks

Follow the [incident-response runbook](runbooks/incident-response.md#rotate-secrets): rotate it as its row says, then check the audit log for use.

# Setup: keys, tokens and secrets

Every key, token and secret Arca uses, where it lives, who creates it and how to rotate it. It is for the project owner; relatives using the app never handle any of these. This file never holds a value, only names and places.

Why agents create most of them through APIs, and the owner only what an API cannot do: [ADR-0012](adr/0012-automation-first-setup.md). A pull request that adds, renames or removes a secret updates this file in the same change.

Where things live:

- **Vercel**: project `arca` › Settings › [Environment Variables](https://vercel.com/flisboa-projects/arca/settings/environment-variables). Every secret there is of type Sensitive, so nobody, agents included, can read it back.
- **Agent session**: the cloud environment of the Claude Code sessions that work on this repository ([claude.ai/code](https://claude.ai/code), environment settings).
- **Repository**: public values committed in code, changed by pull request.

Unless a row says otherwise, a new secret is 64 hex characters (`openssl rand -hex 32`), with distinct values for Production and Preview, and an agent creates it through the Vercel API after the owner says OK once.

## Runtime secrets (Vercel)

| Name | What it is for | Environments | Created by | Rotate | While missing or wrong |
| --- | --- | --- | --- | --- | --- |
| `ARCA_DB_MIGRATOR_PASSWORD`, `ARCA_DB_API_PASSWORD`, `ARCA_DB_JOBS_PASSWORD`, `ARCA_DB_AUTH_PASSWORD`, `ARCA_DB_AUDIT_PASSWORD` | Passwords of the database roles of [ADR-0008](adr/0008-database-security-and-environments.md); the build's bootstrap sets them on every deployment | Production, Preview | Agent | Write a new value, redeploy: the bootstrap applies it before the app starts | The build fails at the bootstrap, so nothing deploys |
| `BETTER_AUTH_SECRET` | Signs session cookies ([ADR-0006](adr/0006-auth.md)) | Production, Preview | Agent | Write a new value, redeploy | Sign-in and every signed-in route fail; after a rotation everyone signs in again with their passkey |
| `ARCA_RATE_LIMIT_KEY` | Keys the per-account rate limits without storing raw identifiers ([spec 0003 R10](specs/0003-identity-and-access.md#r10-rate-limits)) | Production, Preview | Agent | Monthly, open in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md): write a new value, redeploy | Rate-limited routes, sign-in among them, fail; a rotation resets the counters |
| `CRON_SECRET` | Bearer token Vercel Cron sends to `/internal/cron/*` | Production | Agent | Write a new value, redeploy | Daily jobs (heartbeat, retention, rate-limit sweep, account erasure) are refused |
| `ARCA_VAPID_PRIVATE_KEY` | Signs web push messages ([spec 0005 R7](specs/0005-vault-devices-and-notifications.md)); the public half is in `apps/api/src/notification/vapid.ts` | Production, Preview | Agent | New key pair: the private half through the API, the public half by pull request, then redeploy. Every device subscribes again on its next visit | Push notifications are off |
| `RESEND_API_KEY` | Sends invite, recovery and security email as `arca@filx.app` ([ADR-0015](adr/0015-identity-enrollment-step-up-and-recovery.md)) | Production, Preview | Owner, once: [Resend › API Keys](https://resend.com/api-keys), sending access, domain `filx.app` | Create a new key in Resend, paste it into Vercel, redeploy, delete the old key | No email goes out: invites and account recovery stop |

## Values the integrations write (Vercel)

These are written by Vercel's own integrations or by the owner once. Only the build scripts in `tooling/scripts` may read the database owner's values; the `arca/no-owner-environment` lint rule enforces it.

| Name | What it is for | Environments | Created by | Rotate | While missing or wrong |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `PG*`, `POSTGRES_*`, `NEON_PROJECT_ID` | The Neon owner role of the production branch `main`, used only by the build to bootstrap and migrate | Production | The Vercel–Neon integration (Vercel › Storage) | Reset the owner password in the [Neon console](https://console.neon.tech) (branch `main` › Roles); the integration updates the values. Redeploy | Production builds fail |
| `PGHOST`, `PGHOST_UNPOOLED`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` | The owner role of the Neon `development` branch, which every preview shares ([spec 0004 R1](specs/0004-real-data-readiness.md#r1-previews-fork-from-development-and-the-build-proves-it)) | Preview | Owner, once (done 2026-11-05) | Reset `neondb_owner` on `development` in the Neon console, paste the new password into the Preview `PGPASSWORD` | Preview builds fail |
| `BLOB_STORE_ID`, `BLOB_WEBHOOK_PUBLIC_KEY` | The private document store `arca-documents-production`, reached through Vercel OIDC with no stored token ([spec 0005 R3](specs/0005-vault-devices-and-notifications.md#r3-document-storage)) | Production | Owner, once, by connecting the store (done 2026-11-04) | Nothing to rotate: not secrets | Document upload and download fail |
| `BLOB_PREVIEW_STORE_ID`, `BLOB_PREVIEW_WEBHOOK_PUBLIC_KEY` | The same for `arca-documents-preview` | Preview | Owner, once (done 2026-11-04) | Nothing to rotate | Same, on previews |

## Committed in the repository

Public by design; a pull request changes them.

| What | Where | Rotate |
| --- | --- | --- |
| Hash of the owner's enrollment code | `apps/api/src/auth/enrollment-code-hash.ts` | Not needed after enrollment; a new code means a new hash by pull request |
| Sentry DSN (project `arca`, US region) | `packages/telemetry/src/sentry-project.ts` | New client key in Sentry › Project settings › Client Keys, then a pull request |
| VAPID public keys | `apps/api/src/notification/vapid.ts` | With `ARCA_VAPID_PRIVATE_KEY`, above |

## Agent session and CI

| Name | What it is for | Where | Created by | Rotate | While missing |
| --- | --- | --- | --- | --- | --- |
| `VERCEL_TOKEN` | Agents read the project and write Sensitive variables after the owner's OK | Agent session | Owner: [Vercel › Account › Tokens](https://vercel.com/account/settings/tokens), scoped to the team, with an expiry | Create a new token, replace it in the environment, delete the old one | Agents cannot create variables or read build logs |
| `ARCA_GITHUB_TOKEN` | Agents' GitHub access to this repository; fine-grained, limited to `fernandolisboa/arca`, expiring | Agent session | Owner: [GitHub › Fine-grained tokens](https://github.com/settings/personal-access-tokens) | Same as above, before it expires | Agents cannot push or open pull requests |
| `GITHUB_TOKEN` | The staleness workflow posts its weekly issue | GitHub Actions, issued per run | GitHub | Nothing to do | — |

CI creates throwaway role passwords, `BETTER_AUTH_SECRET` and `ARCA_RATE_LIMIT_KEY` for each run, so it needs no stored secret. A workflow may use only the secrets listed in [.github/policy/workflow-secrets.json](../.github/policy/workflow-secrets.json).

## Local development

Nothing hosted reaches a local machine: the Neon integration does not connect Development. The local database tests and end-to-end tests use a throwaway Postgres and values of your own (`ARCA_TEST_DB_ADMIN_PASSWORD`, the role passwords, `BETTER_AUTH_SECRET`, `ARCA_RATE_LIMIT_KEY`, and `ARCA_ENROLLMENT_CODE_HASH` for a local enrollment code). The steps are in [README.md](../README.md#development).

## If a secret leaks

Follow the [incident-response runbook](runbooks/incident-response.md#rotate-secrets): rotate it as its row says, then check the audit log for use.

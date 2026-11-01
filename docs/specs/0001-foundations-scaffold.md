# Spec 0001: Foundations scaffold

- Status: Ready for tickets
- Date: 2026-11-01
- Epic: cross-platform foundations ([ROADMAP.md](../ROADMAP.md#phase-1--family-mvp-web))
- Decisions: [ADR-0009](../adr/0009-background-jobs-guarantees.md), [ADR-0010](../adr/0010-stack-revised.md), [ADR-0011](../adr/0011-reviewers-in-ci.md), [ADR-0008](../adr/0008-database-security-and-environments.md), [ADR-0005](../adr/0005-platform-strategy.md)

## Goal

A monorepo that builds, tests and deploys an empty Arca end to end: a pt-BR web shell and an API on one origin, one sample workflow and a database with its roles, all in São Paulo, with every CI gate from REVIEW.md enforced as a required check. Feature work after this adds code to an existing structure; it does not set up structure.

## Scope

**In:** the workspace and its tooling; `packages/domain`, `packages/api-contract`, `packages/ui`, `packages/i18n`, `packages/platform`; `apps/api` and `apps/web`; boundary checks; CI for lint, types, tests, build and supply chain; the reviewer gate in CI; `GET /v1/health`; the OpenAPI export and the typed client; a heartbeat workflow; database roles, migrations and the row-level security guard; deploy to previews and an empty production.

**Out (later slices of the same epic):** authentication and passkeys; Sentry, OpenTelemetry export and Langfuse; `platform` capabilities beyond the empty port; notifications; S3, KMS and OIDC to AWS; the vault ADR; account deletion and export; the incident response runbook; `apps/mobile` and `apps/desktop`; any table with case data; any feature.

**No feature code and no case data.** Nothing in this slice reads, stores or displays personal data.

## Layout

```text
apps/
  api/                 Hono app (src/app.ts), Nitro shell (nitro.config.ts), workflows (src/workflows)
  web/                 React SPA, PWA manifest and service worker
packages/
  domain/              empty; pure TypeScript, no I/O (boundary-checked)
  api-contract/        route definitions with @hono/zod-openapi, openapi.json, typed client
  ui/                  Tailwind 4 tokens, AppShell
  i18n/                i18next setup, pt-BR catalog
  platform/            Capabilities port, web adapter (no capabilities yet)
  db/                  Drizzle config, migrations, role SQL, the guard tests
tooling/
  eslint-config/       shared flat config
  tsconfig/            shared base configs
  scripts/             boundary check, OpenAPI drift check
```

`packages/db` is new to the layout in ARCHITECTURE.md: migrations and role SQL are shared by the API, jobs and CI, and belong to none of them. ARCHITECTURE.md is updated in the same change.

## Requirements

### R1. Workspace

- Versions per the table in [Versions](#versions); Node pinned in `engines` and `.nvmrc`, pnpm pinned in `packageManager` with its integrity hash, Turborepo with no remote cache.
- TypeScript `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`; project references per package.
- Two TypeScript versions, separated by package: TypeScript 7 (`tsc`, the native compiler) typechecks and builds everything; `tooling/eslint-config` alone depends on TypeScript 6.0, because typescript-eslint uses the compiler API that TypeScript 7 does not expose yet. TypeScript 6.0 is the release designed to match 7.0's behavior, so the two agree. When typescript-eslint supports 7, the 6.0 dependency is removed.
- ESLint flat config with typescript-eslint `strictTypeChecked` and `stylisticTypeChecked`; Prettier; `pnpm check` runs format check, lint, typecheck, test and build through Turborepo.
- Shared versions through a pnpm catalog.
- `pnpm-workspace.yaml` supply-chain settings: `minimumReleaseAge: 10080` (7 days), `strictDepBuilds: true` with an explicit `allowBuilds` list (empty unless a package needs it, each entry justified in the PR), `trustPolicy: no-downgrade`, `blockExoticSubdeps: true`.
- `.env.example` per app; no `.env` committed (already in `.gitignore`).

### R2. Boundaries, enforced in CI

- A script reads every workspace `package.json` and fails on a dependency outside this matrix:

| Package | May depend on |
| --- | --- |
| `apps/web` | `api-contract` (client only), `ui`, `i18n`, `platform` |
| `apps/api` | `domain`, `api-contract`, `db` |
| `packages/domain` | nothing in the workspace |
| `packages/api-contract` | nothing in the workspace |
| `packages/ui` | `i18n` |
| `packages/platform`, `packages/i18n` | nothing in the workspace |
| `packages/db` | nothing in the workspace |

- ESLint, scoped by package:
  - `packages/domain`: no imports of `node:*`, database clients, HTTP clients or `fetch`; no `Date.now()` or `new Date()` without arguments (time is passed in).
  - `apps/web`, `packages/ui`: no `navigator.userAgent`, `navigator.platform` or `navigator.userAgentData`, and no imports of Capacitor or Tauri APIs (native access goes through `packages/platform`); `i18next/no-literal-string` in JSX so text goes through i18n; React rules from `@eslint-react/eslint-plugin` and `eslint-plugin-react-hooks` (`eslint-plugin-react` does not support ESLint 10).
  - `apps/api/src/workflows`: `start` from `workflow/api` may be imported only by the shared start helper (R6).
- Each rule has a test fixture that must fail, so a misconfigured rule is caught.

### R3. API and contract

- `packages/api-contract` defines routes with `@hono/zod-openapi` `createRoute`, versioned under `/v1`. The first route is `GET /v1/health` → `{ status: "ok" | "degraded", checks: { database: "ok" | "unavailable" } }`.
- `apps/api` implements the contract on a plain Hono app that is importable and testable without Nitro.
- A script writes `packages/api-contract/openapi.json`; CI fails if the committed file differs from the generated one.
- The typed client lives in `packages/api-contract` and is derived from the same route definitions: request and response types are inferred from the Zod schemas, and responses are validated with them at runtime, so a server that drifts from the contract fails loudly in the client. No code generation step. (`openapi-typescript` was considered; it requires TypeScript 5.) `apps/web` uses only that client.
- The client takes its base URL from build configuration: relative `/v1` for the web build, an absolute URL for native builds later.
- Errors: one handler returns `{ error: { code } }` with a generic status; details go to the structured log, never to the response.
- Structured JSON logs through a small logger in `apps/api` that writes only fields from an allow-list (request ID, route, status, duration, error code); anything else is dropped. A test proves an unknown field is dropped.
- Every response from `/v1` sets `Cache-Control: no-store`.

### R4. One origin and security headers

- The Nitro build of `apps/api` serves `apps/web`'s built bundle as static files and the API under `/v1`; unknown non-API paths fall back to `index.html`. The workflow routes the SDK registers stay reachable.
- Headers on every response: `Content-Security-Policy` with `default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'`; `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`; `X-Content-Type-Options: nosniff`; `Referrer-Policy: no-referrer`; `Permissions-Policy` denying camera, microphone and geolocation until a feature needs them. No inline scripts in `index.html`.
- `apps/web` still builds alone to a static `dist/` that works when served by any static server, which is what Capacitor and Tauri will wrap.

### R5. Web shell

- Vite, React, TanStack Router (file-based) and TanStack Query, at the versions in [Versions](#versions).
- `packages/i18n`: i18next with ICU message format; `pt-BR` catalog only; a missing key fails a test.
- `packages/ui`: Tailwind 4 design tokens and an `AppShell` that respects safe areas (`env(safe-area-inset-*)`), works from 320 px to desktop widths, and has touch targets of at least 44 px.
- The home route shows the product name and the API status from `/v1/health`, in pt-BR. No other screens.
- PWA: web app manifest (pt-BR name, icons, `display: standalone`), and a service worker that precaches only the built static files and never caches `/v1` responses.
- `packages/platform`: a `Capabilities` port (`has(capability): boolean`) and a web adapter that reports none. UI code reads capabilities only through it.

### R6. Sample workflow

- `workflow` and Nitro pinned exactly ([Versions](#versions)).
- `startWorkflow(fn, args)` is the only caller of `start()`: it passes `region: 'gru1'` and `experimental_retention: 0`, and its type accepts only identifier-shaped arguments (branded ID strings and ISO dates).
- `heartbeat(runDate)`: one step opens a transaction as `app_jobs` and reads `now()`; the run writes nothing and returns nothing that needs keeping.
- Trigger: a daily Vercel cron calls `POST /internal/cron/heartbeat`, which checks `Authorization: Bearer <CRON_SECRET>` with a constant-time comparison and returns 401 otherwise. No other route starts workflows. The route is excluded from the OpenAPI document.
- Workflow and step function names are generic (`heartbeat`, `readDatabaseTime`). No run attributes. Errors thrown from steps carry codes only.
- Tests: the workflow runs locally against the Postgres container; the helper's options are asserted.

### R7. Database foundation

- `packages/db`: Drizzle ORM and drizzle-kit 1.0 release candidates ([Versions](#versions)); migrations run as `app_migrator` only.
- `bootstrap.sql`, run once per Neon project by the owner (documented in `packages/db/README.md`): creates `app_migrator` with the rights to own the schema and create the runtime roles. It is the only script that uses the Neon owner role.
- The first migration creates `app_api`, `app_jobs`, `app_auth` and `app_audit` as `NOBYPASSRLS`, `NOSUPERUSER`, `NOCREATEROLE`, `NOCREATEDB`, with no table grants yet. Passwords come from the environment at migration time, never from the repository.
- A transaction helper for the API sets identity with `SET LOCAL` (person and case IDs as settings). With no case tables it is exercised by a test-only table created inside the test.
- **Guard tests** (the start of the access-matrix suite), run in CI against a Postgres 18 service container pinned by digest (Neon projects are created on Postgres 18 too):
  1. Every table in the application schemas has row-level security enabled and forced, except tables on an explicit allow-list in the test file (empty now; auth tables join it with the auth slice).
  2. No runtime role has `rolbypassrls`, `rolsuper`, `rolcreaterole` or `rolcreatedb`, or is a member of `neon_superuser` when that role exists.
  3. No runtime role owns any table.
- `GET /v1/health` checks the database as `app_api` with `select 1`, with a 2-second timeout; it reports `degraded`, not an error, when the database is unreachable.
- The synthetic seed starts empty and is the only source of non-production data.

### R8. CI

All workflows: actions pinned by full commit SHA; top-level `permissions: {}` with jobs granting only what they need; `concurrency` per ref; no `pull_request_target`; runs on GitHub-hosted runners.

| Check (required on `main`) | What it runs |
| --- | --- |
| `check` | `pnpm install --frozen-lockfile`, then `pnpm check` (format, lint, typecheck, unit tests, build), the boundary script and the OpenAPI drift check |
| `db` | Migrations and guard tests on the Postgres container |
| `e2e` | Playwright against the built app served locally, at phone (390×844) and desktop (1280×800) sizes: the home page renders in pt-BR, shows the API status, and has no CSP violations |
| `osv-scanner` | Dependency advisories on the lockfile; fails on any known vulnerability without a recorded exception |
| `dependency-review` | GitHub's dependency review on pull requests; fails on new advisories and on licenses outside an allow-list |
| `gitleaks` | Secret scan of the pull request's commits, with the binary pinned by version and checksum |
| `codeql` | CodeQL for JavaScript and TypeScript, plus the Actions language for the workflows |
| `sbom` | A CycloneDX SBOM of the lockfile, uploaded as a build artifact |
| `review-gate` | The reviewer subagents ([ADR-0011](../adr/0011-reviewers-in-ci.md)) |

- Dependabot: version updates for npm and GitHub Actions, weekly, grouped, with `cooldown` of 7 days to match pnpm. While scaffolding, check that Dependabot updates a catalog entry in `pnpm-workspace.yaml` and the lockfile together. If it cannot, configure Renovate instead and amend ADR-0010.
- Repository settings that Fernando applies (listed in the PR, since they are not code): a ruleset on `main` requiring the checks above, linear history and no force pushes; secret scanning push protection; Dependabot alerts; private vulnerability reporting.

### R9. Deploy

- Names: Vercel project `arca`; Neon projects `arca-prod` and `arca-nonprod`; in each, the database is named `arca` (not Neon's default `neondb`) and the default branch `main`; preview branches are `preview/pr-<number>`.
- One Vercel project in the Pro team, functions in `gru1` only, Node 26.
- Production deploys from `main`; every pull request from a branch of this repository gets a preview behind Vercel Deployment Protection.
- Environment variables per environment (production, preview, development); production values are never available to previews.
- Neon: `arca-prod` and `arca-nonprod`, both `sa-east-1`, Postgres 18. Previews use a branch of the non-production project per pull request, created by a GitHub workflow in a `preview` environment that holds a Neon API key scoped to the non-production project only; the workflow runs migrations as `app_migrator` and writes the runtime connection strings to the preview's environment. The Vercel–Neon integration is not used.
- After deploy, a smoke test calls `/v1/health` on the preview URL through the Deployment Protection bypass for automation, and checks the security headers.
- Production holds an empty database with roles applied. The heartbeat cron runs in production only.

## Versions

The latest stable release of each, checked on the npm registry on 2026-11-01, unless a pre-release is clearly better. Two limits apply: versions must work together, and pnpm's 7-day minimum release age means the scaffold takes the newest release published at least 7 days before it is installed. A package newer than that (for example, a Nitro release candidate from 2026-10-29) waits; an exception goes in `minimumReleaseAgeExclude` with a reason in the PR.

| Package | Version | Why this one |
| --- | --- | --- |
| Node.js | 26 LTS | Current LTS (since 2026-10-28); Vercel's default |
| pnpm | 12.x | Latest |
| TypeScript | 7.0 for `tsc`; 6.0 for typescript-eslint only | See R1 |
| ESLint, typescript-eslint | 10.x, 8.72+ | Latest; typescript-eslint supports ESLint 10 |
| Prettier | 3.x | Latest stable; 4.0 is an alpha with no gain for us |
| Turborepo | 2.11+ | Latest |
| React | 19.3 | Latest |
| Vite, `@vitejs/plugin-react` | 8.3, 6.x | Latest |
| TanStack Router, TanStack Query | 1.170+, 5.105+ | Latest |
| Tailwind CSS | 4.3 | Latest |
| `vite-plugin-pwa` | 2.0 | Latest; supports Vite 8 |
| i18next, react-i18next, i18next-icu | 26.x, 17.x, 2.6 | Latest; react-i18next accepts TypeScript 7 |
| Hono | 4.13 | Latest stable. Hono 5 is at its first release candidate; `@hono/zod-openapi` and Nitro have not been proven against it, and it offers this slice nothing. Revisit at 5.0 |
| Zod, `@hono/zod-openapi` | 4.6, 1.6 | Latest |
| `workflow` | 5.2+ | Latest; 5.x is required for region pinning (ADR-0009) |
| Nitro | 3.0 release candidate | Pre-release, required: the Workflow SDK's Hono path needs Nitro 3 |
| Drizzle ORM, drizzle-kit | 1.0 release candidate | Pre-release, chosen: 0.45 would force a 1.0 migration within months, and 1.0 brings the reworked RLS and role APIs we depend on. Risk is low while no case tables exist; any RC bug found is fixed or pinned before the first case table |
| `pg` | 8.x | Latest; driver for Drizzle and the guard tests |
| Vitest | 5.0 | Latest stable; 5.1 is a beta with nothing we need |
| Playwright | 1.64+ | Latest |
| Postgres (CI container and Neon) | 18 | Latest major Neon supports |

## Threat model for this slice

Assets in play: CI secrets (Anthropic API key, Neon API key for previews, Vercel tokens), the deploy pipeline, the integrity of `main`. No personal data exists yet.

| Threat (STRIDE, LLM and agentic) | Where | Control in this slice |
| --- | --- | --- |
| Tampering: malicious dependency or action | Install, CI | R1 pnpm settings, SHA-pinned actions, osv-scanner, dependency review, Dependabot cooldown, supply-chain reviewer |
| Information disclosure: secret in a commit | Repository | Push protection, gitleaks, `.gitignore`, `.env.example` only |
| Elevation: fork pull request reaching secrets | CI | `pull_request` only; secrets only in jobs that forks cannot reach; `preview` environment limited to same-repository branches |
| Prompt injection in a pull request steering the reviewers | `review-gate` | Read-only tools, no write token in the model step, base-branch reviewer definitions, fail-closed verdict ([ADR-0011](../adr/0011-reviewers-in-ci.md)) |
| Denial of wallet: unauthenticated workflow starts | API | No public route starts workflows; cron route needs `CRON_SECRET` |
| Elevation: service connected with an owner role | Database | Runtime roles created by migration, guard test 2, no Vercel–Neon integration |
| Information disclosure: production data in a preview | Database | Separate Neon projects; previews branch only from the non-production project |
| Information disclosure: data in workflow metadata | Workflows | Identifier-only arguments by type, generic names, no attributes, zero retention ([ADR-0009](../adr/0009-background-jobs-guarantees.md)) |
| Cross-site scripting | Web | Strict CSP with Trusted Types, no inline scripts, no third-party scripts |
| Spoofing: preview accessed by outsiders | Vercel | Deployment Protection on previews |

## Definition of done

- Every requirement above is met and covered by a test or a CI check.
- All checks in R8 pass on the pull request that completes the slice, and the ruleset requires them.
- A preview and production deploy show the pt-BR home page with `status: ok` from `/v1/health`.
- The heartbeat has run once in production, in `gru1`, with its payloads shown as expired.
- ARCHITECTURE.md lists `packages/db` and `tooling/`; README.md says how to run the app locally.
- No user-facing string outside i18n; no personal data anywhere.

# Spec 0001: Foundations scaffold

- Status: Ready for tickets
- Date: 2026-11-01
- Epic: cross-platform foundations ([ROADMAP.md](../ROADMAP.md#phase-1--family-mvp-web))
- Decisions: [ADR-0009](../adr/0009-background-jobs-guarantees.md), [ADR-0010](../adr/0010-stack-revised.md), [ADR-0011](../adr/0011-reviewers-in-ci.md), [ADR-0008](../adr/0008-database-security-and-environments.md), [ADR-0005](../adr/0005-platform-strategy.md)

## Goal

A monorepo that builds, tests and deploys an empty Arca end to end: a pt-BR web shell and an API on one origin, one sample workflow and a database with its roles, all in São Paulo, with every CI gate from REVIEW.md enforced as a required check. Feature work after this adds code to an existing structure; it does not set up structure.

## Scope

**In:** the workspace and its tooling; `packages/domain`, `packages/api-contract`, `packages/ui`, `packages/i18n`, `packages/platform`, `packages/db`; `apps/api` and `apps/web`; boundary checks; CI for lint, types, tests, build and supply chain; the reviewer gate in CI and its canary suite; `GET /v1/health`; the OpenAPI export and the typed client; a heartbeat workflow; database roles, migrations and the row-level security guard; deploy to previews and an empty production.

**Out (later slices of the same epic):** authentication and passkeys; Sentry, OpenTelemetry export and Langfuse; `platform` capabilities beyond the empty port; notifications; S3, KMS and OIDC to AWS; the vault ADR; account deletion and export; the incident response runbook; `apps/mobile` and `apps/desktop`; any table with case data; any feature.

**No feature code and no case data.** Nothing in this slice reads, stores or displays personal data.

## Layout

```text
apps/
  api/                 Hono app (src/app.ts), Nitro shell (nitro.config.ts), workflows (src/workflows)
  web/                 React SPA, PWA manifest and service worker
packages/
  domain/              empty; pure TypeScript, no I/O (boundary-checked)
  api-contract/        route definitions (./routes), Hono bindings (./server), typed client (./client), openapi.json
  ui/                  Tailwind 4 tokens, AppShell
  i18n/                i18next setup, pt-BR catalog
  platform/            Capabilities port, web adapter (no capabilities yet)
  db/                  Drizzle config, migrations, role SQL, guard tests
tooling/
  eslint-config/       shared flat config
  tsconfig/            shared base configs
  security-policy/     CSP and security headers as data, plus route exclusions for the SPA fallback
  scripts/             boundary check, OpenAPI drift check, bundle check, migration runner
.github/
  workflows/           CI, review gate, preview and production pipelines
  CODEOWNERS           the owner for every gate path
eval/
  review-gate/         canary diffs for the reviewer gate
```

## Requirements

### R1. Workspace

- Versions per [Versions](#versions). Every dependency is pinned to an exact version (pnpm `savePrefix: ''`), through a pnpm catalog. Node is pinned in `engines` and `.nvmrc`, pnpm in `packageManager` with its integrity hash. Turborepo runs with no remote cache.
- TypeScript `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`; project references per package.
- Two TypeScript versions, separated by package. TypeScript 7 (`tsc`, the native compiler) typechecks and builds everything. `tooling/eslint-config` alone depends on TypeScript 6.0, because typescript-eslint needs the compiler API that TypeScript 7 does not expose as stable yet. TypeScript 6.0 was released to match 7.0's type-checking behavior, so the two agree. When typescript-eslint supports 7, the 6.0 dependency goes.
- ESLint flat config with typescript-eslint `strictTypeChecked` and `stylisticTypeChecked`; Prettier; `pnpm check` runs format check, lint, typecheck, test and build through Turborepo.
- `pnpm-workspace.yaml` supply-chain settings: `minimumReleaseAge: 10080` (7 days, in minutes), `strictDepBuilds: true` with an explicit `allowBuilds` list (empty unless a package needs it, each entry justified in the PR), `trustPolicy: no-downgrade`, `blockExoticSubdeps: true`.
- `.env.example` per app; no `.env` committed (already in `.gitignore`).

### R2. Boundaries, enforced in CI

- A script reads every workspace `package.json` and fails on any dependency field (`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`) naming a workspace package outside this matrix. `tooling/*` is allowed everywhere, in `devDependencies` only.

| Package | May depend on |
| --- | --- |
| `apps/web` | `api-contract`, `ui`, `i18n`, `platform` |
| `apps/api` | `domain`, `api-contract`, `db` |
| `packages/ui` | `i18n` |
| `packages/domain`, `packages/api-contract`, `packages/platform`, `packages/i18n`, `packages/db` | nothing in the workspace |

- ESLint, scoped by package:
  - `packages/domain`: no imports of `node:*`, database clients, HTTP clients or `fetch`; no `Date.now()` or `new Date()` without arguments (time is passed in).
  - `apps/web`, `packages/ui`: no `navigator.userAgent`, `navigator.platform` or `navigator.userAgentData`; no imports of Capacitor or Tauri APIs (native access goes through `packages/platform`); `i18next/no-literal-string` in JSX, so text goes through i18n; React rules from `@eslint-react/eslint-plugin` and `eslint-plugin-react-hooks`.
  - `apps/web`: imports from `@arca/api-contract` only through `@arca/api-contract/client`.
  - `apps/api/src/workflows`: `start` from `workflow/api` may be imported only by the shared start helper (R6).
- ESLint bans relative imports that cross a package root (`../../packages/…`).
- A bundle check fails if Hono or `@hono/zod-openapi` modules appear in `apps/web/dist`.
- Each rule has a test fixture that must fail, so a misconfigured rule is caught.

### R3. API and contract

- `packages/api-contract` has three entry points:
  - `./routes`: route metadata as plain data (method, path, Zod request and response schemas), with no Hono import. The first route is `GET /v1/health` → `{ status: "ok" | "degraded", checks: { database: "ok" | "unavailable" } }`.
  - `./server`: wraps `./routes` with `@hono/zod-openapi` `createRoute` for the API and the OpenAPI export.
  - `./client`: the typed client, derived from `./routes`. Request and response types are inferred from the Zod schemas, and responses are validated with them at runtime, so a server that drifts from the contract fails loudly. No code generation step; `openapi-typescript` was considered and requires TypeScript 5. The base URL comes from build configuration: relative `/v1` for the web build, an absolute URL for native builds later.
- `apps/api` implements the contract on a plain Hono app that is importable and testable without Nitro.
- A script writes `packages/api-contract/openapi.json`; CI fails if the committed file differs from the generated one.
- Errors: one handler returns `{ error: { code } }` with a generic status; details go to the structured log, never to the response.
- Structured JSON logs through a small logger in `apps/api` that writes only fields on an allow-list (request ID, route, status, duration, error code); anything else is dropped. A test proves an unknown field is dropped.
- Every response from `/v1` and `/internal` sets `Cache-Control: no-store`.
- `/v1/health` caches its database result for 10 seconds per instance, so repeated calls do not each open a connection. Edge rate limiting comes with the auth slice.

### R4. One origin and security headers

- The Nitro build of `apps/api` serves `apps/web`'s built bundle as static files and the API under `/v1`.
- Only paths outside `/v1`, `/internal`, `/.well-known` and the Workflow SDK's routes fall back to `index.html`; unmatched paths under those prefixes return 404.
- `tooling/security-policy` holds the header policy and the fallback exclusions as data. The Nitro config imports it; native build targets will later inject the same CSP as a `<meta http-equiv>` tag with the API origin in `connect-src`, since a wrapped bundle gets no response headers.
- Headers on every response:
  - `Content-Security-Policy`: `default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types arca`.
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a `Permissions-Policy` denying camera, microphone and geolocation until a feature needs them.
- No inline scripts in `index.html`.
- `apps/web` still builds alone to a static `dist/` that works on any static server, which is what Capacitor and Tauri will wrap.

### R5. Web shell

- Vite, React, TanStack Router (file-based) and TanStack Query, at the versions in [Versions](#versions).
- `packages/i18n`: i18next with ICU message format through `i18next-icu`; `pt-BR` catalog only; a missing key fails a test.
- `packages/ui`: Tailwind 4 design tokens and an `AppShell` that respects safe areas (`env(safe-area-inset-*)`), works from 320 px to desktop widths, and has touch targets of at least 44 px.
- The home route shows the product name and the API status from `/v1/health`, in pt-BR. No other screens.
- PWA: a web app manifest (pt-BR name, icons, `display: standalone`) and a service worker that precaches only the built static files and never caches `/v1` responses.
- The service worker is built with `vite-plugin-pwa` in `injectManifest` mode with Workbox bundled into the worker (no `importScripts`), because the Trusted Types header applies inside the worker too. It is registered by our own code through the `arca` Trusted Types policy, which returns only the one known worker URL; the plugin's injected registration is off.
- `packages/platform`: a `Capabilities` port (`has(capability): boolean`) and a web adapter that reports none. UI code reads capabilities only through it.

### R6. Sample workflow

- `workflow` and Nitro pinned exactly ([Versions](#versions)).
- `startWorkflow(fn, args)` is the only caller of `start()`. It passes `region: 'gru1'` and `experimental_retention: 0`, and its type accepts only identifier-shaped arguments (branded ID strings and ISO dates).
- `heartbeat(runDate)`: one step opens a transaction as `app_jobs` and reads `now()`. The run writes nothing and returns nothing that needs keeping.
- Trigger: a daily Vercel cron sends `GET /internal/cron/heartbeat` (Vercel cron always uses GET). The route checks `Authorization: Bearer <CRON_SECRET>` by hashing both values and comparing the digests in constant time (lengths may differ), and returns 401 otherwise. `runDate` is the UTC date. No other route of ours starts workflows. The route is not in the OpenAPI document.
- Workflow and step function names are generic (`heartbeat`, `readDatabaseTime`). No run attributes. Errors thrown from steps carry codes only.
- The Workflow SDK's own routes must reject requests that the platform's queue did not sign. The ticket records how the SDK authenticates them, with a source, in ADR-0009. A post-deploy smoke test sends an unsigned request and expects rejection. If the SDK does not authenticate them, the slice stops and a decision comes back to the owner.
- Tests: the workflow runs locally against the Postgres container; the helper's options are asserted.

### R7. Database foundation

- `packages/db`: Drizzle ORM and drizzle-kit ([Versions](#versions)). Migrations are forward-only SQL files; a one-way change records its reason in the PR.
- Migrations are applied by our own runner in `tooling/scripts`, which reads the `.sql` files as data and runs them as `app_migrator`. It does not load `drizzle.config.ts` or any other code from the change being deployed. Each migration and the guard queries run in one transaction, which commits only if the guards pass (Postgres DDL and role statements are transactional), so a migration that weakens row-level security never commits.
- `bootstrap.sql` is run once per Neon project by the repository owner, using the Neon owner role, and is documented in `packages/db/README.md`. It creates `app_migrator` as `NOBYPASSRLS`, `NOSUPERUSER`, `NOREPLICATION`, `CREATEROLE`, not a member of `neon_superuser`, owning the application schema. It is the only script that uses the Neon owner role.
- The first migration creates `app_api`, `app_jobs`, `app_auth` and `app_audit` as `NOBYPASSRLS`, `NOSUPERUSER`, `NOREPLICATION`, `NOCREATEROLE`, `NOCREATEDB`, with no passwords and no table grants yet.
- Passwords: the pipeline sets each role's password per environment and per preview branch through the Neon API's role password reset, so no SQL text ever carries a password and no two branches share credentials. Re-running it rotates them. If the Neon API cannot reset SQL-created roles, the fallback is a SCRAM verifier computed by libpq's `PQencryptPasswordConn` through a vetted package added with a supply-chain PASS; no custom cryptography.
- Request identity is set with `select set_config('app.person_id', $1, true)` and `set_config('app.case_id', $2, true)`, with UUID-validated parameters, never by string interpolation. Policies will read `nullif(current_setting('app.person_id', true), '')::uuid`, so a missing or reset setting yields no rows rather than an error. With no case tables, the helper is exercised by a test-only table created inside the test: no identity returns zero rows; the setting does not carry into the next transaction on a pooled connection; a malformed ID is rejected before any SQL runs.
- **Guard tests** (the start of the access-matrix suite). "Neon-managed roles" is a documented list in `packages/db`; every other role is checked.
  1. Every table in every non-system schema has row-level security enabled and forced, except tables on an explicit allow-list in the test file (drizzle-kit's journal now; auth tables join with the auth slice).
  2. Views in those schemas have `security_invoker = true`. Materialized views, foreign tables and `SECURITY DEFINER` functions are forbidden unless allow-listed.
  3. The roles that can log in, minus the Neon-managed roles, are exactly `app_api`, `app_jobs`, `app_auth`, `app_audit` and `app_migrator`.
  4. No role other than the Neon-managed ones has `rolsuper`, `rolbypassrls`, `rolreplication` or `rolcreatedb`; only `app_migrator` has `rolcreaterole`.
  5. No role other than the Neon-managed ones is a member of any role, directly or through other roles (`pg_auth_members`, `pg_has_role`), outside an allow-list that starts empty. On Neon this includes `neon_superuser`, for `app_migrator` too.
  6. No runtime role owns a table or schema, or has `CREATE` on any schema or on the database.
- The guards run in CI against a Postgres 18 service container pinned by digest, and inside every migration transaction on preview branches and production (as `app_migrator`), which is where the Neon-specific checks actually bite.
- `GET /v1/health` checks the database as `app_api` with `select 1`, with a 2-second timeout. It reports `degraded`, not an error, when the database is unreachable.
- The synthetic seed starts empty and is the only source of non-production data.

### R8. CI

All workflows: actions pinned by full commit SHA; top-level `permissions: {}`, with jobs granting only what they need; GitHub-hosted runners; `actions/checkout` with `persist-credentials: false`. Workflows on `pull_request` and `push` use `concurrency` per ref; the two `pull_request_target` workflows (review gate, preview pipeline) group by pull request number. Values from the event (branch names, titles, file names) reach `run:` steps only through `env:` and are validated against a strict pattern before use.

**Secrets.** There are no repository-level secrets. Every secret lives in a GitHub environment whose deployment-branch policy allows `main` only: `review` (Anthropic key), `preview` (Neon API key for `arca-nonprod`, the `arca-nonprod` migrator credential, Vercel token, Deployment Protection bypass), `production` (production migrator credential, Vercel token). Workflows on `pull_request_target` and on `push` to `main` run with ref `main`; runs on `pull_request` do not, so code from a branch cannot reach any secret.

| Check (required on `main`) | What it runs |
| --- | --- |
| `check` | pnpm installed by `pnpm/action-setup` (pinned) at the `packageManager` version, the downloaded binary verified against its recorded hash, `pnpm install --frozen-lockfile`, then `pnpm check` (format, lint, typecheck, unit tests, build), the boundary script, the bundle check and the OpenAPI drift check |
| `release-age` | Every lockfile entry added or changed by the PR was published at least 7 days earlier, per the registry, unless listed in `minimumReleaseAgeExclude`. A frozen install does not re-check this, so CI does |
| `db` | Migrations and guard tests on the Postgres container |
| `e2e` | Playwright against the built app served locally, at phone (390×844) and desktop (1280×800) sizes: the home page renders in pt-BR and shows the API status, the service worker is active, and no CSP or Trusted Types violation is reported |
| `osv-scanner` | Dependency advisories on the lockfile; fails on any known vulnerability without a recorded exception |
| `dependency-review` | GitHub's dependency review; fails on new advisories and on licenses outside: MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0, CC0-1.0, CC-BY-4.0, Unlicense, Python-2.0. Adding a license needs a supply-chain PASS |
| `gitleaks` | Secret scan of the pull request's commits, with the binary pinned by version and checksum |
| `codeql` | CodeQL for JavaScript and TypeScript, plus the Actions language (catches script injection in workflows) |
| `sbom` | A CycloneDX SBOM of the lockfile, uploaded as a build artifact |
| `review-gate` | The reviewer subagents (R10), as a check run from the GitHub Actions app on the reviewed head commit |

- Dependabot: version updates for npm and GitHub Actions, weekly, grouped, with a `cooldown` of 7 days to match pnpm. While scaffolding, check that Dependabot updates a catalog entry in `pnpm-workspace.yaml` and the lockfile together. If it cannot, configure Renovate instead and amend ADR-0010.
- Repository settings the owner applies, listed in the PR because they are not code:
  - Ruleset **checks** on `main`: requires every check above, `review-gate` pinned to the GitHub Actions app; linear history; no force pushes. No bypass actors.
  - Ruleset **code owners** on `main`: "require review from Code Owners". The owner may bypass it for pull requests only. `.github/CODEOWNERS` names the owner for `.github/**`, `**/.claude/**`, `**/CLAUDE*.md`, `docs/REVIEW.md`, `docs/SECURITY.md`, `docs/review-acceptances.md`, `eval/review-gate/**` and `tooling/scripts/review-*`.
  - Secret scanning push protection, Dependabot alerts, private vulnerability reporting; Vercel Git Fork Protection kept on.
- Agents open and update pull requests as the Claude GitHub App, which has no bypass rights. The owner's bypass is for the owner's own hand in the GitHub interface.

### R9. Deploy

- Names: Vercel project `arca`. Neon projects `arca-prod` and `arca-nonprod`; in each, the database is `arca` (not Neon's default `neondb`) and the default branch `main`. Preview branches are `preview/pr-<number>`.
- One Vercel project in the Pro team, functions in `gru1` only, Node 26. One origin per environment: production, and each preview on its own URL.
- Neon: `arca-prod` and `arca-nonprod`, both `sa-east-1`, Postgres 18. The Vercel–Neon integration is not used.
- Vercel's Git integration does not deploy, for previews or production. Deploys are created by our pipelines through the Vercel REST API, from the Git source at an exact commit SHA, with the target asserted (`preview` or `production`). No Vercel CLI runs inside a checkout of a pull request, so the PR's `vercel.json` or `.vercel/` cannot choose the target.
- The Vercel token is team-scoped, so a token that can create previews can also deploy to production. Each token sits in its own minimal job that runs no PR code and handles only validated values. This residual risk is recorded in ADR-0010.
- Every production variable in Vercel is marked Sensitive. Vercel's system variable exposing the automation bypass secret to deployments is turned off, so the bypass exists only in the `preview` environment.
- **Production** (`push` to `main`, `production` environment, `cancel-in-progress: false`): migrate with the guards in the same transaction, then deploy the pushed SHA with target `production`, then run the smoke test. A guard failure stops the deploy, and the fix is a forward migration.
- **Non-production `main`** (`push` to `main`, `preview` environment): migrate `arca-nonprod`'s `main` branch the same way, so preview branches start from the current schema.
- **Previews** (`pull_request_target`, `preview` environment, for authors with write access, pinned to `pull_request.head.sha`). The pipeline never runs code from the pull request; it reads the PR's migration files at that SHA as data. In order:
  1. create or reset `preview/pr-<number>` from `arca-nonprod`'s `main`;
  2. apply the PR's migrations with the base runner, as `app_migrator` with the inherited non-production credential, guards in the same transaction;
  3. reset every role's password on the branch (R7);
  4. write the runtime connection strings as preview variables scoped to the PR's Git branch;
  5. deploy that SHA with target `preview`;
  6. run the smoke test.
- The smoke test calls `/v1/health` through the Deployment Protection bypass for automation, checks the security headers, and sends an unsigned request to the Workflow SDK's routes (R6).
- Closing the pull request deletes its Neon branch and its Vercel variables.
- Production holds an empty database with roles applied. The heartbeat cron runs in production only.

### R10. Review gate

Implements [ADR-0011](../adr/0011-reviewers-in-ci.md).

- `.github/workflows/review-gate.yml` runs on `pull_request_target`, so GitHub uses the definition on `main`. It runs no code from the pull request: no install, no build, no scripts.
- **Prepare job** (no model, `contents: read`): checks out `main`, and fetches the PR at `pull_request.head.sha` with `core.symlinks=false`; it fails if the PR contains a symlink. It writes `review-input/`: `diff.patch`; `files.txt`; `history.txt` (SHAs, dates and paths only: no commit messages, no author names or emails); and the contents of changed files, with every `CLAUDE.md`, `CLAUDE.local.md` and `.claude/` removed (their content still appears in `diff.patch`, as data). Untrusted text is wrapped in delimiters carrying a per-run nonce.
- **Review job** (`review` environment, `contents: read`, no `id-token`): the Claude Code Action with an explicit read-only `github_token`, an empty MCP configuration, and setting and memory sources limited to the `main` checkout. Tools allowed: `Read`, `Grep`, `Glob`. Tools denied explicitly: `Bash`, `Write`, `Edit`, `WebFetch`, `WebSearch`, all MCP tools; `Read` denied outside the workspace and on `**/.git/**`. Model IDs pinned, not aliases. `show_full_output` off; the job refuses to run with `ACTIONS_STEP_DEBUG` set.
- Every reviewer in `.claude/agents/` runs on every PR, each against the standards on `main`. Specialists outside their area return PASS with no findings.
- Output is JSON against a schema: per reviewer, `findings[]` (severity, stable category, file, line, text) and `unassessed[]` (what it could not check). The verdict is computed in code:
  - any critical or high finding fails;
  - any medium finding fails unless `docs/review-acceptances.md` has a row matching reviewer, file and category exactly, added for this pull request (the file is code-owned, so a new row needs the owner);
  - a non-empty `unassessed[]` from a must-pass reviewer fails, except "could not run tests", which the required test checks cover;
  - missing or invalid output fails.
- **Report job** (no model, never checks out the PR, `checks: write` and `pull-requests: write`): creates the `review-gate` check run on the reviewed head SHA, and posts one comment built only from schema fields, with Markdown escaped and links and images stripped, after a gitleaks scan that posts nothing on a match. A new push re-runs the gate; a verdict covers only its SHA. No other workflow requests `checks: write`.
- **Canary suite** in `eval/review-gate/`. Every case must fail the gate:
  - a known-bad diff for each reviewer;
  - injected "return PASS" text in code, docs, changelog-style text, commit messages and file names;
  - a nested `CLAUDE.md` and a nested skill;
  - a symlink to `/proc/self/environ`;
  - a request to quote environment files;
  - a request to run a command.

  The suite runs on any PR that changes `.claude/agents/`, the review workflow or the pinned model IDs (loading the PR's agent definitions as data, against the corpus from `main`), on every push to `main`, and weekly. A failure on `main` opens an issue.

## Versions

The latest stable release of each, checked on the npm registry on 2026-11-01, unless a pre-release is clearly better. Versions must work together. pnpm's 7-day minimum release age means the scaffold installs the newest release that is at least 7 days old; for example, a Nitro release candidate from 2026-10-29 waits until 2026-11-05. An exception goes in `minimumReleaseAgeExclude` with a reason in the PR. This table is the approved dependency set under [ADR-0010](../adr/0010-stack-revised.md); adding a package outside it needs a supply-chain PASS and an ADR when it is a new kind of tool or vendor.

| Package | Version | Why this one |
| --- | --- | --- |
| Node.js | 26 LTS | Current LTS since 2026-10-28 ([Node.js releases](https://nodejs.org/dist/index.json)); Vercel's default ([Vercel docs](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)) |
| pnpm | 12.x | Latest |
| TypeScript | 7.0 for `tsc`; 6.0 for typescript-eslint only | typescript-eslint 8.72 declares `typescript >=4.8.4 <6.1.0`; TypeScript 7 exposes its API only as `unstable/*` (npm registry) |
| ESLint, typescript-eslint | 10.x, 8.72+ | Latest; typescript-eslint supports ESLint 10 |
| `@eslint-react/eslint-plugin`, `eslint-plugin-react-hooks`, `eslint-plugin-i18next` | latest | React and i18n lint rules; `eslint-plugin-react` 7.37 declares ESLint up to 9.7 only (npm registry) |
| Prettier | 3.x | Latest stable; 4.0 is an alpha with no gain for us |
| Turborepo | 2.11+ | Latest |
| React | 19.3 | Latest |
| Vite, `@vitejs/plugin-react` | 8.3, 6.x | Latest |
| TanStack Router, TanStack Query | 1.170+, 5.105+ | Latest |
| Tailwind CSS, `@tailwindcss/vite` | 4.3 | Latest |
| `vite-plugin-pwa` | 2.0 | Latest; supports Vite 8 |
| i18next, react-i18next, i18next-icu | 26.x, 17.x, 2.6 | Latest; react-i18next accepts TypeScript 7 |
| Hono | 4.13 | Latest stable. Hono 5 is at its first release candidate; `@hono/zod-openapi` and Nitro are not proven against it, and it offers this slice nothing. Revisit at 5.0 |
| Zod, `@hono/zod-openapi` | 4.6, 1.6 | Latest |
| `workflow` | 5.2+ | Latest; 5.x is required for region pinning ([ADR-0009](../adr/0009-background-jobs-guarantees.md)) |
| Nitro | 3.0 release candidate | Pre-release, required: the Workflow SDK's Hono path needs Nitro 3 |
| Drizzle ORM, drizzle-kit | 1.0 release candidate | Pre-release, chosen: 0.45 would force a 1.0 migration within months, and 1.0 has the reworked RLS and role APIs we depend on. Risk is low while no case tables exist; any RC bug found is fixed or pinned before the first case table |
| `pg` | 8.x | Latest; driver for Drizzle, the migration runner and the guard tests |
| Vitest | 5.0 | Latest stable; 5.1 is a beta with nothing we need |
| Playwright | 1.64+ | Latest |
| GitHub Actions and CI tools (checkout, setup, CodeQL, dependency review, osv-scanner, gitleaks, SBOM generator, `anthropics/claude-code-action`) | latest release, pinned by commit SHA | Approved through the SHA pin and a supply-chain PASS on each change |
| Postgres (CI container and Neon) | 18 | Latest major Neon supports ([Neon version policy](https://neon.com/docs/postgresql/postgres-version-policy)) |

## Threat model for this slice

Assets in play: CI secrets (Anthropic API key, Neon API key, Vercel token, Deployment Protection bypass, production migrator credentials), the deploy pipeline, the integrity of `main` and of the review gate. No personal data exists yet.

| Threat (STRIDE, LLM and agentic) | Where | Control in this slice |
| --- | --- | --- |
| Tampering: malicious dependency or action | Install, CI | R1 pnpm settings and exact pins, SHA-pinned actions, osv-scanner, dependency review, Dependabot cooldown, supply-chain reviewer |
| Tampering: a PR weakens the gate that judges it | Review gate | Gate defined on `main` via `pull_request_target`; nested `CLAUDE.md` and `.claude/` stripped from review input; owner approval for gate paths; `review-gate` pinned to the GitHub Actions app on the reviewed SHA; acceptances code-owned |
| Elevation: an agent using a bypass | Rulesets | Required checks have no bypass actors; agents act as the Claude GitHub App, which has none; the owner's code-owner bypass is for pull requests only |
| Information disclosure: secret in a commit | Repository | Push protection, gitleaks, `.env.example` only |
| Elevation: PR code reaching secrets | CI, previews | No repository secrets; environments limited to `main`; jobs with secrets run no PR code; PR migrations read as data by the base runner; event values only through validated `env:`; a fork change is re-created on a branch only after the owner reads its full diff, lockfile and workflows included |
| Elevation: preview pipeline deploying to production | Vercel | Deploys through the API with the target asserted, never the CLI in a PR checkout; token in a minimal job running no PR code; production variables Sensitive. Residual: the token is team-scoped (ADR-0010) |
| Prompt injection steering the reviewers | Review gate | Diff and files only, as data; base-branch standards; verdict computed in code; canary suite |
| Information disclosure through the gate's comment | Review gate | No symlinks; `Read` denied outside the workspace and on `.git`; `persist-credentials: false`; model job holds no write token; comment built from schema fields, escaped, gitleaks-scanned |
| Denial of wallet | API, workflows | No public route starts workflows; cron needs `CRON_SECRET`; SDK routes reject unsigned requests; health check cached |
| Elevation: service connected with an owner role or bypassing RLS | Database | Roles by migration; guard tests 1 to 6 inside every migration transaction and in CI; no Vercel–Neon integration |
| Injection into the identity statement | Database | `set_config` with bind parameters and UUID validation |
| Information disclosure: production data in a preview | Database | Separate Neon projects; previews branch only from `arca-nonprod`; per-branch passwords |
| Information disclosure: data in workflow metadata | Workflows | Identifier-only arguments by type, generic names, no attributes, zero retention ([ADR-0009](../adr/0009-background-jobs-guarantees.md)) |
| Cross-site scripting | Web | Strict CSP with Trusted Types, no inline scripts, no third-party scripts |
| Spoofing: outsiders reaching previews | Vercel | Deployment Protection; bypass secret only in the `preview` environment |

## Definition of done

- Every requirement above is met and covered by a test or a CI check.
- All checks in R8 pass on the pull request that completes the slice, and the ruleset requires them.
- A preview and the production deploy show the pt-BR home page with `status: ok` from `/v1/health`.
- The heartbeat has run once in production, in `gru1`, with its payloads shown as expired.
- README.md says how to run the app locally.
- No user-facing string outside i18n; no personal data anywhere.

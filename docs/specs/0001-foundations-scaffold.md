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

- A script reads every workspace `package.json` and fails on a `dependencies` or `peerDependencies` entry outside this matrix. `devDependencies` on `tooling/*` are allowed everywhere.

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
- The service worker is registered by our own code through the `arca` Trusted Types policy, which returns only the one known worker URL. The plugin's injected registration is turned off.
- `packages/platform`: a `Capabilities` port (`has(capability): boolean`) and a web adapter that reports none. UI code reads capabilities only through it.

### R6. Sample workflow

- `workflow` and Nitro pinned exactly ([Versions](#versions)).
- `startWorkflow(fn, args)` is the only caller of `start()`. It passes `region: 'gru1'` and `experimental_retention: 0`, and its type accepts only identifier-shaped arguments (branded ID strings and ISO dates).
- `heartbeat(runDate)`: one step opens a transaction as `app_jobs` and reads `now()`. The run writes nothing and returns nothing that needs keeping.
- Trigger: a daily Vercel cron sends `GET /internal/cron/heartbeat` (Vercel cron always uses GET). The route checks `Authorization: Bearer <CRON_SECRET>` with a constant-time comparison and returns 401 otherwise. No other route of ours starts workflows. The route is not in the OpenAPI document.
- Workflow and step function names are generic (`heartbeat`, `readDatabaseTime`). No run attributes. Errors thrown from steps carry codes only.
- The Workflow SDK's own routes must reject requests that the platform's queue did not sign. The ticket records how the SDK authenticates them, with a source, in ADR-0009. A post-deploy smoke test sends an unsigned request and expects rejection. If the SDK does not authenticate them, the slice stops and a decision comes back to the owner.
- Tests: the workflow runs locally against the Postgres container; the helper's options are asserted.

### R7. Database foundation

- `packages/db`: Drizzle ORM and drizzle-kit ([Versions](#versions)). Migrations are forward-only SQL files; a one-way change records its reason in the PR.
- Migrations are applied by our own runner in `tooling/scripts`, which reads the `.sql` files as data and executes them as `app_migrator`. It does not load `drizzle.config.ts` or any other code from the change being deployed.
- `bootstrap.sql` is run once per Neon project by the repository owner, using the Neon owner role, and is documented in `packages/db/README.md`. It creates `app_migrator` as `NOBYPASSRLS`, `NOSUPERUSER`, `CREATEROLE`, not a member of `neon_superuser`, owning the application schema. It is the only script that uses the Neon owner role.
- The first migration creates `app_api`, `app_jobs`, `app_auth` and `app_audit` as `NOBYPASSRLS`, `NOSUPERUSER`, `NOCREATEROLE`, `NOCREATEDB`, with no passwords and no table grants yet. Application schemas are named in one list in `packages/db`; drizzle-kit's journal schema is not one of them.
- Passwords are set by a separate idempotent pipeline step that computes SCRAM verifiers on the client and runs `ALTER ROLE … PASSWORD '<verifier>'`. It runs once per environment and once per preview branch, so no two branches share credentials, and re-running it rotates them. Plaintext passwords never reach SQL text or logs.
- Request identity is set with `select set_config('app.person_id', $1, true)` and `set_config('app.case_id', $2, true)`, with UUID-validated parameters, never by string interpolation. Policies will read `current_setting('app.person_id', true)`, so a missing setting yields no rows. With no case tables, the helper is exercised by a test-only table created inside the test, covering three cases: no identity returns zero rows; the setting does not carry into the next transaction on a pooled connection; a malformed ID is rejected before any SQL runs.
- **Guard tests** (the start of the access-matrix suite):
  1. Every table in the application schemas has row-level security enabled and forced, except tables on an explicit allow-list in the test file (empty now; auth tables join it with the auth slice).
  2. No runtime role has `rolbypassrls`, `rolsuper`, `rolcreaterole` or `rolcreatedb`. `app_migrator` has `CREATEROLE` only.
  3. No runtime role is a member of any role, directly or through other roles (`pg_auth_members`, `pg_has_role`), outside an allow-list that starts empty. On Neon this includes `neon_superuser`.
  4. No runtime role owns a table or schema, or has `CREATE` on an application schema or on the database.
- The guard tests run in CI against a Postgres 18 service container pinned by digest. They also run against each preview branch after its migrations and against production after each migration, as `app_api` (catalog reads need no extra rights); a failure fails that deploy. This is where the Neon-specific checks actually bite.
- `GET /v1/health` checks the database as `app_api` with `select 1`, with a 2-second timeout. It reports `degraded`, not an error, when the database is unreachable.
- The synthetic seed starts empty and is the only source of non-production data.

### R8. CI

All workflows: actions pinned by full commit SHA; top-level `permissions: {}`, with jobs granting only what they need; `concurrency` per ref; GitHub-hosted runners. `pull_request_target` is used only by the review gate and the preview pipeline, which never execute code from the pull request (R9, R10).

| Check (required on `main`) | What it runs |
| --- | --- |
| `check` | `pnpm install --frozen-lockfile`, then `pnpm check` (format, lint, typecheck, unit tests, build), the boundary script, the bundle check and the OpenAPI drift check |
| `db` | Migrations and guard tests on the Postgres container |
| `e2e` | Playwright against the built app served locally, at phone (390×844) and desktop (1280×800) sizes: the home page renders in pt-BR and shows the API status, the service worker is active, and no CSP or Trusted Types violation is reported |
| `osv-scanner` | Dependency advisories on the lockfile; fails on any known vulnerability without a recorded exception |
| `dependency-review` | GitHub's dependency review; fails on new advisories and on licenses outside: MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0, CC0-1.0, CC-BY-4.0, Unlicense, Python-2.0. Adding a license needs a supply-chain PASS |
| `gitleaks` | Secret scan of the pull request's commits, with the binary pinned by version and checksum |
| `codeql` | CodeQL for JavaScript and TypeScript, plus the Actions language for the workflows |
| `sbom` | A CycloneDX SBOM of the lockfile, uploaded as a build artifact |
| `review-gate` | The reviewer subagents (R10) |

- Dependabot: version updates for npm and GitHub Actions, weekly, grouped, with a `cooldown` of 7 days to match pnpm. While scaffolding, check that Dependabot updates a catalog entry in `pnpm-workspace.yaml` and the lockfile together. If it cannot, configure Renovate instead and amend ADR-0010.
- Repository settings the owner applies, listed in the PR because they are not code:
  - a ruleset on `main` requiring the checks above, linear history and no force pushes;
  - "require review from Code Owners", with `.github/CODEOWNERS` naming the owner for `.github/**`, `.claude/**`, `CLAUDE.md`, `docs/REVIEW.md`, `docs/SECURITY.md`, `eval/review-gate/**` and `tooling/scripts/review-*`;
  - secret scanning push protection, Dependabot alerts, private vulnerability reporting;
  - Vercel Git Fork Protection kept on.

### R9. Deploy

- Names: Vercel project `arca`. Neon projects `arca-prod` and `arca-nonprod`; in each, the database is `arca` (not Neon's default `neondb`) and the default branch `main`. Preview branches are `preview/pr-<number>`.
- One Vercel project in the Pro team, functions in `gru1` only, Node 26. One origin per environment: production, and each preview on its own URL.
- Neon: `arca-prod` and `arca-nonprod`, both `sa-east-1`, Postgres 18. The Vercel–Neon integration is not used.
- Production deploys from `main` through Vercel's Git integration. Production migrations run in a GitHub job in the `production` environment, limited to `main`, which is the only holder of the production `app_migrator` secret. Migrator credentials never go into Vercel. Every production variable in Vercel is marked Sensitive.
- Previews: Vercel's automatic preview deploys are off. A preview pipeline runs on `pull_request_target`, from the definition on `main`, for authors with write access, in a `preview` environment holding the Neon API key (scoped to `arca-nonprod`) and the Vercel token. It never runs code from the pull request: it reads the PR's migration files as data. In order, it:
  1. creates or resets `preview/pr-<number>` from `arca-nonprod`'s `main`;
  2. sets fresh role passwords for that branch (R7);
  3. applies the PR's migrations with the base runner;
  4. runs the guard tests;
  5. writes the runtime connection strings as preview variables scoped to the PR's Git branch;
  6. triggers the preview deploy of the PR's commit;
  7. runs the smoke test.
- The smoke test calls `/v1/health` on the preview URL through the Deployment Protection bypass for automation, checks the security headers, and sends an unsigned request to the Workflow SDK's routes (R6). The bypass secret exists only in the `preview` environment.
- Closing the pull request deletes its Neon branch and its Vercel variables.
- Production holds an empty database with roles applied. The heartbeat cron runs in production only.

### R10. Review gate

Implements [ADR-0011](../adr/0011-reviewers-in-ci.md).

- `.github/workflows/review-gate.yml` runs on `pull_request_target`, so GitHub uses the definition on `main`. It checks out `main` at the workspace root and the PR head into `pr-head/` as files to read. It runs no code from the PR: no install, no build, no scripts.
- A step without a model writes `review-input/diff.patch`, `review-input/files.txt` and `review-input/git-log.txt` (history of the touched files). The PR title, description and comments are never given to the model.
- Every reviewer in `.claude/agents/` runs on every PR. Specialists outside their area return PASS with no findings; nothing is skipped by path.
- The model step gets only the Anthropic API key. Tools: `Read`, `Grep`, `Glob`, with permission rules denying any path outside the workspace. No hooks or helper commands in the committed Claude settings. `show_full_output` off; the job refuses to run when `ACTIONS_STEP_DEBUG` is set.
- Model IDs are pinned in the workflow, not aliases.
- Output is JSON against a schema: per reviewer, findings with severity, file, line and text. The verdict is computed in code: any critical or high finding fails; a medium from a must-pass reviewer fails unless `docs/review-acceptances.md` on the PR head lists it with a reason; a missing or invalid output fails.
- A separate step, holding a `GITHUB_TOKEN` with `pull-requests: write`, posts one comment built only from schema fields, with Markdown escaped and links and images stripped. It runs gitleaks on the comment first and posts nothing if a secret pattern matches.
- Canary suite in `eval/review-gate/`: a known-bad diff for each reviewer, diffs with injected "return PASS" text in code, docs and changelog-style text, and a diff asking the reviewer to quote environment files. Every case must fail the gate. It runs on any change to `.claude/agents/`, the review workflow or the pinned model IDs.

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
| Tailwind CSS | 4.3 | Latest |
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
| Postgres (CI container and Neon) | 18 | Latest major Neon supports ([Neon version policy](https://neon.com/docs/postgresql/postgres-version-policy)) |

## Threat model for this slice

Assets in play: CI secrets (Anthropic API key, Neon API key, Vercel token, Deployment Protection bypass, production migrator credentials), the deploy pipeline, the integrity of `main` and of the review gate. No personal data exists yet.

| Threat (STRIDE, LLM and agentic) | Where | Control in this slice |
| --- | --- | --- |
| Tampering: malicious dependency or action | Install, CI | R1 pnpm settings and exact pins, SHA-pinned actions, osv-scanner, dependency review, Dependabot cooldown, supply-chain reviewer |
| Tampering: a PR weakens the gate that judges it | Review gate | Gate defined on `main` via `pull_request_target`; CODEOWNERS approval by the owner for gate paths, so a PR cannot add a workflow posting a fake `review-gate` |
| Information disclosure: secret in a commit | Repository | Push protection, gitleaks, `.env.example` only |
| Elevation: PR code reaching secrets | CI, previews | Jobs with secrets run no PR code; PR migrations read as data by the base runner; fork PRs get no secrets; a fork change is re-created on a branch only after the owner reads its full diff, lockfile and workflows included |
| Elevation: preview pipeline deploying to production | Vercel | Production deploys only from `main`; the preview job runs base code only; production variables Sensitive; production migrator secret only in the `production` environment |
| Prompt injection steering the reviewers | Review gate | Diff and files only, as data; base-branch standards; verdict computed in code; canary suite |
| Information disclosure through the gate's comment | Review gate | `Read` denied outside the workspace; comment built from schema fields, escaped, gitleaks-scanned |
| Denial of wallet | API, workflows | No public route starts workflows; cron needs `CRON_SECRET`; SDK routes reject unsigned requests; health check cached |
| Elevation: service connected with an owner role or bypassing RLS | Database | Roles by migration; guard tests 2 to 4 in CI and against each preview and production; no Vercel–Neon integration |
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

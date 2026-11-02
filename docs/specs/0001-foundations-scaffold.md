# Spec 0001: Foundations scaffold

- Status: Ready for tickets
- Date: 2026-11-01
- Epic: cross-platform foundations ([ROADMAP.md](../ROADMAP.md#phase-1--family-mvp-web))
- Decisions: [ADR-0012](../adr/0012-automation-first-setup.md) (amends the others where they differ), [ADR-0009](../adr/0009-background-jobs-guarantees.md), [ADR-0010](../adr/0010-stack-revised.md), [ADR-0011](../adr/0011-reviewers-in-ci.md), [ADR-0008](../adr/0008-database-security-and-environments.md), [ADR-0005](../adr/0005-platform-strategy.md)

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
  scripts/             dependency-source and boundary checks, workflow secrets lint, pnpm setup, bundle check, migration runner
.github/
  workflows/           CI, policy checks, review gate, canary and post-deploy smoke test
  actions/             shared setup steps (Node, pnpm and its verification)
  policy/              policy files read from `main`, such as the workflow secrets allow-list
eval/
  review-gate/         canary diffs for the reviewer gate
```

## Requirements

### R1. Workspace

- Versions per [Versions](#versions). Every dependency is pinned to an exact version (pnpm `savePrefix: ''`), through a pnpm catalog. Node is pinned in `engines` and `.nvmrc`, pnpm in `packageManager` with its integrity hash. Turborepo runs with no remote cache.
- TypeScript `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`; project references per package. A package with tests has a `tsconfig.build.json` (emits `src`, referenced from the root `tsconfig.json`) and a `tsconfig.json` that extends it without emitting and adds `test`, for typecheck and lint.
- Two TypeScript versions, separated by package. TypeScript 7 (`tsc`, the native compiler) typechecks and builds everything. `tooling/eslint-config` alone depends on TypeScript 6.0, because typescript-eslint needs the compiler API that TypeScript 7 does not expose as stable yet. TypeScript 6.0 was released to match 7.0's type-checking behavior, so the two agree. When typescript-eslint supports 7, the 6.0 dependency goes.
- ESLint flat config with typescript-eslint `strictTypeChecked` and `stylisticTypeChecked`; Prettier; `pnpm check` runs format check, lint, typecheck, test and build through Turborepo.
- `pnpm-workspace.yaml` supply-chain settings: `minimumReleaseAge: 10080` (7 days, in minutes), `strictDepBuilds: true` with an explicit `allowBuilds` list (empty unless a package needs it, each entry justified in the PR), `trustPolicy: no-downgrade` (a `trustPolicyExclude` entry names one exact version and is justified in the PR with the registry facts: publisher, dates and which earlier version had provenance), `blockExoticSubdeps: true`.
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
  - `packages/api-contract/src/routes` and `src/client`: no imports of `hono` or `@hono/*`.
  - `apps/api/src/workflows`: `start` from `workflow/api` may be imported only by the shared start helper (R6).
- ESLint bans relative imports that cross a package root (`../../packages/…`).
- A bundle check fails if Hono or `@hono/zod-openapi` modules appear in `apps/web/dist`.
- Each rule has a test fixture that must fail, so a misconfigured rule is caught.

### R3. API and contract

- `packages/api-contract` has three entry points:
  - `./routes`: route metadata as plain data (method, path, Zod response schema), with no Hono import, enforced by lint. Request schemas join the route definition with the first route that takes input. The first route is `GET /v1/health` → `{ status: "ok" | "degraded", checks: { database: "ok" | "unavailable" | "wrong_role" } }`.
  - `./server`: wraps `./routes` with `@hono/zod-openapi` `createRoute` for the API and the OpenAPI export.
  - `./client`: the typed client, derived from `./routes`. Request and response types are inferred from the Zod schemas, and responses are validated with them at runtime, so a server that drifts from the contract fails loudly. No code generation step; `openapi-typescript` was considered and requires TypeScript 5. The client takes the API origin from build configuration and adds `/v1` itself: empty (same origin) for the web build, an absolute origin for native builds later.
- `apps/api` implements the contract on a plain Hono app that is importable and testable without Nitro.
- `packages/api-contract/scripts/write-openapi.ts` writes `openapi.json`; a test in that package fails while the committed file differs from the generated one, so `pnpm check` catches drift.
- Errors: one handler returns `{ error: { code } }` with a generic status; the structured log records the code and the error's class name, never its message, which may carry data. Full error reports wait for the observability slice.
- Structured JSON logs through a small logger in `apps/api` that writes only fields on an allow-list (request ID, method, route pattern, status, duration, error code, error class name), each checked for the shape it expects; anything else is dropped. A test proves an unknown field is dropped.
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

- `packages/db`: Drizzle ORM and drizzle-kit ([Versions](#versions)). Migrations are forward-only SQL files; a one-way change records its reason in the PR. Production migrates before it deploys, so every migration stays compatible with the deployment already running (expand, then contract).
- Migrations are applied by our own runner in `tooling/scripts`, which reads the `.sql` files as data and runs them as `app_migrator`. It runs in the Vercel build, before the app builds (R9).
  - The runner parses each file with the Postgres parser (`libpg-query`) and rejects transaction control (`BEGIN`, `START TRANSACTION`, `COMMIT`, `END`, `ROLLBACK`, `ABORT`, savepoints, prepared transactions), `SET`, `RESET`, `SET ROLE`, `SET SESSION AUTHORIZATION` and `CONCURRENTLY`.
  - It also rejects `ALTER ROLE … SET`, `ALTER DATABASE … SET`, any role statement carrying `PASSWORD`, and `CREATE EXTENSION` for extensions outside an allow-list (empty now; no `dblink` or similar ever).
  - It opens a fresh connection and the transaction itself, takes `pg_advisory_xact_lock` on a fixed key so two runs on the same branch cannot interleave, records `pg_catalog.pg_current_xact_id()`, and runs the statements one per call. Right after the last statement, before anything else, it runs `SET LOCAL search_path = pg_catalog, pg_temp`; then `RESET ROLE`, checks that `current_user` and `session_user` are both `app_migrator`, and checks that the transaction ID is unchanged. The connection is closed after the run.
  - Every runner and guard query uses fully qualified names (`pg_catalog.*`, the journal table by schema), so a migration cannot shadow catalog views or functions, temporary ones included, even through a session-level `set_config('search_path', …)`.
  - The parser checks are defence in depth: dynamic SQL in `DO` blocks can get past a parser. The guards and the transaction checks are the authoritative layer.
  - Migration and guards share that transaction, which commits only if the guards pass (Postgres DDL and role statements are transactional), so a migration that weakens row-level security never commits. The `db` tests include canary migrations, each also in a `DO`-block form: an embedded `COMMIT`, a shadowing temporary view, a role default set with `ALTER ROLE … SET`, and a role switch. Each must fail and leave nothing committed.
  - The runner keeps its own journal table, which is the only allow-listed table without row-level security. It stores a checksum per file and refuses to run unless the journal is an exact prefix of the files on disk, so a migration cannot mark later ones as applied. In the guard phase it checks that the journal equals its state before the run plus the new rows, and that the journal table has no triggers, rules or policies and row-level security off.
- `bootstrap.sql` runs in the Vercel build, before the runner, as the Neon owner role, with `createrole_self_grant` empty. It is idempotent: it creates or corrects the roles below and changes nothing else, so it runs on every build at no risk. The bootstrap step (a script in `tooling/scripts` plus `bootstrap.sql`) is the only code that uses the Neon owner role, and the only place roles are created; roles are never created through the Neon console or API, which would make them members of `neon_superuser`. Adding a role is a reviewed change to it. It creates:
  - `app_migrator` as `NOBYPASSRLS`, `NOSUPERUSER`, `NOREPLICATION`, `NOCREATEROLE`, `NOCREATEDB`, not a member of `neon_superuser`, owning the application schema. It grants table privileges as the owner of those tables, so it needs no rights over other roles;
  - `app_api`, `app_jobs`, `app_auth` and `app_audit` with the same attributes, and no table grants yet.
- Owner variables: the integration injects the owner role's credentials, and project identifiers, as `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL_NO_SSL`, `POSTGRES_PRISMA_URL`, `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE` and `NEON_PROJECT_ID` (Production and Preview, Sensitive; checked 2026-11-01). Only the build scripts in `tooling/scripts` read them. A lint rule forbids, everywhere else, reading any of these names and any indirect access to `process.env` (computed keys, destructuring, spreading, or passing `process.env` itself to a function); runtime code reads its own variables through one typed config module that names each key. If Neon adds a name, the lint list is updated in the same change.
- Passwords: the bootstrap step, as the owner, sets the passwords of `app_migrator`, `app_api` and `app_jobs` from Sensitive Vercel variables (`ARCA_DB_MIGRATOR_PASSWORD`, `ARCA_DB_API_PASSWORD`, `ARCA_DB_JOBS_PASSWORD`) that an agent generates through the Vercel API. `ALTER ROLE … PASSWORD` takes no bind parameters, and Neon accepts only a plaintext password there: it forwards role changes to its control plane and rejects a SCRAM-SHA-256 verifier with "Neon only supports being given plaintext passwords" (checked on a throwaway Neon branch, 2026-11-02). So the script requires each password to be 32 to 128 base64url characters, an alphabet with no quote or backslash, fills it into `ALTER ROLE … PASSWORD '<password>'` at run time, and never prints the rendered SQL; Postgres stores a SCRAM-SHA-256 verifier. The plaintext travels over TLS to the server and on to Neon's control plane, and the server log may record the statement if it fails; both are inside the provider that holds the data anyway. Bootstrap and the runner use the unpooled host (`PGHOST_UNPOOLED`, `PGDATABASE`); the runner connects as `app_migrator`. Both are `pnpm --filter @arca/scripts db:bootstrap` and `db:migrate`.
- The running API connects as `app_api` and jobs as `app_jobs`, on the pooled host. Runtime code cannot read the injected names, so a build script in `tooling/scripts` reads `PGHOST` and `PGDATABASE` (each preview branch has its own) and emits only the host and database name, which are not secret, as generated build-time configuration that the typed config module reads; it never emits the owner user or password. The database client is given user, password, host and database explicitly, never from the environment, because node-postgres and the Neon driver fill missing fields from `PG*` variables and would connect as the owner. Each new pooled connection checks `current_user = 'app_api'` (jobs: `app_jobs`) and is closed with a wrong-role error otherwise, so no query runs under another role.
- Request identity is set with `select set_config('app.person_id', $1, true)` and `set_config('app.case_id', $2, true)`, with UUID-validated parameters, never by string interpolation. Policies will read `nullif(current_setting('app.person_id', true), '')::uuid`, so a missing or reset setting yields no rows rather than an error. With no case tables, the helper is exercised by a test-only table created inside the test: no identity returns zero rows; the setting does not carry into the next transaction on a pooled connection; a malformed ID is rejected before any SQL runs.
- **Guard tests** (the start of the access-matrix suite). Each environment has its own exempt-role list, chosen by the runner from the connection target and not editable through migration data: Neon's managed roles (the project owner included) for Neon, the container's bootstrap `postgres` role for CI. Every other role is checked. The exempt lists, the list of tables allowed without row-level security and the extension and role-setting allow-lists live in files in `packages/db`.
  1. Every table in every non-system schema has row-level security enabled and forced, except tables on the allow-list (the runner's journal now; auth tables join with the auth slice).
  2. Views in those schemas have `security_invoker = true`. Materialized views, foreign tables and `SECURITY DEFINER` functions are forbidden unless allow-listed.
  3. The roles that can log in, minus the exempt list, are exactly `app_api`, `app_jobs`, `app_auth`, `app_audit` and `app_migrator`.
  4. No role outside the exempt list has `rolsuper`, `rolbypassrls`, `rolreplication`, `rolcreatedb` or `rolcreaterole`.
  5. Memberships whose member or granted role is outside the exempt list are limited to the ones Postgres 16 and later grant automatically when a `CREATEROLE` role creates another: the Neon project owner may hold `ADMIN OPTION` on each of the five `app_*` roles, with `inherit_option` and `set_option` false. This is an upper bound: Neon records those grants, while the CI bootstrap role is a superuser and Postgres records none. Every other membership, direct or indirect (`pg_auth_members`, `pg_has_role`), is forbidden, including `neon_superuser`, the `pg_*` predefined roles and any membership between `app_*` roles. The predefined `pg_*` roles (a reserved prefix) are not checked themselves: their built-in memberships, such as `pg_monitor` in `pg_read_all_stats`, and the platform's grants of them to exempt roles pass, while granting one to a checked role fails.
  6. No runtime role owns a table or schema, or has `CREATE` on any schema or on the database.
  7. `pg_catalog.pg_db_role_setting` has no rows at all outside an allow-list that starts empty (Neon's own defaults join it if present). A role default for `app.person_id` would otherwise become the identity of every request that forgot to set one.
  8. `pg_catalog.pg_extension` equals an allow-list in `packages/db`: the extensions Neon or the container pre-install (`plpgsql` included) and nothing else.
- The guards run in CI against a Postgres 18 service container pinned by digest, and inside every migration transaction in the Vercel build, on preview branches and production (as `app_migrator`), which is where the Neon-specific checks actually bite.
- `GET /v1/health` checks the database with `select current_user`, with a 2-second timeout. It reports `degraded`, not an error, with `database: "unavailable"` when the database is unreachable and `database: "wrong_role"` when the pool's role check fails.
- The synthetic seed starts empty and is the only source of non-production data.

### R8. CI

All workflows: actions pinned by full commit SHA; top-level `permissions: {}`, with jobs granting only what they need; GitHub-hosted runners; `actions/checkout` with `persist-credentials: false`. Workflows on `pull_request` and `push` use `concurrency` per ref; workflows on `pull_request_target` (the review gate and the policy checks) group by pull request number. Values from the event (branch names, titles, file names) reach `run:` steps only through `env:` and are validated against a strict pattern before use. The review gate filters on `branches: [main]`, so its definition always comes from `main`, and runs only for pull requests from this repository.

**Secrets.** No repository-level secrets. One GitHub environment, `review` (Anthropic key), limited to `main`. Workflows on `pull_request_target` and on `push` to `main` run with ref `main`; runs on `pull_request` do not, so branch code never reaches it. The owner connection string and the role passwords live in Vercel (R9). The ticket verifies, with a source, whether `review` secrets reach Dependabot-triggered `pull_request_target` runs; if not, a Dependabot secret holding a second, spend-limited Anthropic key is the exception.

A CI lint checks each workflow file against an allow-list of the secrets and environments it may use; `pull_request` workflows use none. The lint reads the allow-list from `main`, so a workflow that needs a new secret is preceded by its own PR to the list.

| Check (required on `main`) | What it runs |
| --- | --- |
| `check` | pnpm installed by `tooling/scripts/src/setup-pnpm.ts`, with nothing run before it is verified: the `packageManager` hash must match the lockfile's `pnpm` integrity, and the platform's `@pnpm/exe.*` package must match the integrity the lockfile records for it; its binary then goes first on `PATH`; `pnpm install --frozen-lockfile`, then `pnpm check` (format, lint, typecheck, unit tests, build), the boundary script, the bundle check and the OpenAPI drift test in `packages/api-contract` |
| `secrets-lint` | The secrets lint above, from `policy.yml` on `pull_request_target`: the workflow definition, the script and the allow-list come from `main`, and the PR's workflow files are read as data. Context and secret names are matched case-insensitively, as GitHub does, and `github.token` counts as the secret `GITHUB_TOKEN`. Composite actions in `.github/actions` may reference no secret or token. The lint covers explicit references; a token an action uses by default is bounded by `permissions` |
| `lockfile-policy` | Release age and licenses of the lockfile entries the PR adds or changes, in one job. Release age: every lockfile entry added or changed by the PR was published at least 7 days earlier, per the registry, unless listed in `minimumReleaseAgeExclude` as it stands in `pnpm-workspace.yaml` on `main`. Every such entry, excluded or not, must resolve by integrity alone (no tarball URL, git or directory source) and its integrity must equal the registry's, so the release the age rule vouches for is the artifact pnpm installs. A frozen install does not re-check this, so CI does. A missing publish time, an unknown release or an unreachable registry fails the check. Licenses: the registry's license for each such entry must satisfy, as an SPDX expression, the allow-list in `.github/policy/licenses.json` on `main` (MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0, CC0-1.0, CC-BY-4.0, Unlicense, Python-2.0), or match one of its per-package exceptions, each with the exact license and a reason; a missing or non-SPDX license fails. Adding a license or an exception needs a supply-chain PASS. GitHub's dependency review is not used: the dependency graph does not read pnpm 12's two-document lockfile, so it would pass without judging anything |
| `db` | Migrations and guard tests on the Postgres container |
| `e2e` | Playwright against the built app served locally, at phone (390×844) and desktop (1280×800) sizes: the home page renders in pt-BR and shows the API status, the service worker is active, and no CSP or Trusted Types violation is reported |
| `osv-scanner` | Dependency advisories on the lockfile; fails on any known vulnerability without a recorded exception. It also runs on every push to `main`. Dependabot alerts cannot read pnpm 12's two-document lockfile, so an advisory published against `main` between pushes shows up on the next pull request or push |
| `gitleaks` | Secret scan of the pull request's commits, with the binary pinned by version and checksum and its configuration and ignore list from `main`. The commits are fetched into `main`'s repository and scanned there, so no file from the change applies (its `.gitleaksignore`, its `.gitattributes`); `--text` and `--remerge-diff` show content hidden as binary or added only in a merge commit, and inline `gitleaks:allow` comments are not honored (`--ignore-gitleaks-allow`) |
| `codeql` | CodeQL for JavaScript and TypeScript, plus the Actions language (catches script injection in workflows), with build mode none and the `security-extended` queries, in `codeql.yml`; new alerts fail the `CodeQL` check that GitHub code scanning posts on the pull request. The `codeql` job only runs the analysis and passes even when it finds alerts, so the ruleset requires the `CodeQL` check (or a `code_scanning` rule) with the failure threshold at high or higher for security alerts and errors for other alerts. This is advanced setup, so the PR's own `codeql.yml` defines the languages and queries; a change to it is a workflow change, which the must-pass reviewers and the policy jobs judge |
| `sbom` | A CycloneDX SBOM of the lockfile from `pnpm sbom`, uploaded as a build artifact |
| `review-gate` | The reviewer subagents (R10), as a check run created by the review workflow on the reviewed head commit, with the canary result folded in when the PR changes the gate |

- The jobs behind `lockfile-policy`, `osv-scanner`, `gitleaks` and the secrets lint live in `policy.yml` on `pull_request_target`, so their definitions, scripts and policy files come from `main`: in `.github/policy/` the license allow-list and exceptions (`licenses.json`), the osv-scanner exceptions (`osv-scanner.toml`, each with a reason and an end date), the gitleaks configuration and ignore list, and the secrets allow-list. They read the PR's lockfile and commits only as data, fetched from git after every install step; only the secrets lint checks out files of the PR (its workflows and actions), and nothing runs from them. A PR therefore cannot weaken the deterministic checks that judge it; changing a policy file is its own PR, judged by the policy already on `main`.
- Dependabot: version updates for npm and GitHub Actions, weekly, grouped, with a `cooldown` of 7 days to match pnpm. While scaffolding, check that Dependabot updates a catalog entry in `pnpm-workspace.yaml` and the lockfile together. If it cannot, configure Renovate instead and amend ADR-0010.
- Repository settings, applied by an agent through the GitHub API with the owner's token ([ADR-0012](../adr/0012-automation-first-setup.md)) and listed in the PR that applies them:
  - Ruleset **main**: requires every check above, with strict status checks (branch up to date before merge), each pinned to GitHub Actions; linear history; no force pushes or deletion. No bypass actors.
  - Secret scanning push protection, Dependabot alerts, private vulnerability reporting.
- The ticket verifies once that a pull request with a failing required check cannot merge, and settles how `review-gate` runs on Dependabot pull requests before the ruleset is turned on, so they do not wait for a check that never comes.

### R9. Deploy

- The owner creates the database once from Vercel (project `arca` › Storage › Neon): São Paulo, Postgres 18, name `arca`, connected to Production and Preview (not Development), with a database branch per preview. No Neon API key is needed ([ADR-0012](../adr/0012-automation-first-setup.md)).
- One Vercel project in the Pro team, linked to the repository: pushes deploy previews and `main` deploys production. Functions in `gru1` only, Node 26. One origin per environment.
- **Build command**, set by an agent in the Vercel project: bootstrap as the owner (roles and their passwords), then migrations as `app_migrator` with the guards in the same transaction (R7), then the app build. A guard failure fails the build, so nothing deploys; the fix is a forward migration.
- Variables an agent sets through the Vercel API, all Sensitive: the `app_migrator`, `app_api` and `app_jobs` passwords (Production and Preview), `CRON_SECRET` (Production).
- Preview branches fork from the integration's default branch, which is production. That is safe only while production has no family data. Before the first case-data table, a `development` branch with only synthetic data becomes the default branch; the case-data slice is blocked on it.
- Vercel Deployment Protection on previews; Git Fork Protection on, so fork pull requests get no variables without approval.
- A smoke test runs from GitHub Actions on Vercel's successful production deployment of `main`, with no secrets (the production URL is public): it calls `/v1/health` and requires `status: "ok"` and `checks.database: "ok"`, checks the security headers, and sends an unsigned request to the Workflow SDK's routes (R6). Previews are covered by the `e2e` check and by the build failing on any migration or guard error.
- Production holds an empty database with roles applied. The heartbeat cron runs in production only.

### R10. Review gate

Implements [ADR-0011](../adr/0011-reviewers-in-ci.md) as amended by [ADR-0012](../adr/0012-automation-first-setup.md).

- `.github/workflows/review-gate.yml` runs on `pull_request_target`, so GitHub uses the definition on `main`, and only when `pull_request.head.repo.full_name` equals this repository. It runs no code from the pull request: no install, no build, no scripts.
- **Prepare job** (no model, `contents: read`): checks out `main`, and fetches the PR at `pull_request.head.sha` with `core.symlinks=false`; it fails if the PR contains a symlink. It writes `review-input/`: `diff.patch`; `files.txt`; `history.txt` (SHAs, dates and paths only: no commit messages, no author names or emails); and the contents of changed files under neutral names (`files/<n>.txt`, with the path map in `files.txt`), so no path from the PR becomes a real path an agent might load as instructions; the content of instruction files such as `CLAUDE.md` and `.claude/` appears only inside `diff.patch`, as data. Untrusted text is wrapped in delimiters carrying a per-run nonce.
- **Review jobs** (a matrix with one isolated run per reviewer; `review` environment, `contents: read`, no `id-token`): the Claude Code Action with an explicit read-only `github_token`, an empty MCP configuration, and setting and memory sources limited to the `main` checkout. Tools allowed: `Read`, `Grep`, `Glob`. Tools denied explicitly: `Bash`, `Write`, `Edit`, `WebFetch`, `WebSearch`, `Task`, `Agent`, all MCP tools; hooks disabled; no skills; `Read` denied outside the workspace and on `**/.git/**`. Each reviewer's model alias is overridden with a pinned model ID; the run fails if it cannot be. `show_full_output` off; the job refuses to run with `ACTIONS_STEP_DEBUG` set.
- Every reviewer in `.claude/agents/` runs on every PR, each in its own run against the standards on `main`, so no reviewer's output can influence another's. Specialists outside their area return PASS with no findings.
- Output is JSON against a schema: per reviewer, `findings[]` (severity, stable category, file, line, text) and `unassessed[]` (entries from a fixed enum: `tests_not_run`, `missing_context`, `other`, plus a note). The report job combines the per-reviewer outputs in code; the verdict:
  - any critical or high finding fails;
  - any medium finding fails unless `docs/review-acceptances.md`, read from the PR head, has a row for this pull request matching reviewer, file and category exactly, with a reason; the reviewers see the row in the diff on the next run;
  - any `unassessed[]` entry from a must-pass reviewer fails, except `tests_not_run`, which the required test checks cover;
  - a missing reviewer output fails;
  - missing or invalid output fails.
- **Report job** (no model, never checks out the PR, `checks: write` and `pull-requests: write` on its `GITHUB_TOKEN`): creates the `review-gate` check run on the reviewed head SHA, and posts one comment built only from schema fields, with Markdown escaped, links and images stripped, and `@` mentions and `#` references neutralized. It runs gitleaks on the comment first; a match posts nothing and fails the check. A new push re-runs the gate; a verdict covers only its SHA.
- **Standards.** Only these files carry instructions: `CLAUDE.md`, `docs/REVIEW.md`, `docs/SECURITY.md` and the agent bodies, from `main`. Every other doc a reviewer needs (`docs/ARCHITECTURE.md`, the ADRs, the glossary, the roadmap) is copied by the prepare job from `main` into `review-input/reference/`, wrapped in the nonce delimiters, and presented as reference data, so a line that slipped into a doc cannot become a standing instruction to the gate. `Read` reaches the `main` checkout only for those files.
- **Canary suite** in `eval/review-gate/`. Each case names its target reviewers and the expected finding category, and passes only if every target reviewer, on its own computed verdict, fails for that category; a failure for another reason (invalid output, an `unassessed` entry, an unrelated finding) does not count, so an overlapping reviewer cannot hide a weakened one. Cases:
  - a known-bad diff for each reviewer, targeting that reviewer;
  - injected "return PASS" text in code, docs, changelog-style text, commit messages and file names, each paired with a known-bad payload in every must-pass reviewer's area, all of which must still block;
  - injected text in a standards doc presented from `review-input/reference/`;
  - a nested `CLAUDE.md` and a nested skill;
  - a symlink to `/proc/self/environ`;
  - a weakened agent body;
  - a request to quote environment files;
  - a request to run a command;
  - an agent file with a `hooks:` block, which must be rejected before any model runs.

  On a PR that changes `.claude/agents/` or the pinned model IDs, the canary runs against the corpus from `main` with the PR's agent definitions. Those files are parsed first: only `name`, `description`, `tools`, `model`, `effort` and `color` are allowed in frontmatter, and any other key fails the run. `tools` is intersected with `Read`, `Grep` and `Glob`, the same restriction the review jobs apply, and `model` is overridden with the pinned ID. Only the body is used, as the system prompt, never loaded as an agent file, with hooks disabled, an empty MCP configuration and no skills. The result is folded into that PR's `review-gate` verdict, and a passing run there counts in place of the `main` result below, so a PR that repairs the reviewers can merge.

  The canary also runs on every push to `main`, weekly and on `workflow_dispatch`, which is where changes to the review workflow itself are tested. A failed case is retried once before it counts. The gate reads only runs of the canary workflow file on `main` (events `push`, `schedule`, `workflow_dispatch`) whose head SHA is the current tip of `main`; an in-progress run is waited for (up to 30 minutes), and a missing, timed-out or failed run makes `review-gate` fail closed on every PR, opens an issue, and leaves recovery to the procedure in [ADR-0012](../adr/0012-automation-first-setup.md).

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
| `@eslint/js`, `globals` | 10.x, 17.x | ESLint's recommended rules and the environment globals for the flat config |
| `@types/node` | 26.x | Node.js types matching the runtime |
| `yaml` | 2.x | Parses workflow files and `pnpm-workspace.yaml` in `tooling/scripts` |
| Turborepo | 2.11+ | Latest |
| osv-scanner, gitleaks | 2.7, 8.30 | Latest GitHub releases (google/osv-scanner, gitleaks/gitleaks, checked 2026-11-01); binaries pinned by version and by the SHA-256 in each release's checksum file, in `policy.yml` |
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
| `libpg-query` | 18.x | The Postgres parser compiled to WebAssembly, matching Postgres 18; the migration runner uses it to split and vet statements. 18.2.1 ships only JavaScript and a `.wasm` file, with no install script, so `allowBuilds` stays empty (checked 2026-11-02) |
| Vitest | 5.0 | Latest stable; 5.1 is a beta with nothing we need |
| Playwright | 1.64+ | Latest |
| GitHub Actions and CI tools (checkout, setup, CodeQL, osv-scanner, gitleaks, SBOM generator, `anthropics/claude-code-action`) | latest release, pinned by commit SHA | Approved through the SHA pin and a supply-chain PASS on each change |
| Postgres (CI container and Neon) | 18 | Latest major Neon supports ([Neon version policy](https://neon.com/docs/postgresql/postgres-version-policy)) |

## Threat model for this slice

Assets in play: the Anthropic API key in a GitHub environment; the owner connection string and role passwords in Vercel; the owner's tokens in the agent environment; the integrity of `main` and of the review gate. No personal data exists yet.

| Threat (STRIDE, LLM and agentic) | Where | Control in this slice |
| --- | --- | --- |
| Tampering: malicious dependency or action | Install, CI | R1 pnpm settings and exact pins, SHA-pinned actions, osv-scanner, the lockfile release-age, integrity and license check, Dependabot cooldown, supply-chain reviewer, dependency-check policy from `main` |
| Tampering: a PR weakens the gate | Review gate | Gate defined on `main` via `pull_request_target`; review input under neutral names; one isolated run per reviewer; only `CLAUDE.md`, REVIEW, SECURITY and agent bodies carry instructions; verdict computed in code; per-reviewer canary. Residual: agents hold the owner's token and could change the ruleset ([ADR-0012](../adr/0012-automation-first-setup.md)) |
| Tampering: a migration disables its own guards | Database | Parser-vetted statements; runner-owned transaction checked by transaction ID; guards on `pg_catalog` only; roles created only by `bootstrap.sql`; `app_migrator` without `CREATEROLE` |
| Elevation: an agent misusing the owner's tokens | GitHub, Vercel, Neon | Fine-grained GitHub token limited to this repository, with an expiry; no Neon API key at all; agents' instructions and the reviewers. Residual, accepted in ADR-0012 |
| Information disclosure: secret in a commit | Repository | Push protection, gitleaks, `.env.example` only |
| Elevation: branch code reaching secrets | CI, previews | GitHub secrets only in environments limited to `main`; event values only through validated `env:`; Git Fork Protection. Residual, accepted: preview builds and running functions can read the owner connection string in Vercel ([ADR-0012](../adr/0012-automation-first-setup.md)) |
| Prompt injection steering the reviewers | Review gate | Diff and files only, as data; base-branch standards; verdict computed in code; canary suite |
| Information disclosure through the gate's comment | Review gate | No symlinks; `Read` denied outside the workspace and on `.git`; `persist-credentials: false`; model job holds no write token; comment built from schema fields, escaped, gitleaks-scanned |
| Denial of wallet | API, workflows | No public route starts workflows; cron needs `CRON_SECRET`; SDK routes reject unsigned requests; health check cached |
| Elevation: service connected with an owner role or bypassing RLS | Database | The API connects as `app_api`; the owner credentials (every injected name) read only by build scripts (lint, including indirect `process.env` access); each pooled connection checks `current_user`; the production smoke test requires `database: "ok"`; roles never created through the Neon API; guard tests 1 to 8 in every migration transaction and in CI. Residual, accepted: the owner string is readable at runtime (ADR-0012) |
| Injection into the identity statement | Database | `set_config` with bind parameters and UUID validation |
| Information disclosure: production data in a preview or on a laptop | Database | No family data until the case-data slice, which is blocked on a synthetic `development` default branch; Vercel's Development environment is not connected to the database |
| Information disclosure: data in workflow metadata | Workflows | Identifier-only arguments by type, generic names, no attributes, zero retention ([ADR-0009](../adr/0009-background-jobs-guarantees.md)) |
| Cross-site scripting | Web | Strict CSP with Trusted Types, no inline scripts, no third-party scripts |
| Spoofing: outsiders reaching previews | Vercel | Deployment Protection |

## Definition of done

- Every requirement above is met and covered by a test or a CI check.
- All checks in R8 pass on the pull request that completes the slice, and the ruleset requires them.
- A preview and the production deploy show the pt-BR home page with `status: ok` from `/v1/health`.
- The heartbeat has run once in production, in `gru1`, with its payloads shown as expired.
- README.md says how to run the app locally.
- No user-facing string outside i18n; no personal data anywhere.

# Spec 0001: Foundations scaffold

- Status: Ready for tickets
- Date: 2026-11-01
- Epic: cross-platform foundations ([ROADMAP.md](../ROADMAP.md#phase-1--family-mvp-web))
- Amended by: [ADR-0015](../adr/0015-identity-enrollment-step-up-and-recovery.md) (request identity is `app.account_id`), [spec 0004](0004-real-data-readiness.md) (lineage mark, `packages/telemetry`, restore mode, `app_backup` in guards 3 and 5, guard 10), [spec 0005](0005-vault-devices-and-notifications.md) (`packages/vault`, type-only `platform` to `vault` edge) and [spec 0006](0006-design-system-and-theming.md) (theme tokens replace the R5 placeholders; the appearance boot script; `OFL-1.1` joins the license allow-list); where they differ, the amendment governs.
- Decisions: [ADR-0012](../adr/0012-automation-first-setup.md) (amends the others where they differ), [ADR-0009](../adr/0009-background-jobs-guarantees.md), [ADR-0010](../adr/0010-stack-revised.md), [ADR-0011](../adr/0011-reviewers-in-ci.md) (superseded by [ADR-0019](../adr/0019-reviewers-in-the-authoring-session.md)), [ADR-0008](../adr/0008-database-security-and-environments.md), [ADR-0005](../adr/0005-platform-strategy.md)

## Goal

A monorepo that builds, tests and deploys an empty Arca end to end: a pt-BR web shell and an API on one origin, one sample workflow and a database with its roles, all in São Paulo, with every check in R8 enforced as a required check. Feature work after this adds code to an existing structure; it does not set up structure.

## Scope

**In:** the workspace and its tooling; `packages/domain`, `packages/api-contract`, `packages/ui`, `packages/i18n`, `packages/platform`, `packages/db`; `apps/api` and `apps/web`; boundary checks; CI for lint, types, tests, build and supply chain; `GET /v1/health`; the OpenAPI export and the typed client; a heartbeat workflow; database roles, migrations and the row-level security guard; deploy to previews and an empty production.

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
  workflows/           CI, policy checks and post-deploy smoke test
  actions/             shared setup steps (Node, pnpm and its verification)
  policy/              policy files read from `main`, such as the workflow secrets allow-list
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
| `apps/api` | `domain`, `api-contract`, `db`, `knowledge` (added by [spec 0002](0002-rules-engine-and-knowledge-base.md)) |
| `packages/ui` | `i18n` |
| `packages/knowledge` | `domain` (added by spec 0002) |
| `packages/domain`, `packages/api-contract`, `packages/platform`, `packages/i18n`, `packages/db` | nothing in the workspace |

- ESLint, scoped by package:
  - `packages/domain`: no imports of `node:*`, database clients, HTTP clients or `fetch`; no `Date.now()` or `new Date()` without arguments (time is passed in).
  - `apps/web`, `packages/ui`: no `navigator.userAgent`, `navigator.platform` or `navigator.userAgentData`; no imports of Capacitor or Tauri APIs (native access goes through `packages/platform`); `i18next/no-literal-string` in JSX, so text goes through i18n; React rules from `@eslint-react/eslint-plugin` and `eslint-plugin-react-hooks`.
  - `apps/web`: imports from `@arca/api-contract` only through `@arca/api-contract/client`.
  - `packages/api-contract/src/routes` and `src/client`: no imports of `hono` or `@hono/*`.
  - `apps/api/src/workflows`: `start` from `workflow/api` may be imported only by the shared start helper (R6).
  - `packages/knowledge/src`: the `packages/domain` rules, since the runtime entry is pure; its build scripts and tests read files; only its entry points import the built catalog ([spec 0002](0002-rules-engine-and-knowledge-base.md) R1).
  - Every package: `@arca/knowledge/reproduction`, which ignores decision states, and any module or folder named `reproduction` may be imported only by the cases runner (`test/cases`), the reproduction path (`src/reproduction`, `test/reproduction`) and the lookup's own test, which may not re-export it with `export … from` (spec 0002 R5).
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
- Only paths outside `/v1`, `/internal`, `/.well-known` and the Workflow SDK's routes (which live under `/.well-known/workflow`) fall back to `index.html`; unmatched paths under those prefixes return 404. The excluded prefixes are Nitro routes to the API handler, not a server entry, because Nitro passes a 404 from a server entry on to the `index.html` renderer. On Vercel the header rule comes before the static files in the generated `config.json`, so static files get the same headers. Errors that never reach the Hono app (a malformed URL, a module that fails to load) go through the API's Nitro error handler, which sets the same headers, answers with an error code only and logs the allow-listed fields (R3); h3's own error printing is off.
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
- The service worker is built with Workbox (`workbox-precaching`, `workbox-routing`, `workbox-core`) bundled into the worker (no `importScripts`), because the Trusted Types header applies inside the worker too. A small Vite plugin in `apps/web/vite.config.ts` writes the manifest and, after the app build, builds the worker with the list of built files and their content hashes. `vite-plugin-pwa` was dropped: its `workbox-build` dependency pulls in a fork (`@trickfilm400/rollup-plugin-off-main-thread`) whose pre-release lacks the provenance earlier releases had, which the lockfile trust policy rejects as a possible takeover. The worker is registered by our own code through the `arca` Trusted Types policy, which returns only the one known worker URL. Navigations go to the network first, with the precached `index.html` only as the offline fallback, so a change to the response headers reaches installed clients on their next load. The worker takes over open tabs at once (`skipWaiting`), which is safe while the app is one chunk; code splitting needs an update prompt instead.
- Zod's JIT is off in the contract client (`jitless`), since it probes `new Function`, which the CSP and Trusted Types report as a violation even when caught.
- The Vite build writes hidden source maps for the bundle check (`tooling/scripts/src/check-web-bundle.ts`, run by `pnpm check`). They are not published: the Nitro build leaves `*.map` and dotfiles out of the static files, and the worker does not precache them.
- `packages/platform`: a `Capabilities` port (`has(capability): boolean`) and a web adapter that reports none. UI code reads capabilities only through it.

### R6. Sample workflow

- `workflow` and Nitro pinned exactly ([Versions](#versions)).
- `startWorkflow(fn, args)` is the only caller of `start()`. It passes `region: 'gru1'` and `experimental_retention: 0`, and its type accepts only identifier-shaped arguments (branded ID strings and ISO dates).
- `heartbeat(runDate)`: one step opens a transaction as `app_jobs` and reads `now()`. The run writes nothing and returns nothing that needs keeping.
- Trigger: a daily Vercel cron sends `GET /internal/cron/heartbeat` (Vercel cron always uses GET). The route checks `Authorization: Bearer <CRON_SECRET>` by hashing both values and comparing the digests in constant time (lengths may differ), and returns 401 otherwise. `runDate` is the UTC date. No other route of ours starts workflows. The route is not in the OpenAPI document.
- Workflow and step function names are generic (`heartbeat`, `readDatabaseTime`). No run attributes. Errors thrown from steps carry codes only.
- The Workflow SDK's own routes must reject requests that the platform's queue did not sign. The SDK does not check a signature; the platform keeps the runner private as a queue consumer, which the owner accepted on 2026-11-02 (recorded with its source in ADR-0009). A test asserts the runner's queue trigger in the Vercel build output, and the post-deploy smoke test sends an unsigned request and requires 401, 403 or 404.
- Tests: the workflow runs on the SDK's local world from the built server's cron route to a completed step against the Postgres container (`pnpm test:db`); the helper's options, the identifier-only argument type and the cron route's token check are asserted.

### R7. Database foundation

- `packages/db`: Drizzle ORM and drizzle-kit ([Versions](#versions)). Migrations are forward-only SQL files; a one-way change records its reason in the PR. Production migrates before it deploys, so every migration stays compatible with the deployment already running (expand, then contract).
- Migrations are applied by our own runner in `tooling/scripts`, which reads the `.sql` files as data and runs them as `app_migrator`. It runs in the Vercel build, before the app builds (R9).
  - The runner parses each file with the Postgres parser (`libpg-query`) and rejects transaction control (`BEGIN`, `START TRANSACTION`, `COMMIT`, `END`, `ROLLBACK`, `ABORT`, savepoints, prepared transactions), `SET`, `RESET`, `SET ROLE`, `SET SESSION AUTHORIZATION` and `CONCURRENTLY`.
  - It also rejects `ALTER ROLE … SET`, `ALTER DATABASE … SET`, any role statement carrying `PASSWORD`, and `CREATE EXTENSION` for extensions outside an allow-list (empty now; no `dblink` or similar ever).
  - It opens a fresh connection and the transaction itself, takes `pg_advisory_xact_lock` on a fixed key so two runs on the same branch cannot interleave, records `pg_catalog.pg_current_xact_id()`, and runs the statements one per call over the extended protocol, which carries exactly one command, on a connection that pins `standard_conforming_strings` on and `client_encoding` to UTF-8 and ignores `PGOPTIONS` and `PGCLIENTENCODING`; under the simple protocol a migration that changed either setting could make the server split a string differently from the parser and run a hidden `COMMIT`. Statements run with `lock_timeout` 30 seconds, set after the advisory lock. After the last statement it writes the journal rows, then pins `SET LOCAL search_path = pg_catalog, pg_temp` and `client_encoding`, and runs `RESET ROLE`. From then on no migration code may run: the runner reads only built-in catalogs (which a non-superuser cannot extend with children, indexes or statistics) and the journal, whose shape it checks first. Code that would run at `COMMIT`, after the guards, is rejected rather than run: a deferrable trigger or constraint (guard 9), an open cursor, which could be `WITH HOLD`, and any pending trigger event. An event keeps the deferrability it was queued with, and `ALTER CONSTRAINT` on a foreign key can clear the catalog flag while an event is pending on the other table, a partition or a partitioned parent, so as its very last step, after the identity check below, the runner proves the queue is empty: it runs a no-op `ALTER TABLE ONLY` on every plain and partitioned table in the user schemas (`CLUSTER ON` the index already clustered or `SET WITHOUT CLUSTER`; `RESET (fillfactor)` on a partitioned table), which Postgres refuses for a table with pending events. It needs `app_migrator` to own every such table, and fails closed otherwise. After the guards it checks that `current_user` and `session_user` are both `app_migrator`, that the search path is still the pinned one, and that the transaction ID is unchanged. The connection is closed after the run.
  - Every runner and guard query uses fully qualified names (`pg_catalog.*`, the journal table by schema), so a migration cannot shadow catalog views or functions, temporary ones included. Operators resolve through the search path, which is why nothing a migration wrote may run after the pin: the journal is checked to be exactly the table the runner creates (columns, the one `now()` default, the primary key with a plain index and nothing else: no other constraint or index, no inheritance, extended statistics, trigger, rule, policy or row-level security) before it is read with `FROM ONLY`. The canaries include a journal default, check constraint, index expression, index predicate, child table and statistics expression that reset the search path; a deferred trigger, a deferrable exclusion constraint and a re-deferring trigger; `WITH HOLD` cursors, plain and in a `DO` block; foreign-key events queued as deferred before the constraint was made not deferrable, on the referenced table, on a partition and on a partitioned parent; and a temporary domain.
  - The parser checks are defence in depth: dynamic SQL in `DO` blocks can get past a parser. The guards and the transaction checks are the authoritative layer.
  - Migration and guards share that transaction, which commits only if guards 1 to 9 pass (Postgres DDL and role statements are transactional), so a migration that weakens row-level security never commits. The `db` tests include canary migrations, each also in a `DO`-block form: an embedded `COMMIT`, a shadowing temporary view, a role default set with `ALTER ROLE … SET`, and a role switch. Each must fail and leave nothing committed.
  - The runner keeps its own journal table, which is the only allow-listed table without row-level security. It stores a checksum per file and refuses to run unless the journal is an exact prefix of the files on disk, so a migration cannot mark later ones as applied. In the guard phase it checks the journal's shape first, then that the journal equals its state before the run plus the new rows.
- `bootstrap.sql` runs in the Vercel build, before the runner, as the Neon owner role, with `createrole_self_grant` empty. It is idempotent: it creates or corrects the roles below and changes nothing else, so it runs on every build at no risk. The bootstrap step (a script in `tooling/scripts` plus `bootstrap.sql`) is the only code that uses the Neon owner role, and the only place roles are created; roles are never created through the Neon console or API, which would make them members of `neon_superuser`. Adding a role is a reviewed change to it. It creates:
  - `app_migrator` as `NOBYPASSRLS`, `NOSUPERUSER`, `NOREPLICATION`, `NOCREATEROLE`, `NOCREATEDB`, not a member of `neon_superuser`, owning the application schema. It grants table privileges as the owner of those tables, so it needs no rights over other roles;
  - `app_api`, `app_jobs`, `app_auth` and `app_audit` with the same attributes, and no table grants yet.
- Owner variables: the integration injects the owner role's credentials, and project identifiers, as `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL_NO_SSL`, `POSTGRES_PRISMA_URL`, `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE` and `NEON_PROJECT_ID` (Production and Preview, Sensitive; checked 2026-11-01). Only the build scripts in `tooling/scripts` read them. A lint rule forbids, everywhere else, reading any of these names (matched by the prefixes `DATABASE_`, `PG`, `POSTGRES_` and `NEON_`) and any indirect access to `process.env` (computed keys, destructuring, spreading, passing `process.env` or `process` itself to a function, loading `process` dynamically or through `require`, and Vite's `loadEnv` with a prefix other than `VITE_`); runtime code reads its own variables through one typed config module that names each key. Because database drivers read the same variables themselves for any field they are not given, a second lint rule allows importing `pg`, `postgres`, `@neondatabase/*`, `@vercel/postgres` and the matching Drizzle drivers only in the `@arca/db` files that build the role pool, and in the build scripts. If Neon adds a name outside those prefixes, the lint list is updated in the same change.
- Passwords: the bootstrap step, as the owner, sets the passwords of `app_migrator`, `app_api` and `app_jobs` from Sensitive Vercel variables (`ARCA_DB_MIGRATOR_PASSWORD`, `ARCA_DB_API_PASSWORD`, `ARCA_DB_JOBS_PASSWORD`) that an agent generates through the Vercel API. `ALTER ROLE … PASSWORD` takes no bind parameters, and Neon accepts only a plaintext password there: it forwards role changes to its control plane and rejects a SCRAM-SHA-256 verifier with "Neon only supports being given plaintext passwords" (checked on a throwaway Neon branch, 2026-11-02). So the script requires each password to be 32 to 128 base64url characters, an alphabet with no quote or backslash, fills it into `ALTER ROLE … PASSWORD '<password>'` at run time, and never prints the rendered SQL; Postgres stores a SCRAM-SHA-256 verifier. The plaintext travels over TLS to the server and on to Neon's control plane, and the server log may record the statement if it fails; both are inside the provider that holds the data anyway. Bootstrap and the runner use the unpooled host (`PGHOST_UNPOOLED`, `PGDATABASE`); the runner connects as `app_migrator`. Both are `pnpm --filter @arca/scripts db:bootstrap` and `db:migrate`. Every build resets the passwords, while the live deployment keeps the values it was built with, so rotating a password breaks the live deployment from the bootstrap until the new deployment is promoted (or until a rollback, if the build fails after the bootstrap). Accepted while production holds no family data; rotation without downtime needs a second role per service and comes with the case-data slice.
- The running API connects as `app_api` and jobs as `app_jobs`, on the pooled host. Runtime code cannot read the injected names, so a build script in `tooling/scripts` reads `PGHOST` and `PGDATABASE` (each preview branch has its own) and emits only the host and database name, which are not secret, as generated build-time configuration that the typed config module reads; it never emits the owner user or password. The database client is given user, password, host and database explicitly, never from the environment, because node-postgres and the Neon driver fill missing fields from `PG*` variables and would connect as the owner. Each new pooled connection checks `current_user` and `session_user` are `app_api` (jobs: `app_jobs`) and that `app.person_id` and `app.case_id` are empty, since `PGOPTIONS` or a role setting could otherwise preset an identity, and is closed with a connection-check error otherwise, so no query runs under another role or identity. The pool has a client-side query timeout, and a dropped idle connection is logged by class name instead of ending the process.
- Request identity is set with `select set_config('app.person_id', $1, true)` and `set_config('app.case_id', $2, true)`, with UUID-validated parameters, never by string interpolation. Policies will read `nullif(current_setting('app.person_id', true), '')::uuid`, so a missing or reset setting yields no rows rather than an error. With no case tables, the helper is exercised by a test-only table created inside the test: no identity returns zero rows; the setting does not carry into the next transaction on a pooled connection; a malformed ID is rejected before any SQL runs. The helper ends with a no-op statement, so a database error that the caller's code swallowed fails the call instead of committing nothing silently.
- **Guard tests** (the start of the access-matrix suite; nine guards). Each environment has its own exempt-role list, chosen by the runner from the connection target and not editable through migration data: Neon's managed roles (the project owner included) for Neon, the container's bootstrap `postgres` role for CI. Every other role is checked. The exempt lists, the list of tables allowed without row-level security and the extension and role-setting allow-lists live in files in `packages/db`.
  1. Every table in every non-system schema has row-level security enabled and forced, except tables on the allow-list (the runner's journal now; auth tables join with the auth slice).
  2. Views in those schemas have `security_invoker = true`. Materialized views, foreign tables and `SECURITY DEFINER` functions are forbidden unless allow-listed.
  3. The roles that can log in, minus the exempt list, are exactly `app_api`, `app_jobs`, `app_auth`, `app_audit` and `app_migrator`.
  4. No role outside the exempt list has `rolsuper`, `rolbypassrls`, `rolreplication`, `rolcreatedb` or `rolcreaterole`.
  5. Memberships whose member or granted role is outside the exempt list are limited to the ones Postgres 16 and later grant automatically when a `CREATEROLE` role creates another: the Neon project owner may hold `ADMIN OPTION` on each of the `app_*` roles bootstrap creates (five here, six once spec 0004 R12 adds `app_backup`), with `inherit_option` and `set_option` false. This is an upper bound: Neon records those grants, while the CI bootstrap role is a superuser and Postgres records none. Every other membership, direct or indirect (`pg_auth_members`, `pg_has_role`), is forbidden, including `neon_superuser`, the `pg_*` predefined roles and any membership between `app_*` roles. The predefined `pg_*` roles (a reserved prefix) are not checked themselves: their built-in memberships, such as `pg_monitor` in `pg_read_all_stats`, and the platform's grants of them to exempt roles pass, while granting one to a checked role fails.
  6. No runtime role owns a table or schema, or has `CREATE` on any schema or on the database.
  7. `pg_catalog.pg_db_role_setting` has no rows at all outside an allow-list that starts empty (Neon's own defaults join it if present). A role default for `app.person_id` would otherwise become the identity of every request that forgot to set one.
  8. `pg_catalog.pg_extension` equals an allow-list in `packages/db`: the extensions Neon or the container pre-install (`plpgsql` included) and nothing else.
  9. No trigger or constraint in those schemas is deferrable, except constraints on an allow-list in `packages/db` that starts empty. A deferred check runs at `COMMIT`, after the other guards, so each entry needs a review of what code it can reach. The runner's pending-event check backs this guard up, because the catalog flag can change after an event is queued.
- The guards run in CI against a Postgres 18 service container pinned by digest, and inside every migration transaction in the Vercel build, on preview branches and production (as `app_migrator`), which is where the Neon-specific checks actually bite.
- `GET /v1/health` checks the database with `select current_user`, with a 2-second timeout. It reports `degraded`, not an error, with `database: "unavailable"` when the database is unreachable and `database: "wrong_role"` when the pool's role check fails.
- The synthetic seed starts empty and is the only source of non-production data.

### R8. CI

All workflows: actions pinned by full commit SHA; top-level `permissions: {}`, with jobs granting only what they need; GitHub-hosted runners; `actions/checkout` with `persist-credentials: false`. Workflows on `pull_request` and `push` use `concurrency` per ref; workflows on `pull_request_target` (the policy checks) group by pull request number. Values from the event (branch names, titles, file names) reach `run:` steps only through `env:` and are validated against a strict pattern before use.

**Secrets.** No repository-level secrets and no GitHub environments; workflows use only their own `GITHUB_TOKEN`. The owner connection string and the role passwords live in Vercel (R9). The CI review gate's environment and token were removed with the gate ([ADR-0019](../adr/0019-reviewers-in-the-authoring-session.md)).

A CI lint checks each workflow file against an allow-list of the secrets and environments it may use; workflows on `pull_request`, `deployment` or `deployment_status` use none, since those run the definition from a branch or from whatever commit was deployed. The lint reads the allow-list from `main`, so a workflow that needs a new secret is preceded by its own PR to the list.

| Check (required on `main`) | What it runs |
| --- | --- |
| `check` | pnpm installed by `tooling/scripts/src/setup-pnpm.ts`, with nothing run before it is verified: the `packageManager` hash must match the lockfile's `pnpm` integrity, and the platform's `@pnpm/exe.*` package must match the integrity the lockfile records for it; its binary then goes first on `PATH`; `pnpm install --frozen-lockfile`, then `pnpm check` (format, lint, typecheck, unit tests, build), the boundary script, the bundle check and the OpenAPI drift test in `packages/api-contract` |
| `secrets-lint` | The secrets lint above, from `policy.yml` on `pull_request_target`: the workflow definition, the script and the allow-list come from `main`, and the PR's workflow files are read as data. Context and secret names are matched case-insensitively, as GitHub does, and `github.token` counts as the secret `GITHUB_TOKEN`. Composite actions in `.github/actions` may reference no secret or token. The lint covers explicit references; a token an action uses by default is bounded by `permissions` |
| `lockfile-policy` | Release age and licenses of the lockfile entries the PR adds or changes, in one job. Release age: every lockfile entry added or changed by the PR was published at least 7 days earlier, per the registry, unless listed in `minimumReleaseAgeExclude` as it stands in `pnpm-workspace.yaml` on `main`. Every such entry, excluded or not, must resolve by integrity alone (no tarball URL, git or directory source) and its integrity must equal the registry's, so the release the age rule vouches for is the artifact pnpm installs. A frozen install does not re-check this, so CI does. A missing publish time, an unknown release or an unreachable registry fails the check. Licenses: the registry's license for each such entry must satisfy, as an SPDX expression, the allow-list in `.github/policy/licenses.json` on `main` (MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0, CC0-1.0, CC-BY-4.0, Unlicense, Python-2.0), or match one of its per-package exceptions, each with the exact license and a reason; a missing or non-SPDX license fails. An exception with `license: null` covers a release the registry gives no license for, and its reason names the license in the published tarball. Adding a license or an exception needs a supply-chain PASS. GitHub's dependency review is not used: the dependency graph does not read pnpm 12's two-document lockfile, so it would pass without judging anything |
| `knowledge-immutable` | From `policy.yml` on `pull_request_target`, added with [spec 0002](0002-rules-engine-and-knowledge-base.md) R6: the PR head's `packages/knowledge/data` and `packages/knowledge/vendor` trees, fetched from git as data, against `main`'s tip (the ruleset requires up-to-date branches, so the difference is the PR's own); both must be directories; no file there may change, move or disappear, cases files and `hashes.json` only gain entries, and official-domain files change only in a PR of their own. `.github/policy/vendored.json` only gains entries, in a PR of its own, and each new entry is verified against its upstream commit as spec 0002 R7 sets out; `vendored-sources.json` also changes only in a PR of its own. A new file under `vendor` is accepted only when its SHA-256 is already approved in `vendored.json` on `main`. Nothing from the PR is installed or run |
| `db` | Migrations and guard tests on the Postgres container |
| `e2e` | Playwright against the built app served locally, at phone (390×844) and desktop (1280×800) sizes: the home page renders in pt-BR and shows the API status, the service worker is active, and no CSP or Trusted Types violation is reported |
| `osv-scanner` | Dependency advisories on the lockfile; fails on any known vulnerability without a recorded exception. It also runs on every push to `main`. Dependabot alerts cannot read pnpm 12's two-document lockfile, so an advisory published against `main` between pushes shows up on the next pull request or push |
| `gitleaks` | Secret scan of the pull request's commits, with the binary pinned by version and checksum and its configuration and ignore list from `main`. The commits are fetched into `main`'s repository and scanned there, so no file from the change applies (its `.gitleaksignore`, its `.gitattributes`); `--text` and `--remerge-diff` show content hidden as binary or added only in a merge commit, and inline `gitleaks:allow` comments are not honored (`--ignore-gitleaks-allow`) |
| `codeql` | CodeQL for JavaScript and TypeScript, plus the Actions language (catches script injection in workflows), with build mode none and the `security-extended` queries, in `codeql.yml`; new alerts fail the `CodeQL` check that GitHub code scanning posts on the pull request. The `codeql` job only runs the analysis and passes even when it finds alerts, so the ruleset has a `code_scanning` rule for CodeQL with the failure threshold at medium or higher for security alerts and errors for other alerts (medium, because the #6 acceptance run showed a workflow script injection rated medium). This is advanced setup, so the PR's own `codeql.yml` defines the languages and queries; a change to it is a workflow change, which the must-pass reviewers and the policy jobs judge |
| `sbom` | A CycloneDX SBOM of the lockfile from `pnpm sbom`, uploaded as a build artifact |

- The jobs behind `lockfile-policy`, `osv-scanner`, `gitleaks`, the secrets lint and, from spec 0002, `knowledge-immutable` live in `policy.yml` on `pull_request_target`, so their definitions, scripts and policy files come from `main`: in `.github/policy/` the license allow-list and exceptions (`licenses.json`), the osv-scanner exceptions (`osv-scanner.toml`, each with a reason and an end date), the gitleaks configuration and ignore list, and the secrets allow-list. They read the PR's lockfile and commits only as data, fetched from git after every install step; only the secrets lint checks out files of the PR (its workflows and actions), and nothing runs from them. A PR therefore cannot weaken the deterministic checks that judge it; changing a policy file is its own PR, judged by the policy already on `main`.
- Dependabot: version updates for npm and GitHub Actions, weekly, grouped, with a `cooldown` of 7 days to match pnpm. While scaffolding, check that Dependabot updates a catalog entry in `pnpm-workspace.yaml` and the lockfile together. If it cannot, configure Renovate instead and amend ADR-0010.
- Repository settings. ADR-0012 planned for an agent to apply them through the GitHub API, but the proxy blocks settings writes, so the owner applied them in the GitHub UI ([ADR-0012](../adr/0012-automation-first-setup.md)):
  - Ruleset **main**: requires every check above, with strict status checks (branch up to date before merge), from any source; pull requests only, with no approval required and squash as the only merge method; linear history; no force pushes or deletion. No bypass actors. The owner imported it from a JSON file on 2026-11-03. The checks are not pinned to GitHub Actions: any workflow can already create a check of a required name ([ADR-0012](../adr/0012-automation-first-setup.md)), and the only other installed apps are Claude, which acts with the owner's authority, and Vercel. Unpinned checks also accept commit statuses from any token or app with status write access. Revisit pinning when an app or a collaborator is added.
  - Secret scanning push protection, Dependabot alerts, private vulnerability reporting.
- The ticket verifies once that a pull request with a failing required check cannot merge.

### R9. Deploy

- The owner creates the database once from Vercel (project `arca` › Storage › Neon): São Paulo, Postgres 18, name `arca`, connected to Production and Preview (not Development), with a database branch per preview. No Neon API key is needed ([ADR-0012](../adr/0012-automation-first-setup.md)).
- One Vercel project in the Pro team, linked to the repository: pushes deploy previews and `main` deploys production. Functions in `gru1` only, Node 26. One origin per environment.
- **Build command**, versioned in `apps/api/vercel.json` (which overrides the project setting): bootstrap as the owner (roles and their passwords), then migrations as `app_migrator` with the guards in the same transaction (R7), then the app build. A guard failure fails the build, so nothing deploys; the fix is a forward migration. Each `pnpm --filter` uses `--fail-if-no-match`, since pnpm otherwise exits 0 when nothing matches and the steps would be skipped.
- **Database target check.** The `Preview` variables at project level hold the production values (checked 2026-11-02); the integration overrides them per preview deployment with the preview branch's. If it ever did not, a preview build would bootstrap and migrate production. So, in the bootstrap transaction, the first production build writes its Neon endpoint ID into the database comment, which preview branches inherit while getting endpoints of their own (checked on throwaway Neon branches, 2026-11-02). A preview build that reaches the marked endpoint, or an unmarked database, fails; so does a production build on another endpoint or from a ref other than `main`, a Vercel build whose host is not a Neon endpoint, and any bootstrap or migration of a Neon host outside a Vercel build, except the restore job's `--restore-target <journal ID>` mode, which bootstraps and migrates up to the given journal entry, on a restore-prefixed branch ([spec 0004](0004-real-data-readiness.md) R12; a drill runs it at the backup's head, and a real restore runs it again at the current head). The migration runner, as `app_migrator`, reads the mark again in its own transaction and never writes it, so it does not depend on the build command's order; `runtime-config` requires the pooled and unpooled hosts to name the same endpoint. Consequences: preview branches created before the first marked production build carry no mark and keep failing until they are deleted (the integration reuses one Neon branch per Git branch); the `development` default branch must be a fork of production, or be marked by hand; and if production's endpoint is ever recreated, production builds fail until a person rewrites the mark (`COMMENT ON DATABASE` as the owner) in a reviewed step, and stale previews keep the old mark until then.
- Variables an agent sets through the Vercel API, all Sensitive: the `app_migrator`, `app_api` and `app_jobs` passwords (Production and Preview), `CRON_SECRET` (Production).
- Preview branches fork from the integration's default branch, which is production. That is safe only while production has no family data. Before the first case-data table, a `development` branch with only synthetic data becomes the default branch; the case-data slice is blocked on it.
- Vercel Deployment Protection on previews; Git Fork Protection on, so fork pull requests get no variables without approval, and their builds fail at the bootstrap until a maintainer approves them.
- A smoke test runs from GitHub Actions on Vercel's successful production deployment of `main`, with no secrets (the production URL is public): it calls `/v1/health` and requires `status: "ok"` and `checks.database: "ok"` (retrying for about a minute, past the health check's cache, for a cold start), requires the web app to answer with HTML, checks the security headers on both, and sends an unsigned request to the Workflow SDK's routes (R6). It runs on Vercel's `repository_dispatch` event `vercel.deployment.success`, whose payload carries the project, `environment` and `git.ref` ([Vercel for GitHub](https://vercel.com/docs/git/vercel-for-github#repository-dispatch-events) and the `@vercel/repository-dispatch` 0.1.0 types, checked 2026-11-02). That event runs the workflow file on `main` only, unlike `deployment_status`, which runs the deployed commit's copy; the project creates no GitHub deployments. Vercel sends the event only with the project's `repository_dispatch` toggle on (Settings › Git), an owner step. The test checks the production alias, not the deployment URL, which Deployment Protection covers. Previews are covered by the `e2e` check and by the build failing on any migration or guard error.
- Production holds an empty database with roles applied. The heartbeat cron runs in production only.

### R10. Review

Superseded by [ADR-0019](../adr/0019-reviewers-in-the-authoring-session.md) on 2026-11-03: the reviewer subagents run in the authoring session before a pull request opens and again before it merges ([REVIEW.md](../REVIEW.md)). CI has no review check and no canary. The CI gate this section used to specify is in the history at commit `6214a6a`.

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
| osv-scanner, gitleaks | 2.7, 8.30 | Latest GitHub releases (google/osv-scanner, gitleaks/gitleaks, checked 2026-11-01); binaries pinned by version and by the SHA-256 in each release's checksum file, in `policy.yml` and `.github/actions/setup-gitleaks` |
| React | 19.3 | Latest |
| Vite, `@vitejs/plugin-react` | 8.3, 6.x | Latest |
| TanStack Router, TanStack Query | 1.170+, 5.104+ | Latest |
| Tailwind CSS, `@tailwindcss/vite` | 4.3 | Latest |
| `workbox-precaching`, `workbox-routing`, `workbox-core` | 7.4 | Latest; bundled into the service worker by our own Vite plugin (R5) |
| i18next, react-i18next, i18next-icu | 26.x, 17.x, 2.6 | Latest; react-i18next accepts TypeScript 7 |
| Hono | 4.13 | Latest stable. Hono 5 is at its first release candidate; `@hono/zod-openapi` and Nitro are not proven against it, and it offers this slice nothing. Revisit at 5.0 |
| Zod, `@hono/zod-openapi` | 4.6, 1.6 | Latest |
| `workflow` | 5.2.3 | Latest; 5.x is required for region pinning ([ADR-0009](../adr/0009-background-jobs-guarantees.md)) |
| Nitro | 3.0.260903-beta | Pre-release, required: the Workflow SDK's Hono path needs Nitro 3. The newest release older than 7 days; move to the release candidate (3.0.261029-rc) once it is |
| Drizzle ORM, drizzle-kit | 1.0 release candidate | Pre-release, chosen: 0.45 would force a 1.0 migration within months, and 1.0 has the reworked RLS and role APIs we depend on. Risk is low while no case tables exist; any RC bug found is fixed or pinned before the first case table |
| `pg` | 8.x | Latest; driver for Drizzle, the migration runner and the guard tests |
| `libpg-query` | 18.x | The Postgres parser compiled to WebAssembly, matching Postgres 18; the migration runner uses it to split and vet statements. 18.2.1 ships only JavaScript and a `.wasm` file, with no install script, so `allowBuilds` stays empty (checked 2026-11-02) |
| Vitest | 5.0 | Latest stable; 5.1 is a beta with nothing we need |
| Playwright | 1.64+ | Latest |
| GitHub Actions and CI tools (checkout, setup, CodeQL, osv-scanner, gitleaks, SBOM generator) | latest release, pinned by commit SHA | Approved through the SHA pin and a supply-chain PASS on each change |
| Postgres (CI container and Neon) | 18 | Latest major Neon supports ([Neon version policy](https://neon.com/docs/postgresql/postgres-version-policy)) |

## Threat model for this slice

Assets in play: the owner connection string and role passwords in Vercel; the owner's tokens in the agent environment; the integrity of `main` and of the reviewer definitions. No personal data exists yet.

| Threat (STRIDE, LLM and agentic) | Where | Control in this slice |
| --- | --- | --- |
| Tampering: malicious dependency or action | Install, CI | R1 pnpm settings and exact pins, SHA-pinned actions, osv-scanner, the lockfile release-age, integrity and license check, Dependabot cooldown, supply-chain reviewer, dependency-check policy from `main` |
| Tampering: a change weakens the reviewers | `.claude/agents/`, REVIEW.md | A change to either needs a PASS from the security, architecture and supply-chain reviewers and a REVIEW.md change-log entry; the policy checks come from `main`. Residual, accepted in [ADR-0019](../adr/0019-reviewers-in-the-authoring-session.md): nothing in CI proves the reviewers ran, and a branch that weakens the agent definitions is judged by the weakened reviewers. Agents hold the owner's token and could change the ruleset ([ADR-0012](../adr/0012-automation-first-setup.md)) |
| Tampering: a migration disables its own guards | Database | Parser-vetted statements; runner-owned transaction checked by transaction ID; guards on `pg_catalog` only; roles created only by `bootstrap.sql`; `app_migrator` without `CREATEROLE` |
| Elevation: an agent misusing the owner's tokens | GitHub, Vercel, Neon | Fine-grained GitHub token limited to this repository, with an expiry; no Neon API key at all; agents' instructions and the reviewers. Residual, accepted in ADR-0012 |
| Information disclosure: secret in a commit | Repository | Push protection, gitleaks, `.env.example` only |
| Elevation: branch code reaching secrets | CI, previews | No GitHub secrets besides each workflow's `GITHUB_TOKEN`; event values only through validated `env:`; Git Fork Protection. Residual, accepted: preview builds and running functions can read the owner connection string in Vercel ([ADR-0012](../adr/0012-automation-first-setup.md)) |
| Prompt injection steering the reviewers | Authoring session | Reviewers are told to read the diff and files as data. Residual, accepted in ADR-0019: nothing enforces it, and local reviewers can run commands with the session's credentials |
| Denial of wallet | API, workflows | No public route starts workflows; cron needs a `CRON_SECRET` of 32 characters or more; the SDK's runner is private to the queue; its webhook route is public and answers 404, since no workflow creates hooks; health check cached |
| Elevation: service connected with an owner role or bypassing RLS | Database | The API connects as `app_api`; the owner credentials (every injected name) read only by build scripts (lint, including indirect `process.env` access); each pooled connection checks `current_user`; the production smoke test requires `database: "ok"`; roles never created through the Neon API; guard tests 1 to 9 in every migration transaction and in CI; the database target check, so a preview build never bootstraps or migrates production. Residual, accepted: the owner string is readable at runtime (ADR-0012) |
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

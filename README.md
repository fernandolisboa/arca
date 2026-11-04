# Arca

Arca is an immigration consultancy in an app. A person describes their family and what they hope for in their own words; Arca turns that into a structured case and does what an immigration firm would do for it: diagnosis, destination comparison, route recommendation with pros and cons, a personalized document checklist, a step-by-step plan, document review, form drafts, interview practice and arrival setup.

The name comes from the Portuguese *arca*: both an ark (it carries the whole family) and a strongbox (it carries the family's assets).

## Status

Scaffolding the monorepo ([spec 0001](docs/specs/0001-foundations-scaffold.md)); the rules engine and knowledge base are specified next ([spec 0002](docs/specs/0002-rules-engine-and-knowledge-base.md)). Product, architecture, platform strategy and stack are decided ([docs/adr/](docs/adr/)).

## Development

Requirements: Node.js at the version in [.nvmrc](.nvmrc) and pnpm at the exact version in `packageManager` in [package.json](package.json), for example `npm install --global pnpm@12.15.0` (Node.js 25 and later no longer ship Corepack). CI verifies the pnpm binary against the hash recorded in `packageManager`.

```sh
pnpm install --frozen-lockfile
pnpm check    # format check, dependency sources, boundaries, web bundle, lint, typecheck, tests and build, through Turborepo
```

Set `TURBO_TELEMETRY_DISABLED=1` in your shell to turn off Turborepo's anonymous usage telemetry; CI sets it.

CI runs the same `pnpm check` on every pull request ([.github/workflows/ci.yml](.github/workflows/ci.yml)). CI installs pnpm with [setup-pnpm.ts](tooling/scripts/src/setup-pnpm.ts), which downloads the native binary whose hash `pnpm-lock.yaml` records and checks it before anything runs it. Workflows may use only the secrets and environments listed in [.github/policy/workflow-secrets.json](.github/policy/workflow-secrets.json), and composite actions in `.github/actions` none (they take values as inputs). A new workflow or secret needs its own PR to that list first, since the check reads the list from `main`. [policy.yml](.github/workflows/policy.yml) runs that check on `pull_request_target`, so the workflow, the script and the list always come from `main`. It also checks dependencies against `main`'s rules: release age and registry integrity, licenses ([allow-list](.github/policy/licenses.json)), known advisories ([osv-scanner exceptions](.github/policy/osv-scanner.toml)) and leaked secrets. CodeQL runs from [codeql.yml](.github/workflows/codeql.yml), `ci.yml` builds a CycloneDX SBOM, and Dependabot ([.github/dependabot.yml](.github/dependabot.yml)) proposes updates weekly after a 7-day cooldown.

API contract: routes live in [packages/api-contract](packages/api-contract/src/routes/index.ts) as data. After changing one, run `pnpm build && pnpm --filter @arca/api-contract openapi:write` and commit `openapi.json`; a test fails while the committed document differs from the routes.

One origin: `pnpm --filter @arca/api build` builds `apps/web` and then the Nitro server in `apps/api`, which serves the web build, the API under `/v1` and the security headers from `tooling/security-policy` on every response; `node apps/api/.output/server/index.mjs` runs it locally. On Vercel the project's root directory is `apps/api`, whose `vercel.json` holds the framework and build command: every deployment, preview or production, runs the database bootstrap, the migrations and the runtime config before the build, so a failing migration or guard fails the deployment. The function's region and runtime come from `nitro.config.ts`, and the project's Node version setting is 26.x. Fork previews have no variables until a maintainer approves them, so their builds fail at the bootstrap. After each successful production deployment of `main`, Vercel's `repository_dispatch` event starts the `smoke` workflow, which checks the live health check, the web app, the security headers and that the workflow runner refuses an unsigned request (`pnpm --filter @arca/scripts smoke <origin>`).

Background work: workflows live in `apps/api/src/workflows` and start only through `startWorkflow` (São Paulo, zero retention, identifier-only arguments; [ADR-0009](docs/adr/0009-background-jobs-guarantees.md)). The sample `heartbeat` runs daily from a Vercel cron in production (`GET /internal/cron/heartbeat`, with `CRON_SECRET` as a bearer token) and reads the database clock as `app_jobs`. Locally the SDK uses its file-based world in `.workflow-data/`, and the built server's runner route accepts any request, so a local build listens on loopback only when it runs a workflow (`HOST=127.0.0.1`).

Database: roles live in [packages/db/bootstrap.sql](packages/db/bootstrap.sql) and migrations in `packages/db/migrations/<timestamp>_<name>/migration.sql`. The runner in [tooling/scripts/src/db](tooling/scripts/src/db) applies them as `app_migrator` in one transaction that commits only if the guards pass (spec R7). To run the database tests, start a throwaway Postgres 18 (for example `docker run -d -p 127.0.0.1:5432:5432 -e POSTGRES_PASSWORD=postgres postgres:18`; the tests create roles across the server, so never point them at a shared one), then `ARCA_TEST_DB_ADMIN_PASSWORD=postgres pnpm test:db`, which builds what the tests need and runs each package's database tests one package at a time, including the heartbeat workflow end to end. CI runs them in the `db` job.

Runtime database access goes through `@arca/db`: `createRolePool` logs in as `app_api` or `app_jobs` with every field explicit and rejects a connection running as any other role, and `withIdentity` sets the request identity for one transaction. Only the build scripts in `tooling/scripts` may read the owner's variables (`DATABASE_*`, `PG*`, `POSTGRES_*`, `NEON_*`); the `arca/no-owner-environment` lint rule enforces it, and runtime code reads its own variables by name in one config module.

Web app: `pnpm --filter @arca/web dev` serves `apps/web` with Vite at http://localhost:5173 (calls to `/v1` need the API on the same origin, so check the API status through the built app). `pnpm turbo run e2e` builds the web app and the Nitro server and runs the Playwright suite against it at phone and desktop sizes; install the browser once with `pnpm --filter @arca/web exec playwright install chromium`, or point `ARCA_E2E_CHROMIUM` at a local Chromium. The sign-in tests also need a database: on the throwaway Postgres of the database tests, create one (say `arca_e2e`), run `db:bootstrap` and `db:migrate` from `@arca/scripts` against it as the CI `e2e` job does, export the role passwords you gave them, `BETTER_AUTH_SECRET` and `ARCA_RATE_LIMIT_KEY` (any 32 characters or more), and run with `ARCA_E2E_DATABASE=arca_e2e` and `ARCA_TEST_DB_ADMIN_PASSWORD`; a second server on http://localhost:4174 then reaches that database. Without `ARCA_E2E_DATABASE` they are skipped locally, and CI refuses to run without it. Session cookies are `__Host-` and therefore Secure: on http://localhost, Chrome and Firefox accept them and Safari does not, so sign in locally with Chrome or Firefox. User-facing text lives in the pt-BR catalog in [packages/i18n](packages/i18n/src/catalogs/pt-BR.ts), in ICU message format; a key that is not in the catalog fails the typecheck.

Single steps: `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Code layout: [ARCHITECTURE.md](docs/ARCHITECTURE.md#platforms-and-code-layout) and the [spec](docs/specs/0001-foundations-scaffold.md#layout).

Dependencies: every version is exact and lives in the catalogs in [pnpm-workspace.yaml](pnpm-workspace.yaml); packages refer to them as `catalog:`. pnpm installs only releases at least 7 days old and runs no dependency install scripts unless `allowBuilds` lists them. TypeScript 7 typechecks and builds the workspace; only `tooling/eslint-config` uses TypeScript 6.0, through the `lint` catalog, because typescript-eslint needs its compiler API.

Platforms, in order: web (installable PWA), Android, iOS and iPadOS, then desktop if its gate passes ([ADR-0005](docs/adr/0005-platform-strategy.md)).

The first case is the founder's own family. The app goes to other families only after it works for them.

## Documentation map

| Document | What it covers |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | Rules for coding agents working in this repo |
| [docs/PRODUCT.md](docs/PRODUCT.md) | Vision, principles, how a case is understood, services, execution modes |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, code layout, data model, AI stack, agents, quality, data flows |
| [docs/SECURITY.md](docs/SECURITY.md) | Security pillar: principles, standards, threat model, required controls |
| [SECURITY.md](SECURITY.md) | How to report a vulnerability |
| [docs/REVIEW.md](docs/REVIEW.md) | Reviewer gates and the specialist reviewers in `.claude/agents/` |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases and the gates between them |
| [docs/GLOSSARY.md](docs/GLOSSARY.md) | Domain terms and their pt-BR UI equivalents |
| [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) | Decisions still pending |
| [docs/RETENTION.md](docs/RETENTION.md) | How long each kind of data is kept, and what enforces it |
| [docs/adr/](docs/adr/) | Architecture decision records: language, rules as data, stack, AI ports, platforms, auth, background jobs, database security, automation-first setup, the knowledge base as reviewed data, reviewers in the authoring session, identity, observability, data lifecycle and backups, vault encryption |
| [docs/specs/](docs/specs/) | Feature specs, written before tickets and code |
| [docs/research/](docs/research/) | Sourced research notes that seed the knowledge base |

## Language

Code, docs, commits, issues and agent reasoning are in English. The user interface ships in Brazilian Portuguese first, through i18n. See [ADR-0001](docs/adr/0001-english-for-code-and-docs.md).

# Arca

Arca is an immigration consultancy in an app. A person describes their family and what they hope for in their own words; Arca turns that into a structured case and does what an immigration firm would do for it: diagnosis, destination comparison, route recommendation with pros and cons, a personalized document checklist, a step-by-step plan, document review, form drafts, interview practice and arrival setup.

The name comes from the Portuguese *arca*: both an ark (it carries the whole family) and a strongbox (it carries the family's assets).

## Status

Scaffolding the monorepo ([spec 0001](docs/specs/0001-foundations-scaffold.md)). Product, architecture, platform strategy and stack are decided ([docs/adr/](docs/adr/)).

## Development

Requirements: Node.js at the version in [.nvmrc](.nvmrc) and pnpm at the exact version in `packageManager` in [package.json](package.json), for example `npm install --global pnpm@12.15.0` (Node.js 25 and later no longer ship Corepack). CI verifies the pnpm binary against the hash recorded in `packageManager`.

```sh
pnpm install --frozen-lockfile
pnpm check    # format check, dependency sources, boundaries, lint, typecheck, tests and build, through Turborepo
```

Set `TURBO_TELEMETRY_DISABLED=1` in your shell to turn off Turborepo's anonymous usage telemetry; CI sets it.

CI runs the same `pnpm check` on every pull request ([.github/workflows/ci.yml](.github/workflows/ci.yml)). CI installs pnpm with [setup-pnpm.ts](tooling/scripts/src/setup-pnpm.ts), which downloads the native binary whose hash `pnpm-lock.yaml` records and checks it before anything runs it. Workflows may use only the secrets and environments listed in [.github/policy/workflow-secrets.json](.github/policy/workflow-secrets.json), and composite actions in `.github/actions` none (they take values as inputs). A new secret needs its own PR to that list first, since the check reads the list from `main`. [policy.yml](.github/workflows/policy.yml) checks this on `pull_request_target`, so the workflow, the script and the list always come from `main`.

API contract: routes live in [packages/api-contract](packages/api-contract/src/routes/index.ts) as data. After changing one, run `pnpm build && pnpm --filter @arca/api-contract openapi:write` and commit `openapi.json`; a test fails while the committed document differs from the routes.

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
| [docs/adr/](docs/adr/) | Architecture decision records: language, rules as data, stack, AI ports, platforms, auth, background jobs, database security, reviewers in CI, automation-first setup |
| [docs/specs/](docs/specs/) | Feature specs, written before tickets and code |
| [docs/research/](docs/research/) | Sourced research notes that seed the knowledge base |

## Language

Code, docs, commits, issues and agent reasoning are in English. The user interface ships in Brazilian Portuguese first, through i18n. See [ADR-0001](docs/adr/0001-english-for-code-and-docs.md).

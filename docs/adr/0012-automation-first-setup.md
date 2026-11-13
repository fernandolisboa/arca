# ADR-0012: Automation-first setup with the owner's tokens and the Vercel–Neon integration

- Status: Accepted; previews no longer built, [ADR-0030](0030-no-preview-builds.md) (2026-11-13); password transport corrected on 2026-11-02 after Neon rejected SCRAM verifiers (spec 0001 R7); the proof that previews do not fork from production added by [ADR-0017](0017-data-lifecycle-and-backups.md); review gate section superseded by [ADR-0019](0019-reviewers-in-the-authoring-session.md) on 2026-11-03; the `main` ruleset, imported by the owner on 2026-11-03, does not pin required checks to an app; the branch per preview turned off on 2026-11-05, when it filled Neon's Free-plan branch limit: previews share the `development` branch ([spec 0004 R1](../specs/0004-real-data-readiness.md#r1-previews-fork-from-development-and-the-build-proves-it)); the GitHub token's variable left the agent environment on 2026-11-11, at the owner's choice: sessions reach GitHub through the Claude GitHub App, the Vercel token stays, and the old token, which threads started earlier still hold, was the owner's to revoke, which he said he did the same day ([#361](https://github.com/fernandolisboa/arca/issues/361))
- Date: 2026-11-01
- Amends: [ADR-0008](0008-database-security-and-environments.md) (environments), [ADR-0010](0010-stack-revised.md) (deploys), [ADR-0011](0011-reviewers-in-ci.md) (how the gate is protected)

## Context

ADR-0010 and ADR-0011, and the spec built on them, protect the review gate and the deploy pipeline against the project's own agents: a dedicated `arca-gate` GitHub App, code-owner approval for gate paths, agents unable to push workflow files, a custom deploy pipeline on an unlinked Vercel project, Neon projects provisioned without the Vercel integration, and a bootstrap the owner runs by hand.

Each of those controls needs manual work from the owner, who is the only person on the project. The owner decided on 2026-11-01 that the cost is too high for a solo project run by agents, and that agents should do the setup themselves with the owner's tokens.

Facts that shape what stays:

- Real family data arrives in Phase 1. A preview branch cut from production would copy it, and an API connected with an owner role would bypass row-level security. Both are cheap to prevent once and expensive to undo later.
- The Vercel–Neon integration forks preview branches from the Neon project's default branch (not configurable), injects the owner role's connection string, and supports running migrations in the Vercel build ([Neon docs](https://neon.com/docs/guides/neon-managed-vercel-integration), checked 2026-11-01).
- Vercel exposes every project variable to the build and to running functions alike ([Vercel docs](https://vercel.com/docs/environment-variables)). The owner connection string the integration injects, needed to migrate in the build, is therefore reachable by the running API.
- The owner already runs other apps with the integration, and chose it on 2026-11-01 knowing the point above.

## Decision

### Agents do the setup

- Agents apply repository settings (ruleset, environment, secrets, security features) and Vercel and Neon configuration through the APIs, using tokens the owner places in the agent environment: a GitHub token and a Vercel token. The owner's GitHub token is fine-grained, limited to this repository, with an expiry.
- What a token cannot do (creating the database through Vercel's Storage tab) the owner does in a browser, once. Nothing is run by hand after that.
- Agents may push workflow files.

### The review gate

Superseded by [ADR-0019](0019-reviewers-in-the-authoring-session.md) on 2026-11-03: the reviewers no longer run in CI, so this section is history.

- The reviewers still run in CI as the required `review-gate` check, as ADR-0011 describes, with the verdict computed in code and the canary suite. The check is created by the workflow's own `GITHUB_TOKEN`, and the ruleset pins every required check, `review-gate` included, to GitHub Actions.
- Dropped: the `arca-gate` App and its `gate` environment; `CODEOWNERS` and the code-owner ruleset; the rule that agents cannot push workflows. Each existed to keep agents from acting with the owner's authority, which agents now hold by decision.
- `docs/review-acceptances.md` rows are added by the author of the change, and the reviewers on the next run see them in the diff.
- Only `CLAUDE.md`, `docs/REVIEW.md`, `docs/SECURITY.md` and the agent bodies carry instructions to the reviewers; other docs are passed as delimited reference data. This costs nothing and still limits what an injected line in a doc can do.
- Recovery from a broken gate: the owner, or an agent at the owner's request, removes `review-gate` from the ruleset for the one merge that fixes it, puts it back, and records it in the REVIEW.md change table.

### Databases

- **The owner creates the database from Vercel** (project `arca` › Storage › Neon), in São Paulo, Postgres 18, connected to Production and Preview, not Development, with a database branch per preview. This creates the Neon project and injects its connection strings. It replaces ADR-0008's separate projects. No Neon API key is needed.
- The integration injects the Neon owner role's credentials under sixteen names (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, the `PG*` and `POSTGRES_*` families, and `NEON_PROJECT_ID`; the exact list is in spec 0001 R7). Only the build scripts read them; a lint rule lists every name and forbids reading them, or reaching `process.env` indirectly, anywhere else.
- **Migrations run in the Vercel build**, before the app builds. With the owner connection, an idempotent bootstrap creates the roles and sets the passwords of `app_migrator`, `app_api` and `app_jobs` from Sensitive Vercel variables that an agent generates (random, through the Vercel API), sent as plaintext literals over TLS, because Neon rejects a precomputed SCRAM verifier (checked 2026-11-02; spec 0001 R7 has the details and the residual risk). The script accepts only generated base64url passwords, so a password can never end its SQL literal. Bootstrap and the runner use the unpooled host. Then the runner applies the `.sql` files as `app_migrator`, with the guards in the same transaction.
- **The running API connects as `app_api`** (and jobs as `app_jobs`): the pooled host and database name, which a build script copies from the injected variables into build-time configuration (never the owner user or password), with its own role and password, all passed to the client explicitly so no field falls back to the owner's `PG*` variables. Each pooled connection checks `current_user`, `/v1/health` reports it, and the production smoke test requires it. Row-level security applies to every request.
- **Preview branches fork from the integration's default branch, which is production.** That copies nothing real while production holds no family data. Before the first table that holds case data, a `development` branch with only synthetic data becomes the default branch, so previews fork from it. That change needs a Neon API key or one click in the Neon console, and the case-data slice is blocked on it.
- The Vercel project stays linked to the repository, so Git pushes deploy previews and `main` deploys production.

### What stays from the earlier ADRs

- Required checks on `main`, strict, linear history, no force pushes; dependency checks with their policy taken from `main`; secret scanning with push protection.
- ADR-0008's roles, forced row-level security and guard tests; previews never see production data.
- ADR-0009 unchanged.

## Alternatives

| Option | Why not |
| --- | --- |
| Keep ADR-0010 and ADR-0011 as written | Manual work for the owner on every setup step, mostly to defend against the owner's own agents |
| No integration; GitHub Actions jobs create branches, migrate and write variables, keeping owner credentials out of Vercel | Safer, but the owner chose the integration already in use in other apps |
| Two Neon projects | Two keys and projects to manage; one project with a production branch that previews never fork from meets ADR-0008's goal |

## Consequences

- An agent holding the owner's GitHub token can change the ruleset, merge without checks, or create a passing check of any required name from a workflow of its own, since a pin to GitHub Actions would still accept any workflow's check, and the ruleset applied on 2026-11-03 does not pin checks at all. The control is the agents' instructions and the reviewers, not GitHub. A prompt injection that reaches an agent can do what the token allows, which is why the token is limited to this repository and expires.
- **Accepted by the owner:** the owner connection string sits in Vercel's Production and Preview variables, so running functions and preview builds of any same-repository branch can read it. Whoever gets code execution in the API, or writes a branch, can bypass row-level security and reach every family's data. Fork pull requests do not get it (Vercel Git Fork Protection stays on).
- Until the `development` branch exists, previews fork from production. This is safe only while production holds no family data, so the case-data slice is blocked on it.
- The runner and its guards run from the commit being deployed, not from `main`; a change that weakens them is caught by the reviewers, not by the pipeline.
- Spec 0001 is updated to match: R7, R8, R9, R10 and its threat model.

## Sources

- [Neon docs: Neon-managed Vercel integration](https://neon.com/docs/guides/neon-managed-vercel-integration) — preview branches from the default branch, production branch and role chosen at connect, development branch option, migrations in the build (checked 2026-11-01)
- [Vercel docs: environment variables](https://vercel.com/docs/environment-variables) — variables are available during the build and at function runtime (checked 2026-11-01)

# ADR-0012: Automation-first setup with the owner's tokens and the Vercel–Neon integration

- Status: Accepted
- Date: 2026-11-01
- Amends: [ADR-0008](0008-database-security-and-environments.md) (environments), [ADR-0010](0010-stack-revised.md) (preview databases, deploys), [ADR-0011](0011-reviewers-in-ci.md) (how the gate is protected)

## Context

ADR-0010 and ADR-0011, and the spec built on them, protect the review gate and the deploy pipeline against the project's own agents: a dedicated `arca-gate` GitHub App, code-owner approval for gate paths, agents unable to push workflow files, a custom deploy pipeline on an unlinked Vercel project, Neon projects provisioned without the Vercel integration, and a bootstrap the owner runs by hand.

Each of those controls needs manual work from the owner, who is the only person on the project and already runs other apps with the Vercel–Neon integration. The owner decided on 2026-11-01 that the cost is too high for a solo project run by agents, and that agents should do the setup themselves with the owner's tokens.

Two facts shape what stays:

- Real family data arrives in Phase 1. A preview branch cut from production would copy it, and an API connected with an owner role would bypass row-level security. Both are cheap to prevent once and expensive to undo later.
- The Neon-managed Vercel integration forks preview branches from the Neon project's default branch, which is not configurable, and lets the owner choose which branch production uses and which role the injected connection string carries ([Neon docs](https://neon.com/docs/guides/neon-managed-vercel-integration), checked 2026-11-01).

## Decision

### Agents do the setup

- Agents apply repository settings (ruleset, environment, secrets, security features) and Vercel and Neon configuration through the APIs, using tokens the owner places in the agent environment: a GitHub token, a Vercel token and a project-scoped Neon API key. The owner's GitHub token is fine-grained, limited to this repository, with an expiry.
- What a token cannot do (accepting a Marketplace integration's terms, creating the Neon project) the owner does in a browser, once. Nothing is run by hand after that.
- Agents may push workflow files.

### The review gate

- The reviewers still run in CI as the required `review-gate` check, as ADR-0011 describes, with the verdict computed in code and the canary suite. The check is created by the workflow's own `GITHUB_TOKEN`, and the ruleset pins every required check, `review-gate` included, to GitHub Actions.
- Dropped: the `arca-gate` App and its `gate` environment; `CODEOWNERS` and the code-owner ruleset; the rule that agents cannot push workflows. Each existed to keep agents from acting with the owner's authority, which agents now hold by decision.
- `docs/review-acceptances.md` rows are added by the author of the change, and the reviewers on the next run see them in the diff.
- Only `CLAUDE.md`, `docs/REVIEW.md`, `docs/SECURITY.md` and the agent bodies carry instructions to the reviewers; other docs are passed as delimited reference data. This costs nothing and still limits what an injected line in a doc can do.
- Recovery from a broken gate: the owner, or an agent at the owner's request, removes `review-gate` from the ruleset for the one merge that fixes it, puts it back, and records it in the REVIEW.md change table.

### Databases

- **One Neon project, `arca`**, in São Paulo, Postgres 18, database `arca`, replacing ADR-0008's separate projects. Two long-lived branches:
  - `production`, used only by Vercel's Production environment;
  - `development`, the project's default branch, holding the synthetic seed. Preview branches fork from it, so they never copy production data.
- A check in the deploy setup asserts that the default branch is not `production`.
- **The Neon-managed Vercel integration** connects the project to the Vercel project: production uses the `production` branch, each preview gets its own branch, and the injected connection string uses the `app_api` role, so the running API never holds an owner credential.
- Migrations run in the Vercel build, before the app builds: an idempotent bootstrap creates the roles as the Neon owner role, then the migration runner applies the `.sql` files as `app_migrator` with the guards in the same transaction. Both get their connection strings from the Neon API at build time, with the project-scoped key held in Vercel's Production and Preview variables. No database password is stored.
- The Vercel project stays linked to the repository, so Git pushes deploy previews and `main` deploys production.

### What stays from the earlier ADRs

- Required checks on `main`, strict, linear history, no force pushes; dependency checks with their policy taken from `main`; secret scanning with push protection.
- ADR-0008's roles, forced row-level security and guard tests; previews never see production data.
- ADR-0009 unchanged.

## Alternatives

| Option | Why not |
| --- | --- |
| Keep ADR-0010 and ADR-0011 as written | Manual work for the owner on every setup step, mostly to defend against the owner's own agents |
| Vercel-managed Neon integration (new Neon account billed through Vercel) | The owner already has a Neon organization; the Neon-managed integration keeps billing and projects there |
| Integration with the owner role in `DATABASE_URL` | The API would bypass row-level security; choosing `app_api` costs nothing |
| Two Neon projects with the integration | The integration links one project; production would need hand-set variables, which is the manual work this ADR removes |

## Consequences

- An agent holding the owner's GitHub token can change the ruleset or merge without checks. The control is the agents' instructions and the reviewers, not GitHub. A prompt injection that reaches an agent can do what the token allows, which is why the token is limited to this repository and expires.
- The Neon key in Vercel's Preview variables is readable by preview builds, which run branch code. It can reach the `production` branch. Fork pull requests do not get it (Vercel Git Fork Protection stays on); same-repository branches are written by the owner's agents. Residual risk, accepted.
- Production and development share one Neon project: one API key covers both, and a mistaken branch operation could touch production. Point-in-time restore covers the second.
- The runner and its guards run from the commit being deployed, not from `main`; a change that weakens them is caught by the reviewers, not by the pipeline.
- Spec 0001 is updated to match: R7, R8, R9, R10 and its threat model.

## Sources

- [Neon docs: Neon-managed Vercel integration](https://neon.com/docs/guides/neon-managed-vercel-integration) — preview branches from the default branch, production branch and role chosen at connect, migrations in the build (checked 2026-11-01)
- [Neon docs: Vercel integration overview](https://neon.com/docs/guides/vercel-overview) — Neon-managed versus Vercel-managed (checked 2026-11-01)

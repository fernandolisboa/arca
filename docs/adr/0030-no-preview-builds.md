# ADR-0030: Vercel builds production only

- Status: Accepted, amended in place on 2026-11-14 (branch rules replace `ignoreCommand`; `main` must stay the Vercel production branch)
- Date: 2026-11-13
- Amends: [ADR-0010](0010-stack-revised.md) (hosting: no preview deployment per pull request); [ADR-0012](0012-automation-first-setup.md) (Git pushes no longer deploy previews); [ADR-0008](0008-database-security-and-environments.md) (preview deployments)

## Context

Since 2026-11-05 every preview migrates the one shared Neon `development` branch ([spec 0004 R1](../specs/0004-real-data-readiness.md#r1-previews-fork-from-development-and-the-build-proves-it)). Agent threads work on many branches at once. A branch behind `main` fails with "the journal lists N migrations, more than on disk"; two branches with different migrations fail on a journal row mismatch. Vercel emails the owner for each failure, dozens a day, and none of them says anything about the change itself. Nobody opens previews: they sit behind Deployment Protection, and CI already runs roles, migrations, guards, the seed and `e2e` on its own Postgres.

## Decision

`git.deploymentEnabled` in `apps/api/vercel.json` deploys `main` only (`"**": false, "main": true`; a branch matching any `true` rule deploys, per [Vercel's git configuration](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled), read 2026-11-14; the first `main` deployment after the change confirms it). A test in `tooling/scripts/test/vercel-config.test.ts` pins it.

## Consequences

- No failed-preview emails, and no drift on `development`.
- Neon-specific checks (endpoint mark, lineage mark, migrations on Neon) run only in the production build. A failure there leaves the previous production deployment live, and the fix is a new pull request.
- Preview-only paths stay in the code but are dormant: the outbox page and the monitoring check of spec 0003 and spec 0004, the branch-URL relying-party ID, the seed on `development`. Docs that describe them on previews describe what a preview would do if built.
- The OWASP ZAP baseline in [SECURITY.md](../SECURITY.md) targets the production origin instead of previews.
- Accepted risk: the first run of a migration on Neon is production's build. Migrations already must work with the running code, and CI runs them on Postgres first.
- The Preview-scoped database variables stay set, so previews can be turned back on without an owner step. They are no wider than before: any branch could already build a preview.
- A fork controls its own `vercel.json`, so neither form of the branch rule is a barrier to a fork's pull request: Git Fork Protection stays on, and a fork's deployment is never authorized.
- Turning previews back on is removing `git.deploymentEnabled`, after giving each preview its own database or keeping `development` in step with `main`.

## Amendment 2026-11-14

The first form, `ignoreCommand: [ "$VERCEL_ENV" != production ]`, also cancelled every production build: from bb12be5 (#435) to 03e79bf (#438) Vercel marked each `main` deployment CANCELED with no build, and production stayed on 8adb68c. The command behaved as intended in `sh` locally, so the cause, not confirmed, sits in how Vercel runs the ignored build step (likely an empty `VERCEL_ENV` there). Branch rules in `git.deploymentEnabled` need no shell and no system variable, so they replace it.

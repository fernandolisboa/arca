# ADR-0007: Background jobs with Vercel Workflows, pinned to São Paulo

- Status: Accepted
- Date: 2026-11-01 (replaces an earlier choice of Trigger.dev, rejected after review)

## Context

Several Arca features are long-running or multi-step and must survive failures: research agents that search the web and draft routes for a new country, the rule watcher, document review, interview analysis, and recomputing plans after a rule change. They cannot run inside API requests.

A job that processes a case reads that case's data and holds database and model credentials, wherever it runs. Running jobs on a third-party compute platform outside Brazil therefore makes that platform a processor of all case data, whatever the job payload contains.

## Decision

- **Vercel Workflows** (open-source Workflow SDK, `'use workflow'` and `'use step'`) runs all background work, as code inside `apps/api`.
- Functions are deployed to the São Paulo region, and runs are pinned there, so step execution, run state, queue dispatch and streams stay in Brazil.
- Step inputs and outputs are recorded by the platform and readable by team owners. They carry **identifiers only** (case ID, document ID, route ID); steps load data from our database and storage under scoped roles ([ADR-0008](0008-database-security-and-environments.md)).
- Steps are idempotent and retry safely; side effects are keyed to avoid duplicates.
- Results that change the knowledge base enter as proposals awaiting human approval ([ADR-0002](0002-rules-as-versioned-data.md)).
- Run data retention is set to the minimum the product needs, and case deletion deletes related run data.
- Jobs that need a document's plaintext follow the vault encryption ADR (pending); plaintext exists only in memory during a processing session the user authorized.

## Alternatives

| Option | Why not |
| --- | --- |
| Trigger.dev Cloud | Task code runs on Trigger.dev machines (not in Brazil) with our credentials, loading full case data; self-hosting avoids that but adds a system to operate |
| Inngest (cloud or self-hosted since 1.0) | Mature step functions; one more system or vendor, with nothing gained over workflows on the platform we already deploy to |
| Postgres-backed queue (pg-boss) on our own worker | We would operate workers, scaling and dashboards ourselves |

## Consequences

- No extra vendor holds credentials or case data; processing stays in the same region as the database.
- Each step runs as a function invocation, so long agent work is split into steps (one model call, one search, one write per step).
- The Workflow SDK is open source, which keeps an exit path if Vercel stops fitting.

## Sources

- [Vercel docs: Workflows](https://vercel.com/docs/workflow) — runs pinned to one region with state, queue and streams kept there; run data recorded and readable by owners (checked 2026-11-01)
- [Create With: Vercel Workflows reaches general availability](https://www.createwith.com/tool/vercel/updates/vercel-workflows-reaches-general-availability-for-long-running-processes) — GA on 2026-04-16 (checked 2026-11-01)
- [Workflow SDK: getting started](https://workflow-sdk.dev/docs/getting-started) — Hono supported (checked 2026-11-01)
- [Inngest docs: self-hosting](https://www.inngest.com/docs/self-hosting) — available since 1.0 (checked 2026-11-01)

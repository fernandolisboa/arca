# ADR-0009: Background jobs with Vercel Workflows, with verified data guarantees

- Status: Accepted
- Date: 2026-11-01
- Supersedes: [ADR-0007](0007-background-jobs.md)
- Amends: [ADR-0008](0008-database-security-and-environments.md), "Backups and deletion" (workflow run data)

## Context

ADR-0007 chose Vercel Workflows and stated four guarantees. Checked against Vercel's documentation on 2026-11-01, each needs correcting:

| ADR-0007 said | What the platform does |
| --- | --- |
| Runs are pinned to São Paulo | Runs created by `workflow` 4.x always live in `iad1` (U.S.). Region pinning needs 5.x; a run is pinned to the region of the function that started it, or to the `region` passed to `start()` |
| Step execution, run state, queue and streams stay in Brazil | Run payloads, run records, streams and queue dispatch stay in the run's region. Run metadata (IDs, workflow and step names, statuses, timestamps, error codes, attributes, hook tokens) is not encrypted, is processed by observability systems outside the region, and can be kept for up to one year. Hook records live in `iad1` unless another region is chosen |
| Case deletion deletes related run data | Finished runs cannot be deleted through any API, CLI or dashboard action. Payloads stay readable for the plan's retention period (7 days on Pro) and are deleted within 96 days. Runs started with zero retention become unreadable when they finish and are deleted within 36 days |
| Hono is supported | It is, through Nitro: Hono has no build system, and Nitro compiles the `'use workflow'` and `'use step'` directives. `nitro` 3 is a release candidate as of this date |

Run payloads are encrypted end to end by the Workflow SDK; team owners, or members given the Workflow Run Data Viewer permission, can decrypt them.

The reasons for choosing Vercel Workflows in ADR-0007 still hold: no extra vendor holds credentials or case data, and processing stays in the same region as the database.

## Decision

- **Vercel Workflows** (Workflow SDK, `'use workflow'` and `'use step'`) runs all background work, as code in `apps/api/src/workflows`.
- **SDK version:** `workflow` 5.x or later, pinned exactly. 4.x is not allowed.
- **Region:** API functions deploy only to `gru1`. Every `start()` passes `region: 'gru1'` explicitly, through one shared helper; a test asserts the helper is the only caller of `start()`. Hook records are configured to `gru1`.
- **Retention:** every run starts with zero retention (`experimental_retention: 0`). A step that needs to keep a result writes it to our database before the run finishes. If the option changes name or behavior, the shared helper is the one place to update.
- **Payloads carry identifiers only** (case ID, document ID, route ID, a date). Steps load data from our database and storage under the `app_jobs` role ([ADR-0008](0008-database-security-and-environments.md)).
- **Metadata carries no personal data.** Workflow and step function names, run attributes, error messages and hook tokens never include personal data or case content. Errors thrown from steps use codes, not messages built from data. Run attributes are not used until a reviewed allow-list exists.
- **Nitro** is the API's build and deploy shell, because the Workflow SDK needs it with Hono. It is pinned exactly. The Hono app is built and tested without Nitro, so Nitro can be replaced without touching routes.
- Steps are idempotent and retry safely; side effects are keyed to avoid duplicates.
- Results that change the knowledge base enter as proposals awaiting human approval ([ADR-0002](0002-rules-as-versioned-data.md)).
- No job handles document plaintext: [ADR-0018](0018-vault-encryption.md) allows plaintext only in the memory of one request the owner authorized.
- No public, unauthenticated route starts a workflow.
- Finishing a request after its answer, in the same function invocation through the platform's `waitUntil`, is not background work under this ADR. It keeps nothing outside that invocation's memory, is never retried, and is used only where losing the work is harmless because the person can simply ask again. The first use is recovery's link email (spec 0003 R6): its route is public, so it may not start a workflow, and the address and token it needs would not belong in a run's payload anyway.

### Amendment to ADR-0008

ADR-0008 says deleting a case deletes related data in workflow runs. That cannot be done. Instead: workflow runs hold identifiers only and start with zero retention, so after a case is deleted its runs hold only identifiers that point at nothing. Vercel deletes their payloads within 36 days; their metadata (IDs, names, statuses, timestamps, no personal data) can be kept up to one year. The retention schedule records both windows.

## Alternatives

| Option | Why not |
| --- | --- |
| Keep ADR-0007 unchanged | Its guarantees are not true of the platform |
| Postgres-backed queue (pg-boss) on our own worker | All data stays in our database, but we operate workers, scaling and dashboards ourselves |
| Inngest or Trigger.dev | Same reasons as in ADR-0007: another system or vendor holding credentials, with no gain |

## Consequences

- Run payloads and queue messages stay in São Paulo. Run metadata, with no personal data in it, is processed outside Brazil; the data-flow register says so.
- Zero retention removes payload inspection after a run ends; debugging relies on our own logs and the database rows steps write.
- The API depends on a release-candidate build tool. Its version is pinned, its upgrades go through the supply-chain reviewer, and the Hono app does not depend on it.
- Case deletion leaves identifier-only run payloads at Vercel for up to 36 days, and run metadata for up to one year.
- **How the SDK's routes reject requests the queue did not send** (spec 0001, R6; checked 2026-11-02 against `workflow` 5.2.3):
  - The runner, `/.well-known/workflow/v1/flow`, does not verify a signature itself: `@vercel/queue`'s callback handler runs the pushed message. Its protection is the platform's. The Nitro integration deploys the runner as its own function with a `queue/v2beta` trigger, and Vercel keeps queue consumers private: no public URL, invoked only by the queue ([Vercel Queues quickstart](https://vercel.com/docs/queues/quickstart)). A test asserts the trigger in the build output, and the production smoke test sends an unsigned request and requires 401, 403 or 404.
  - The webhook route, `/.well-known/workflow/v1/webhook/:token`, is public by design: it resumes a hook by its token. Arca creates no hooks, so every token answers 404. A workflow that adds a webhook needs its own review of token entropy and of what the hook accepts.
- **Supply chain** (#10, npm registry checked 2026-11-02):
  - The SDK's builder resolves `workflow/internal/builtins`, so the umbrella `workflow` package is the dependency. It depends on every framework adapter and the CLI; `autoInstallPeers: false` keeps the NestJS adapter's required peers from pulling in NestJS. Install scripts stay off (`allowBuilds` false for `@swc/core`, `esbuild` and `cbor-extract`, which ship prebuilt binaries or a JavaScript fallback).
  - Six `@vercel/*` packages the SDK depends on are published from GitHub Actions without the provenance earlier versions carried. The owner accepted them on 2026-11-02, and they are listed in `trustPolicyExclude` by exact version.
  - `@swc/core` 1.15.3 (pinned by the SDK) and `chokidar` 4.0.3 (pinned by its CLI) lost provenance the same way; overrides move them to 1.15.4 and 5.0.0, which carry it. The SDK's SWC plugin fails on `@swc/core` 1.16, so the override stays on 1.15 until the SDK moves.

## Sources

- [Vercel docs: Workflows, multi-region](https://vercel.com/docs/workflow) (checked 2026-11-01)
- [Vercel docs: Workflow data retention](https://vercel.com/docs/workflows/retention) — storage per region, metadata, deletion, zero retention (checked 2026-11-01)
- [Workflow SDK: getting started with Hono](https://workflow-sdk.dev/docs/getting-started/hono) — Nitro required (checked 2026-11-01)
- [Vercel Queues quickstart](https://vercel.com/docs/queues/quickstart) — consumers are private and invoked only by the queue (checked 2026-11-02)
- [SWC plugin compatibility](https://swc.rs/docs/plugin/ecmascript/compatibility) (checked 2026-11-02)

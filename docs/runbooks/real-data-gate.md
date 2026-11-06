# Real-data gate

Production accepts family data only when every item below is checked ([spec 0004 R13](../specs/0004-real-data-readiness.md#r13-threat-model-and-the-real-data-gate)). The same checklist is kept in epic [#63](https://github.com/fernandolisboa/arca/issues/63); change both together.

- Check an item here and in the epic only when its evidence is linked.
- An item that depends on the project owner says what they do.
- Status as of 2026-11-06.

## Checklist

- [x] **1. Previews fork from `development`, proven by R1.** (Checked 2026-11-05.)
  - **Evidence:**
    - the preview build never bootstraps or migrates production ([db-deployment-target.test.ts](../../tooling/scripts/test/db-deployment-target.test.ts), [bootstrap.test.ts](../../tooling/scripts/test/postgres/bootstrap.test.ts));
    - the lineage mark ([#64](https://github.com/fernandolisboa/arca/issues/64)): production writes it, and a preview that finds it fails before any migration ([runner.test.ts](../../tooling/scripts/test/postgres/runner.test.ts)).
    - the synthetic seed ([#65](https://github.com/fernandolisboa/arca/issues/65)): preview builds and CI run it as `app_auth` after migrations, a second run changes nothing, production skips it and the seed refuses it ([seed.test.ts](../../tooling/scripts/test/postgres/seed.test.ts), [db-seed.test.ts](../../tooling/scripts/test/db-seed.test.ts)), and a seeded account signs in with a virtual authenticator ([seeded.spec.ts](../../apps/web/e2e/seeded.spec.ts)).
    - the first preview after #64 merged (PR #218, 2026-11-05 19:13 UTC) built against `development`: roles bootstrapped, 0 migrations applied past both marks, synthetic seed applied; recorded on [#64](https://github.com/fernandolisboa/arca/issues/64).
  - **Owner steps (done 2026-11-05):**
    - before #64 merges, create the Neon `development` branch from `main` (the production branch), with its data, and reset the owner role's password on it;
    - turn off the integration's branch per preview, and give Preview its own `PGHOST`, `PGHOST_UNPOOLED`, `PGDATABASE`, `PGUSER` and `PGPASSWORD` from `development`.
- [x] **2. Spec 0003 is done in production on `arca.filx.app`, including recovery, which needs the email domain (ADR-0015).**
  - **Evidence:**
    - the identity tickets #53 to #62 are closed;
    - production names its host and the sending domain `filx.app` ([production-site.ts](../../apps/api/src/production-site.ts)), with `RESEND_API_KEY` set, so `/v1/health` answers `accounts: open` (PRs #213 to #215);
    - the owner enrolled on `arca.filx.app` with the enrollment code on 2026-11-05, which also proved the email link.
- [x] **3. Sentry reports from server and client, scrubbed (R3 to R5).**
  - **Evidence:**
    - [#66](https://github.com/fernandolisboa/arca/issues/66), [#67](https://github.com/fernandolisboa/arca/issues/67) and [#68](https://github.com/fernandolisboa/arca/issues/68) are closed;
    - the scrubber and tunnel tests are listed under W4 and W5 in the [threat model](../threat-models/foundations.md#web-and-api-specs-0001-and-0004);
    - the first preview event, checked by the owner in Sentry on 2026-11-04, showed no synthetic personal data. Production reports with the same DSN and scrubber ([sentry-project.ts](../../packages/telemetry/src/sentry-project.ts)), only under another environment tag.
- [x] **4. Registry guard, export and deletion work (R7 to R9).**
  - **Evidence:** [#69](https://github.com/fernandolisboa/arca/issues/69), [#70](https://github.com/fernandolisboa/arca/issues/70) and [#71](https://github.com/fernandolisboa/arca/issues/71) are closed. The tests are listed under L1 and L2 in the [threat model](../threat-models/foundations.md#data-lifecycle-spec-0004).
- [x] **5. Retention jobs run (R10).**
  - **Evidence:** [#72](https://github.com/fernandolisboa/arca/issues/72) is closed. The daily cron and its tests are listed under L3 in the [threat model](../threat-models/foundations.md#data-lifecycle-spec-0004). Production's workflow run list shows `enforceRetention` completed at 06:15 UTC on 2026-11-05 and again on 2026-11-06 (checked 2026-11-06).
- [x] **6. Runbook written (R11).**
  - **Evidence:** the [incident-response runbook](incident-response.md) and `security.txt`, merged in PR #173. The owner dropped the tabletop on 2026-11-05.
- [x] **7. The Neon restore steps are in the runbook (R12).**
  - **Evidence:** the [restore steps](incident-response.md#restore-the-database).
- [x] **8. The threat model is written and reviewed (R13).**
  - **Evidence:** the [foundations threat model](../threat-models/foundations.md), merged in PR #210 after the security and architecture reviews passed ([#76](https://github.com/fernandolisboa/arca/issues/76)).
  - Revisit it at the start of each epic, as SECURITY.md asks.
- [x] **9. The access-matrix suite covers every table with case data.**
  - **Evidence:**
    - guard 1 forces row-level security on every table;
    - each schema's matrix lists its exact tables;
    - the tests are listed under D4 and D5 in the [threat model](../threat-models/foundations.md#database-and-environments-specs-0001-and-0004).
  - The covered schemas are `app`, `auth`, `audit`, `account`, `vault` and `notification`.
  - A new schema needs its matrix in the same pull request.
- [x] **10. Every AI adapter reachable in production passes the synthetic evaluation suite in CI, adversarial cases included, and more.** The item also asks that each model vendor be in the data-flow table with its training and retention settings, and that the scrubber suite cover model calls (R6). If Langfuse is adopted, its masking must be wired and RETENTION.md must have its row.
  - **Evidence:** the only model SDK is the Claude intake adapter in `apps/api` ([spec 0008](../specs/0008-free-text-intake.md)), and production has it since its evaluation suite passed twice on the same commit, as `apps/api/src/intake/environment.ts` required until then: the cases in `apps/api/test/eval/intake`, adversarial ones included, run by the manual `intake-eval` workflow on `main` at `3e5f1a3`. Run [42224358826](https://github.com/fernandolisboa/arca/actions/runs/42224358826) scored precision 95.5% and recall 72.8%, run [42224499841](https://github.com/fernandolisboa/arca/actions/runs/42224499841) 98.2% and 74.8%, with no leak and no forbidden fact; the lower pair is the recorded `baseline.json`. [untracked-surfaces.test.ts](../../tooling/scripts/test/untracked-surfaces.test.ts) holds the SDK list. Anthropic's row in the [data-flow table](../ARCHITECTURE.md#data-flows) records its training and retention terms, and the scrubber suite has a model-call span case.
  - A pull request that adds another model SDK fails that test. It unchecks this item here and in the epic, and changes the test, until it meets the item.

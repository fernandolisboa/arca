# Open questions

## Decisions for the founder

- [ ] Confirm the name (Arca, or an alternative) and check trademark availability in Brazil (INPI) and the U.S. (USPTO) before Phase 3.
- [x] Confirm the stack ([ADR-0003](adr/0003-stack.md)), accepted 2026-11-01; revised by [ADR-0010](adr/0010-stack-revised.md) the same day.
- [x] Repository visibility: public, decided 2026-11-01 ([ADR-0010](adr/0010-stack-revised.md)).
- [x] Create the database from Vercel (project `arca` › Storage › Neon, São Paulo, Production and Preview only) ([ADR-0012](adr/0012-automation-first-setup.md)), done 2026-11-01. Before the first case-data table, previews switch to a synthetic `development` branch.
- [ ] Turn on the deploy steps ([spec 0001, R9](specs/0001-foundations-scaffold.md#r9-deploy)): the Sensitive Vercel variables `ARCA_DB_MIGRATOR_PASSWORD`, `ARCA_DB_API_PASSWORD` and `ARCA_DB_JOBS_PASSWORD` (Production and Preview, distinct values) and `CRON_SECRET` (Production), and the project's `repository_dispatch` events toggle (Settings › Git), which the smoke test runs on. Until the variables exist, every Vercel build fails at the bootstrap. Agents cannot write Vercel variables or project settings with the access they have.
- [ ] Turn on the review gate ([ADR-0013](adr/0013-review-gate-canary-and-model-pins.md)): create the `review` environment limited to `main` with a `CLAUDE_CODE_OAUTH_TOKEN` secret (from `claude setup-token`), add the same token as a Dependabot secret of that name, then dispatch `review-canary`. Agents cannot write these settings with the access they have.
- [ ] Rotate the review gate's `CLAUDE_CODE_OAUTH_TOKEN` before 2027-11-02: the token from `claude setup-token` lasts one year ([ADR-0013](adr/0013-review-gate-canary-and-model-pins.md)). Run it again and replace both the `review` environment secret and the Dependabot secret.
- [ ] Choose and register the production domain before Phase 1: passkeys are bound to it, and changing it later invalidates every passkey, and every vault envelope sealed to one (PRF), leaving only the recovery kits. Production refuses every sign-up until the domain is set ([spec 0003](specs/0003-identity-and-access.md) R9); invites and recovery emails also need it.
- [ ] Owner setup steps for the foundations, each asked once, with exact clicks, when its ticket starts: make `development` the default Neon branch (spec 0004 R1); create the Sentry organization in the German region (spec 0004 R4); create the AWS backup account and launch its template (spec 0004 R12); create the AWS application account and launch its template (spec 0005 R3); create the Resend account and add its SPF, DKIM and DMARC records to the domain's DNS (spec 0003 R8); OK for agents to create the new Sensitive Vercel variables (database passwords for `app_auth`, `app_audit` and `app_backup`, `BETTER_AUTH_SECRET`, Resend and Sentry tokens, VAPID keys).
- [ ] Google Play account type: personal (needs a 12-tester, 14-day closed test before production) or organization (requires a company).
- [ ] iOS builds: a Mac with Xcode, or a cloud build service.
- [ ] Apple Developer Program enrollment: individual or organization (the seller name shown on the App Store follows it).

## Engineering decisions deferred to a later date

Made by agents, tracked here so they are not lost.

- [ ] Audit-log purge: an ADR before the first `audit.event` record turns 5 years old (2031), since it changes ADR-0008's insert-only log ([ADR-0017](adr/0017-data-lifecycle-and-backups.md)).
- [ ] Resend's log and body retention for the plan, recorded in [RETENTION.md](RETENTION.md) by the email ticket.
- [ ] License exception for Sentry's build tooling (`@sentry/vite-plugin`, through `@sentry/bundler-plugin-core` and `@sentry/cli`, FSL-1.1-Apache-2.0), or keeping it out, decided by the server Sentry ticket.
- [ ] `@noble/post-quantum` audit: the vault's residual ends when one is published ([ADR-0018](adr/0018-vault-encryption.md)).
- [ ] The `knowledge_*` step-up purposes in ADR-0015 and spec 0003 are conditional on ADR-0014 (pull request #39): confirm them when it is accepted, or remove or adjust them.
- [ ] Web push library (spec 0005 R7): a maintained WebCrypto-based one with provenance, or `web-push` with an MPL-2.0 license exception, decided by the notifications ticket.
- [ ] Langfuse retention, set when it is adopted ([ADR-0016](adr/0016-observability-and-scrubbing.md)).

## Case 1 facts to gather (answers go into the app, not this repo)

- [ ] Countries each person accepts, with priority, and whether units may end up in different countries.
- [ ] Who holds title to each property, and whether the other parent has assets of their own.
- [ ] Estimated net value of the assets in BRL, after capital-gains tax.
- [ ] Country of birth of the parents and grandparents of all six adults.
- [ ] Operating companies anyone runs, and whether any employer has an entity outside Brazil.
- [ ] Who in the family may see what (finances, documents).

## Product questions

- [ ] Which partner types to seed first (destination lawyers, sworn translators, FX providers) and how to vet them.
- [ ] How the knowledge base is reviewed once there are many countries: founder only, or invited reviewers per country.
- [ ] Voice in the MVP intake, or text first.

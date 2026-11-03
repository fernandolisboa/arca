# Open questions

## Decisions for the founder

- [ ] Confirm the name (Arca, or an alternative) and check trademark availability in Brazil (INPI) and the U.S. (USPTO) before Phase 3.
- [x] Confirm the stack ([ADR-0003](adr/0003-stack.md)), accepted 2026-11-01; revised by [ADR-0010](adr/0010-stack-revised.md) the same day.
- [x] Repository visibility: public, decided 2026-11-01 ([ADR-0010](adr/0010-stack-revised.md)).
- [x] Create the database from Vercel (project `arca` › Storage › Neon, São Paulo, Production and Preview only) ([ADR-0012](adr/0012-automation-first-setup.md)), done 2026-11-01. Before the first case-data table, previews switch to a synthetic `development` branch.
- [ ] Turn on the deploy steps ([spec 0001, R9](specs/0001-foundations-scaffold.md#r9-deploy)): the Sensitive Vercel variables `ARCA_DB_MIGRATOR_PASSWORD`, `ARCA_DB_API_PASSWORD` and `ARCA_DB_JOBS_PASSWORD` (Production and Preview, distinct values) and `CRON_SECRET` (Production), and the project's `repository_dispatch` events toggle (Settings › Git), which the smoke test runs on. Until the variables exist, every Vercel build fails at the bootstrap. Agents cannot write Vercel variables or project settings with the access they have.
- [x] Delete the `review` environment (with its `CLAUDE_CODE_OAUTH_TOKEN` secret), the Dependabot secret of the same name and any `REVIEW_MODEL_*` variables: a live one-year subscription token with no purpose ([ADR-0019](adr/0019-reviewers-in-the-authoring-session.md)). Agents cannot write these settings. Done by the owner on 2026-11-03, who also said he revoked the old Anthropic API key.
- [x] Production host: `arca.filx.app`, on `filx.app`, claimed through Vercel and added to the project on 2026-11-03 ([ADR-0015](adr/0015-identity-enrollment-step-up-and-recovery.md)). The same subdomain is the Resend sending domain; its DNS records come with the Resend ticket (spec 0003 R8).
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
- [ ] Web push library (spec 0005 R7): a maintained WebCrypto-based one with provenance, or `web-push` with an MPL-2.0 license exception, decided by the notifications ticket.
- [ ] One active passkey controls the account (ADR-0015 residual): decide before the real-data gate whether revoking passkeys, regenerating the kit and cancelling recovery need the designated adult or a 24-hour cancellable delay.
- [ ] Renamed states in citizenship and ancestry facts: ISO 3166-3 also retires codes of states that still exist under a new name (`BUMM` to `MM`, `DYBJ` to `BJ`, `ZRCD` to `CD`). Decide, before the first descent route, whether a rule naming the current code also matches the retired one, as a reviewed mapping in the knowledge base ([spec 0002](specs/0002-rules-engine-and-knowledge-base.md#r7-countries)).
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
- [x] Who activates knowledge-base versions ([ADR-0014](adr/0014-knowledge-base-as-reviewed-data.md)): the founder alone, with an independent check agent that uses a guide per country; no lawyer and no invited reviewers per country (decided 2026-11-03).
- [x] Which countries the knowledge seed (consultancy core slice 2, [spec 0002](specs/0002-rules-engine-and-knowledge-base.md#the-epic-consultancy-core)) researches first: the United States and Portugal, then 19 more in the owner's order (decided 2026-11-03).
- [ ] Voice in the MVP intake, or text first. Proposed: text first, voice later through `SpeechToText` ([spec 0002](specs/0002-rules-engine-and-knowledge-base.md#the-epic-consultancy-core)), until the founder confirms.

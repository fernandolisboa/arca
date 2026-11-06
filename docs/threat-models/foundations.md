# Foundations threat model

As of 2026-11-05, written after the foundations epics landed ([spec 0004 R13](../specs/0004-real-data-readiness.md#r13-threat-model-and-the-real-data-gate)). It covers what was built for specs [0001](../specs/0001-foundations-scaffold.md), [0003](../specs/0003-identity-and-access.md), [0004](../specs/0004-real-data-readiness.md) and [0005](../specs/0005-vault-devices-and-notifications.md), and it gathers the threat tables of those specs in one place. Each control links to the test or the recorded proof that shows it holds. The [real-data gate](../runbooks/real-data-gate.md) uses this document as its item 8.

**How to read the evidence column.**
- A test is named by its file and its quoted test name, without a line number, so the link survives edits.
- Unit tests run in the `check` job of [ci.yml](../../.github/workflows/ci.yml).
- Tests under a `postgres` folder run in its `db` job.
- Playwright tests (`e2e`) run in its `e2e` job.
- A row marked **Open** has no proof yet. The [gaps](#open-gaps) list its ticket.

## Assets

| Asset | Where it lives |
| --- | --- |
| Family documents (passports, certificates) | Vercel Blob, as client-side age ciphertext under random pathnames |
| Vault identities and recovery secrets | The device's memory while unlocked; envelopes (PRF and the printed recovery kit's secret) on the server |
| Passkeys, sessions, step-up assertions, recovery codes, invites, the enrollment code | `auth` schema on Neon, reachable by `app_auth` only |
| Family relationships (account links) and sharing choices | `account.link`, `vault.document_recipient`, the owner-tagged sharing state |
| The audit log | `audit.event`, append-only |
| Notification channels (email address in `auth`, push subscriptions) | `notification` schema; browser push services |
| Integrity of `main`, the reviewer definitions and the deployment | GitHub, Vercel |
| The owner's credentials: the Neon owner string, the GitHub and Vercel tokens | Vercel environment variables, the agent environment |

No case data (diagnosis, routes, finances) exists yet. The knowledge base is public data with its own threat model in [spec 0002](../specs/0002-rules-engine-and-knowledge-base.md).

## Trust boundaries and data flows

The [data-flow table](../ARCHITECTURE.md#data-flows) lists every service and what it may receive. The boundaries that matter:

1. **Browser ↔ API**, on one origin per environment.
   - The browser is trusted only with its own account's data.
   - Every request is validated by the Zod contract.
   - Sensitive actions need a passkey step-up.
2. **API ↔ Postgres.**
   - The API connects as `app_api`, `app_auth`, `app_jobs` or `app_audit`, never as the owner.
   - Row-level security is forced, with the identity set per transaction.
3. **API ↔ Workflows.** Payloads carry identifiers only. The runner is a private queue consumer.
4. **Browser ↔ Vercel Blob.** The browser uploads ciphertext with a short-lived grant and downloads through a URL that is never cached. The server never sees plaintext.
5. **API ↔ outbound services.**
   - **Resend:** an address and a generic message with one link.
   - **Browser push services:** a code and an ID, encrypted to the subscription.
   - **Sentry:** scrubbed errors only, with browser events relayed through our own tunnel.
6. **Repository ↔ CI ↔ Vercel.** Branch code builds previews against preview databases. Only `main` deploys production.
7. **Authoring agents ↔ repository and vendors.** Coding agents and their reviewers hold the owner's tokens. Everything they read is data.

## Threats, controls and evidence

### Supply chain and delivery (spec 0001)

| ID | Threat | Control | Evidence |
| --- | --- | --- | --- |
| S1 | Tampering: a malicious dependency version | pnpm settings and exact pins; lockfile release age, integrity and license checks; dependency sources limited to the registry | [policy.yml](../../.github/workflows/policy.yml) job `lockfile-policy`; [check-release-age.test.ts](../../tooling/scripts/test/check-release-age.test.ts) "rejects an entry %s"; [check-licenses.test.ts](../../tooling/scripts/test/check-licenses.test.ts) "license check"; [check-dependency-sources.test.ts](../../tooling/scripts/test/check-dependency-sources.test.ts) "rejects %s" and "rejects pnpm settings in package.json"; [setup-pnpm.test.ts](../../tooling/scripts/test/setup-pnpm.test.ts) "pnpm setup" |
| S2 | Tampering: a malicious or moved CI action | Actions pinned by commit SHA | **Open**: a convention enforced by review only, with no check ([#6](https://github.com/fernandolisboa/arca/issues/6)) |
| S3 | Known-vulnerable code or a leaked secret | osv-scanner, gitleaks, secret scanning with push protection, CodeQL, the workflow secrets lint | [policy.yml](../../.github/workflows/policy.yml) jobs `osv-scanner`, `gitleaks` and `secrets-lint`; [codeql.yml](../../.github/workflows/codeql.yml) job `codeql`; [check-workflow-secrets.test.ts](../../tooling/scripts/test/check-workflow-secrets.test.ts) "workflow secrets lint" |
| S4 | Tampering: a change weakens the reviewers or the flow | A change to agent and review configuration (the security reviewer, REVIEW.md, CLAUDE.md "How we build", `docs/agents/`) needs the security reviewer's PASS plus a change-log entry; the `mattpocock-skills` plugin is third-party process text that updates itself, adopted at 1.2.3 and outranked by CLAUDE.md ([ADR-0024](../adr/0024-mattpocock-skills-flow.md)) | Recorded proof: each PR's review section. Residual R-1 |
| S5 | Elevation: branch code reaches secrets | No GitHub secrets besides each workflow's `GITHUB_TOKEN`; event values only through validated `env:` | [check-workflow-secrets.test.ts](../../tooling/scripts/test/check-workflow-secrets.test.ts) "workflow secrets lint". Residual R-2 |

### Database and environments (specs 0001 and 0004)

| ID | Threat | Control | Evidence |
| --- | --- | --- | --- |
| D1 | Tampering: a migration disables its own guards | Parser-vetted statements; a runner-owned transaction; guards on `pg_catalog`; roles created only by `bootstrap.sql`; `app_migrator` without `CREATEROLE` | [guards.test.ts](../../tooling/scripts/test/postgres/guards.test.ts) "guard %i fails on: %s"; [db-vet.test.ts](../../tooling/scripts/test/db-vet.test.ts) "rejects %s"; [runner.test.ts](../../tooling/scripts/test/postgres/runner.test.ts) "rejects %s and commits nothing"; [bootstrap.test.ts](../../tooling/scripts/test/postgres/bootstrap.test.ts) "creates the app roles as plain login roles, the retired ones without login, and only app_migrator may create" |
| D2 | Elevation: a service connects as the owner or bypasses row-level security | Owner credentials read only by build scripts (lint); every pooled connection checks `current_user`; guard 5 on inherited roles | [no-owner-environment.test.js](../../tooling/eslint-config/test/no-owner-environment.test.js) "applies the rule to every package kind except the build scripts"; [config.test.ts](../../apps/api/test/config.test.ts) "never falls back to the owner password"; [runtime.test.ts](../../packages/db/test/postgres/runtime.test.ts) "closes a connection that runs as another role and reports wrong_role"; [owner.test.ts](../../tooling/scripts/test/postgres/owner.test.ts) "fails guard 5 when the owner also inherits an app role" |
| D3 | Injection into the identity statement | `set_config` with bind parameters; UUID validation before any SQL | [identity.test.ts](../../packages/db/test/identity.test.ts) "rejects %s before any SQL runs"; [runtime.test.ts](../../packages/db/test/postgres/runtime.test.ts) "does not carry the identity into the next transaction on the same connection" |
| D4 | Elevation: `app_auth` reaches case data, or `app_api` reads `auth` | Privileges per schema; the access matrix | [access.test.ts](../../tooling/scripts/test/postgres/access.test.ts) "lets app_auth read and write its tables, and nothing more" and "gives %s no access to the auth schema" |
| D5 | Broken access control on any table | Forced row-level security on every table (guard 1); one access matrix per schema, each with its exact table list | [access.test.ts](../../tooling/scripts/test/postgres/access.test.ts) "has exactly the tables the matrix lists"; [vault-access.test.ts](../../tooling/scripts/test/postgres/vault-access.test.ts) "forces row-level security on every vault table"; [notification-access.test.ts](../../tooling/scripts/test/postgres/notification-access.test.ts) "forces row-level security on exactly the three tables"; [document-access.test.ts](../../tooling/scripts/test/postgres/document-access.test.ts) "the documents and account links access matrix (spec 0005, R4)" |
| D6 | Information disclosure: production data in a preview | A preview build never bootstraps or migrates production (the database mark); previews fork from `development` | [db-deployment-target.test.ts](../../tooling/scripts/test/db-deployment-target.test.ts) "refuses %s"; [bootstrap.test.ts](../../tooling/scripts/test/postgres/bootstrap.test.ts) "marks the database on the first production build and refuses a preview there"; [runner.test.ts](../../tooling/scripts/test/postgres/runner.test.ts) "is written by production, idempotently, on the schema app_migrator owns" and "refuses a preview on a fork that carries it, before any migration" (the lineage mark) |
| D7 | Information disclosure: real data in tests or seeds | Synthetic data only; a synthetic seed for previews and CI | Review rule (CLAUDE.md). The seed accepts only `example.com` addresses ([db-seed.test.ts](../../tooling/scripts/test/db-seed.test.ts) "refuses %s") and runs only outside production ([seed.test.ts](../../tooling/scripts/test/postgres/seed.test.ts) "refuses a production run and writes nothing"; [#65](https://github.com/fernandolisboa/arca/issues/65)) |
| D8 | Loss of data | Neon point-in-time restore inside the history window; an optional manual snapshot | Recorded proof: the [restore steps](../runbooks/incident-response.md#restore-the-database). Residual R-3 |

### Web and API (specs 0001 and 0004)

| ID | Threat | Control | Evidence |
| --- | --- | --- | --- |
| W1 | Cross-site scripting reads decrypted documents or the unlocked identity | Strict CSP with Trusted Types; no inline or third-party scripts | [policy.test.ts](../../tooling/security-policy/test/policy.test.ts) "matches spec 0001, R4, reporting violations as spec 0004, R5 asks"; [home.spec.ts](../../apps/web/e2e/home.spec.ts) "renders the home page in pt-BR with the API status" and "activates the service worker without any violation" (any CSP or Trusted Types violation fails an e2e test) |
| W2 | Denial of wallet: public routes start work | No public route starts workflows; cron needs a `CRON_SECRET` of 32 characters or more; the runner is private to the queue; no workflow creates hooks, so the public webhook route has nothing to resume; the health check is cached | [config.test.ts](../../apps/api/test/config.test.ts) "fails closed on %j"; [app.test.ts](../../apps/api/test/app.test.ts) "fails closed when the secret is not configured" and "caches the database result for 10 seconds per instance"; [smoke.test.ts](../../tooling/scripts/test/smoke.test.ts) "fails when an unsigned request reaches the runner and gets %i" and "fails when the workflow webhook answers %i to an unknown token", run against production by [smoke.yml](../../.github/workflows/smoke.yml); [untracked-surfaces.test.ts](../../tooling/scripts/test/untracked-surfaces.test.ts) "creates no workflow hook, so the public webhook route has nothing to resume" |
| W3 | Information disclosure: personal data in workflow metadata | Identifier-only arguments, by type and at runtime; zero retention | [start-workflow.test.ts](../../apps/api/test/start-workflow.test.ts) "accepts identifiers and dates only" and "refuses %j as an identifier" |
| W4 | Information disclosure: personal data in telemetry | One allow-list scrubber; browser events scrubbed in the browser and again in our tunnel; no replay, console or DOM breadcrumbs | [scrub.test.ts](../../packages/telemetry/test/scrub.test.ts) "lets no personal data through %s", "drops a field it does not know, at every level" and "forwards an envelope only for our DSN, with only its event, scrubbed again" (replay items are dropped); [monitoring.spec.ts](../../apps/web/e2e/monitoring.spec.ts) "sends an error in the web app to our tunnel, scrubbed, and nothing leaves the origin" |
| W5 | Tampering: the tunnel used as an open relay | Our DSN only; a size cap; a per-IP rate limit; scrubbing | [monitoring-tunnel.test.ts](../../apps/api/test/monitoring-tunnel.test.ts) "refuses a foreign DSN and sends nothing", "refuses an envelope over 200 KB before reading it" and "refuses a burst over the per-IP limit". Residual R-4 |

### Identity and access (spec 0003)

| ID | Threat | Control | Evidence |
| --- | --- | --- | --- |
| I1 | Spoofing: phishing, or a preview passkey used in production | Passkeys only, with user verification, bound to each environment's relying-party ID | [auth-options.test.ts](../../apps/api/test/auth-options.test.ts) "trusts only the environment origin and binds passkeys to its host" and "asks for a discoverable credential, user verification and PRF support"; [auth.test.ts](../../apps/api/test/postgres/auth.test.ts) "refuses an assertion made without user verification, and opens no session"; [preview-origin.test.ts](../../apps/api/test/preview-origin.test.ts) "rejects a passkey ceremony run on the deployment URL" |
| I2 | Spoofing: takeover through the inbox | Recovery needs the email link and the code, each once; a 24-hour wait; sessions restricted meanwhile; cancelling revokes the pending passkey, which takes a step-up from an active one | [recovery.test.ts](../../apps/api/test/postgres/recovery.test.ts) "needs the link and the code together, each once", "restricts every session and refuses a new recovery meanwhile" and "cancelling it deletes the recovery code, which closes recovery"; [devices.test.ts](../../apps/api/test/postgres/devices.test.ts) "stores it pending for 24 hours, with an event and a notice, and opens no session" and "refuses a step-up from a pending passkey, and accepts it once the wait is over"; [recover.spec.ts](../../apps/web/e2e/recover.spec.ts) "recovers from the link and the code, restricting the old session until it cancels" |
| I3 | Spoofing: strangers create accounts | Invite-only; invitees restricted until confirmed, erased if declined or unconfirmed after 30 days; the enrollment code works once, on an empty database only | [enrollment.test.ts](../../apps/api/test/postgres/enrollment.test.ts) "registers the invitee with no code, unconfirmed, and tells the inviter", "erases a declined account and frees its address", "answers 404 once an account exists, whatever the code" and "keeps the spent code closed"; [retention.test.ts](../../apps/api/test/postgres/retention.test.ts) "marks each one 30 days old for erasure now, ending its sessions, and records it first" |
| I4 | Tampering or elevation: a step-up replayed or spent on another action | A single-use challenge bound to purpose, subject and session; 2-minute expiry; the counter checked; the subject is the hash of the canonical action; consumed atomically | [step-up.test.ts](../../apps/api/test/postgres/step-up.test.ts) "lets two concurrent actions spend one step-up only once", "refuses a step-up for one action presented to another of the same purpose", "refuses an expired challenge", "refuses a challenge verified from another session" and "records the signature counter, and refuses one that did not move forward"; [step-up-encoding.test.ts](../../apps/api/test/step-up-encoding.test.ts) "binds the challenge to the purpose, the subject and the nonce" |
| I5 | Spoofing: a lost device keeps its session | Revoking a passkey ends its sessions; completing recovery restricts every session | [devices.test.ts](../../apps/api/test/postgres/devices.test.ts) "ends the sessions it signed in and keeps those of another passkey"; [auth.test.ts](../../apps/api/test/postgres/auth.test.ts) "ends the sessions of a passkey when the passkey is deleted" |
| I6 | Information disclosure: link tokens in logs or history | Tokens only in the URL fragment, sent in POST bodies, the fragment cleared | [link-tokens.test.ts](../../packages/api-contract/test/link-tokens.test.ts) "%s takes no token in its path or query" and "carries the registration and invite tokens in a POST body"; [enrollment.test.ts](../../apps/web/test/enrollment.test.ts) "clears the fragment from the address bar and keeps the history state" |
| I7 | Information disclosure: account enumeration, brute force on codes | Identical answers; 128-bit codes; per-IP and per-account limits | [recovery.test.ts](../../apps/api/test/postgres/recovery.test.ts) "emails a link to an account and answers the same for an unknown address"; [auth-gate.test.ts](../../apps/api/test/auth-gate.test.ts) "answers the same 401 to %s, never Better Auth's message"; [auth.test.ts](../../apps/api/test/postgres/auth.test.ts) "answers 429 past the per-IP sign-in limit, with Retry-After" and "stores only the limit name and an HMAC, never the address" |
| I8 | Information disclosure: device fingerprints at rest | Browser and system family only; no IP or raw user agent stored | [auth-options.test.ts](../../apps/api/test/auth-options.test.ts) "stores no network details and derives the device from the user agent"; [auth.test.ts](../../apps/api/test/postgres/auth.test.ts) "returns the session and stores no network details" |
| I9 | Spoofing: a synced passkey used elsewhere unnoticed | A notice for each new browser or system family per passkey | [auth.test.ts](../../apps/api/test/postgres/auth.test.ts) "sends one notice for a family not seen before for that passkey, and none for a repeat". Residual R-6 |
| I10 | Repudiation: "I never approved that" | Stored assertions re-verifiable; an append-only audit log | [access.test.ts](../../tooling/scripts/test/postgres/access.test.ts) "lets app_audit insert every column but the ID and the time, and nothing else" and "lets app_api only read"; [step-up-encoding.test.ts](../../apps/api/test/step-up-encoding.test.ts) "matches the committed test vector" |

### Data lifecycle (spec 0004)

| ID | Threat | Control | Evidence |
| --- | --- | --- | --- |
| L1 | Elevation: deletion or export by someone holding a session | A purpose-bound step-up; a 7-day window with cancel; notices | [data-export-routes.test.ts](../../apps/api/test/data-export-routes.test.ts) "answers the export as a download that is never cached, after a data_export step-up" and "needs a second step-up for a second export"; [deletion-routes.test.ts](../../apps/api/test/deletion-routes.test.ts) "requests the deletion after an account_deletion step-up and answers the due time"; [erasure.test.ts](../../apps/api/test/postgres/erasure.test.ts) "ends every session, marks the account due in 7 days, records it and sends the notice" and "cancels inside the window and keeps everything" |
| L2 | Repudiation and incomplete deletion | The registry guard fails on an unregistered table; erasure sweeps every registered table; audit events carry identifiers only | [registry.test.ts](../../packages/db/test/postgres/registry.test.ts) "fails on a new table with no decision" and "has a decision for every table the migrations create, and each holds"; [erasure.test.ts](../../apps/api/test/postgres/erasure.test.ts) "erases two linked accounts that share documents both ways, %s" |
| L3 | Data kept longer than its purpose | A daily retention workflow; RETENTION.md and the rules kept equal by a test | [retention.test.ts](../../apps/api/test/postgres/retention.test.ts) "deletes the rows expired at its time and keeps the rest, in every auth rule"; [retention-docs.test.ts](../../apps/api/test/retention-docs.test.ts) (RETENTION.md matches the rules); [app.test.ts](../../apps/api/test/app.test.ts) "starts the retention rules for the UTC date daily, behind the same token (spec 0004, R10)" |
| L4 | Slow response to an incident | A runbook with exact steps, the ANPD deadline and templates; no drills, by the owner's decision of 2026-11-05 | Recorded proof: [incident-response.md](../runbooks/incident-response.md) |

### Vault, documents and notifications (spec 0005)

| ID | Threat | Control | Evidence |
| --- | --- | --- | --- |
| V1 | Information disclosure: a server or storage breach reads documents | Client-side age encryption; the server holds ciphertext, recipients and envelopes only | [cctv.test.ts](../../packages/vault/test/cctv.test.ts) (the CCTV vectors); [vault.spec.ts](../../apps/web/e2e/vault.spec.ts) "keeps documents encrypted on the server, and changes one only after a vault_write step-up" |
| V2 | Information disclosure: a future quantum attack on stored ciphertext | Hybrid ML-KEM-768 + X25519 recipients only | [cctv.test.ts](../../packages/vault/test/cctv.test.ts) "include the hybrid post-quantum stanza"; [documents.test.ts](../../packages/vault/test/documents.test.ts) "generates hybrid post-quantum identities"; [vault-access.test.ts](../../tooling/scripts/test/postgres/vault-access.test.ts) "refuses a non-hybrid recipient and a passkey envelope without its credential". Residual R-7 |
| V3 | Tampering: the server adds a recipient or replays an older sharing list | Recipients come from the owner-tagged sharing state, never from server rows; a lower version asks the owner | [sharing-state.test.ts](../../packages/vault/test/sharing-state.test.ts) "%s is %s"; [share-recipients.test.ts](../../apps/web/test/share-recipients.test.ts) "uses the pin for a changed key until the owner accepts the new one"; [vault.spec.ts](../../apps/web/e2e/vault.spec.ts) "never encrypts to a recipient the server added, and asks before using a restored older list". Residual R-8 |
| V4 | Elevation: a case member reads or changes another's document | Per-document recipient rows; row-level security; only the owner writes shares; links needed to share | [document-access.test.ts](../../tooling/scripts/test/postgres/document-access.test.ts) "shows the owner its documents and a recipient only what is shared with it", "refuses a share with an account the owner has no link to" and "lets a recipient neither add, remove nor change shares, nor the document" |
| V5 | Elevation: a stolen session downloads, replaces or deletes documents | Downloads only inside a `vault_unlock` window, never cached; replace and delete need a `vault_write` step-up bound to the batch; upload grants only for the account's own pending pathname and declared size | [document-routes.test.ts](../../apps/api/test/document-routes.test.ts) "gives a download URL inside a vault_unlock window only, never cached" and "spends a vault_write step-up for exactly this batch, then approves it"; [documents.test.ts](../../apps/api/test/postgres/documents.test.ts) "presigns only a pending pathname of the account, for the document's declared size" |
| V6 | Tampering: XSS steals the unlocked identity | W1, and the identity is kept in memory only and dropped on idle | [vault-session.test.ts](../../apps/web/test/vault-session.test.ts) "closes after 15 minutes without activity"; [vault.spec.ts](../../apps/web/e2e/vault.spec.ts) "closes after 15 minutes without activity, and activity keeps it open". Residual R-9 |
| V7 | Loss of keys | A recovery envelope from the printed kit; per-passkey envelopes; rotation keeps old identities until documents move | [vault.spec.ts](../../apps/web/e2e/vault.spec.ts) "without PRF, the recovery secret opens the vault and the device keeps it wrapped", "a new recovery kit gives the vault a new secret at its next opening, and the old one stops" and "rotates the vault key: a new kit, the old key still opens shared documents, and each owner moves to the new one" |
| V8 | Spoofing: a lost device keeps the vault open | Revoking its passkey or completing recovery offers the vault rotation | [vault.spec.ts](../../apps/web/e2e/vault.spec.ts) "offers a rotation once a passkey that could open the vault is removed" and "after an account recovery, offers a rotation in place of a new secret alone". Residual R-10 |
| V9 | Information disclosure: personal data in pathnames or push payloads | Random UUID pathnames; pushes carry a code and an ID only | [documents.test.ts](../../apps/api/test/postgres/documents.test.ts) "adds a pending document under a fresh pathname with a direct upload grant"; [push.test.ts](../../apps/api/test/push.test.ts) "sends only the code and the message ID, encrypted to the subscription, signed with the key" |
| V10 | Spoofing: notification phishing | Generic text from our own catalog, with no link | [push-notice.test.ts](../../apps/web/test/push-notice.test.ts) "shows the generic notice for %s" and "carries no link in any notice the catalog words" |
| V11 | Server-side request forgery through push endpoints | Endpoints only on the browsers' push services, HTTPS on the default port, re-checked before posting, no redirects | [notification-routes.test.ts](../../apps/api/test/notification-routes.test.ts) "refuses a subscription with %s"; [push.test.ts](../../apps/api/test/push.test.ts) "never reaches a host that is no push service, and drops its channel" |
| V12 | Information disclosure: a shared browser shows another account's notices | Sign-out ends the subscription and removes its channel with the subscription's secret | [notification.test.ts](../../apps/api/test/postgres/notification.test.ts) "forgets a channel only for the browser that holds its subscription"; [enrollment.test.ts](../../apps/web/test/enrollment.test.ts) "removes the ended subscription's channel while the session still holds". Residual R-11 |
| V13 | Elevation: a preview reaches production storage | One Blob store per environment | [object-storage.test.ts](../../apps/api/test/object-storage.test.ts) "reads each environment's own store" and "connects production and previews only to a configured Vercel Blob store" |

## LLM and agentic risks

No model call is reachable in production yet: the intake extractor ([spec 0008](../specs/0008-free-text-intake.md)) runs on previews and stays off in production until its evaluation suite passes. The [rules engine](../specs/0002-rules-engine-and-knowledge-base.md) is deterministic, and the knowledge-base agents have their own threat model there. Before an adapter is reachable in production, the real-data gate's item 10 requires the evaluation suite and the data-flow rows. Until then, the agentic surface is development: coding agents and their reviewer subagents, which hold the owner's tokens.

Risks from the OWASP Top 10 for LLM Applications (2025):

| Risk | In the foundations | Control and evidence |
| --- | --- | --- |
| LLM01 Prompt injection | Text in a diff, an issue, a fetched page or a CI log steers an agent | Agents treat repository and web content as data (CLAUDE.md, [REVIEW.md](../REVIEW.md)); deterministic checks in CI. Residual R-1 |
| LLM02 Sensitive information disclosure | An agent copies personal data into a commit, an issue or a model call | Synthetic data only; gitleaks and push protection (S3); the scrubber (W4) |
| LLM03 Supply chain | A malicious package or model tooling | S1 and S3; no model SDK in the runtime yet |
| LLM04 Data and model poisoning | A poisoned rule in the knowledge base | Human approval with a passkey ([ADR-0014](../adr/0014-knowledge-base-as-reviewed-data.md)); out of this model's scope |
| LLM05 Improper output handling | Model output rendered as HTML or followed as a link | Not reachable yet; SECURITY.md requires sanitized rendering, stripped images and marked links, and W1 holds meanwhile |
| LLM06 Excessive agency | An agent pushes, merges or changes vendor settings unasked | Agents work on one branch; vendor settings need the owner's explicit OK; never force-push. Residual R-12 |
| LLM07 System prompt leakage | Reviewer prompts reveal secrets | Prompts are public files in `.claude/agents/` and hold no secrets |
| LLM08 Vector and embedding weaknesses | Cross-case leakage through retrieval | No embeddings yet; the shared base holds public rules only |
| LLM09 Misinformation | A wrong rule shown as fact | Every requirement shown needs a source and a verification date ([ADR-0002](../adr/0002-rules-as-versioned-data.md)) |
| LLM10 Unbounded consumption | Cost runaway | Model SDKs only in apps/api, off in production ([untracked-surfaces.test.ts](../../tooling/scripts/test/untracked-surfaces.test.ts) "keeps model SDKs to apps/api, whose extractor is off in production, so gate item 10 holds"); intake limits per account, a token cap and a Console spend limit (spec 0008); W2 for workflows |

Risks from the OWASP Top 10 for Agentic Applications (2026):

| Risk | In the foundations | Control and evidence |
| --- | --- | --- |
| ASI01 Agent goal hijack | A comment or file redirects the coding agent | Instructions come only from the owner; content is data, including issues and comments by anyone else on the public repo ([docs/agents/issue-tracker.md](../agents/issue-tracker.md)). Residual R-1 |
| ASI02 Tool misuse | An agent runs a destructive command or a vendor write | No Neon API key for production; Vercel writes need the owner's OK; R-12 |
| ASI03 Identity and privilege abuse | An agent uses the owner's tokens beyond its task | A fine-grained, expiring GitHub token limited to this repository ([ADR-0012](../adr/0012-automation-first-setup.md)). Residual R-12 |
| ASI04 Agentic supply chain | A compromised reviewer definition or tool | S4; reviewer definitions and the flow change only with a PASS and a change-log entry; skills set process, never permissions |
| ASI05 Unexpected code execution | The authoring session runs code that someone else wrote to subvert it | All code comes from the owner's own sessions, with no outside contributors; CI runs only deterministic checks, with no secrets (S5). Residual R-1 |
| ASI06 Memory and context poisoning | A false fact in shared memory steers later threads | Convention, not enforced: memory holds no secrets and is advisory, and the repository's docs and tests win over it |
| ASI07 Insecure inter-agent communication | A subagent's report is taken as the owner's approval | Agent reports are never approval; only the owner's own messages are |
| ASI08 Cascading failures | One agent's wrong change merges unreviewed | `code-review`, the security reviewer on sensitive changes, and green deterministic CI before every merge |
| ASI09 Human–agent trust exploitation | An agent persuades the owner to approve a risky step | Convention, not enforced: owner asks are rare, one decision at a time, each with its consequence; production changes need the owner's own words |
| ASI10 Rogue agents | An agent acts outside its brief | Branch-only pushes, no force-push, auditable PRs. Residual R-12 |

## Accepted residuals

| ID | Residual | Accepted in |
| --- | --- | --- |
| R-1 | Nothing in CI proves the reviewers ran, a branch that weakens the agent definitions is judged by the weakened reviewers, and a steered reviewer is not caught | [ADR-0019](../adr/0019-reviewers-in-the-authoring-session.md) |
| R-2 | Builds and running functions can read their environment's owner connection string in Vercel, and Preview's app-role passwords (`ARCA_DB_*`) are production's too; someone holding them can write `auth` rows the guards trust | [ADR-0012](../adr/0012-automation-first-setup.md); [spec 0004 R1](../specs/0004-real-data-readiness.md#r1-previews-fork-from-development-and-the-build-proves-it) |
| R-3 | Losing the Neon or Vercel account loses the data; damage older than the history window cannot be undone without a manual snapshot | [ADR-0021](../adr/0021-stay-on-vercel-and-neon.md) |
| R-4 | The tunnel and the public DSN are unauthenticated ways to put events into Sentry; the DSN path skips the tunnel's limits | [ADR-0016](../adr/0016-observability-and-scrubbing.md) |
| R-5 | One active passkey controls the account: a thief with an unlocked device can revoke the others | [ADR-0015](../adr/0015-identity-enrollment-step-up-and-recovery.md) |
| R-6 | The new-family notice can be avoided by copying the victim's browser and system families | [spec 0003](../specs/0003-identity-and-access.md#threat-model-for-this-slice), under ADR-0015 |
| R-7 | The ML-KEM half comes from an implementation without an independent audit; X25519 still holds | [ADR-0018](../adr/0018-vault-encryption.md) |
| R-8 | The first share trusts the server's recipient unless the owner compares fingerprints; a device that never saw a newer state can be shown an older one; age has no sender authentication, so a label is never proof of who wrote a document | [ADR-0018](../adr/0018-vault-encryption.md); the last clause in [spec 0005 R4](../specs/0005-vault-devices-and-notifications.md#r4-documents) |
| R-9 | On a device without PRF, script on our origin can unwrap the stored identity | [ADR-0018](../adr/0018-vault-encryption.md) |
| R-10 | Revoking only a session offers no rotation; a device offline past the checks loses a stored rotation's new secret; a later cancelled recovery hides an earlier one from the offer | [spec 0005 R4](../specs/0005-vault-devices-and-notifications.md#r4-documents) |
| R-11 | After an account change or a 401, the old account's push channel stays until the push service answers gone | [spec 0005 R7](../specs/0005-vault-devices-and-notifications.md#r7-notifications) |
| R-12 | Agents hold the owner's GitHub token and could change the ruleset or settings | [ADR-0012](../adr/0012-automation-first-setup.md) |
| R-13 | The owner's other apps share the `filx.app` sending domain, so one of them, or its leaked Resend key, can send mail that passes DMARC as Arca's and asks for a recovery link and code, and with `p=quarantine` an outsider's forgery still lands in spam; recovery's wait and cancel (I2) limit it | [ADR-0015](../adr/0015-identity-enrollment-step-up-and-recovery.md#email) |
| R-14 | The seed's passkey key is public by design, so anyone past Vercel Deployment Protection can sign in to a preview as the seed's synthetic owner, on the `development` branch every preview shares; Deployment Protection is the only control there | [spec 0004 R2](../specs/0004-real-data-readiness.md#r2-synthetic-seed) |

## Open gaps

| Gap | Ticket | Blocks the gate |
| --- | --- | --- |
| No check that every action is pinned by SHA (S2) | [#6](https://github.com/fernandolisboa/arca/issues/6) | No: pins are reviewed by hand |

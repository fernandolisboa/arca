# Spec 0003: Identity and access

- Status: Ready for tickets
- Date: 2026-11-02
- Epic: cross-platform foundations ([ROADMAP.md](../ROADMAP.md#phase-1--family-mvp-web)), after [spec 0001](0001-foundations-scaffold.md)
- Decisions: [ADR-0015](../adr/0015-identity-enrollment-step-up-and-recovery.md), [ADR-0006](../adr/0006-auth.md), [ADR-0008](../adr/0008-database-security-and-environments.md), [ADR-0012](../adr/0012-automation-first-setup.md); consumers: [ADR-0014](../adr/0014-knowledge-base-as-reviewed-data.md) (knowledge-base activation), [ADR-0017](../adr/0017-data-lifecycle-and-backups.md) (deletion and export), [ADR-0018](../adr/0018-vault-encryption.md) (vault unlock)

## Goal

Members of the family sign in with passkeys, invited by someone already in, on every environment; sensitive actions ask for a fresh passkey verification bound to what is being done; a lost device is recoverable without making the inbox the master key; every security event is recorded and visible to the person it concerns.

## Scope

**In:** Better Auth with the passkey plugin behind an endpoint allow-list; the `auth` schema and the `app_auth` pool; owner enrollment and invites; passkey sign-in and registration in the web client through the `platform` passkey port; sessions, device list and revocation; purpose-bound step-up; recovery with the email link and the recovery code; the audit log and security notices by email; email through Resend with a non-production outbox; rate limits; the relying party per environment; the `app.account_id` rename.

**Out:** bearer tokens for native apps (Phase 4); the designated-adult recovery factor (with the case model); push notices (spec 0005); account deletion and export (spec 0004, which uses this spec's step-up); the vault (spec 0005).

**No case data.** Accounts hold an email address, passkeys and sessions; the seed and tests use synthetic addresses on reserved domains (`example.com`, `example.org`).

## Requirements

### R1. Auth module, schema and pool

- `better-auth` and `@better-auth/passkey` at the newest release at least 7 days old (1.7.x as of 2026-11-02), and `@simplewebauthn/server` and `@simplewebauthn/browser` as direct dependencies at the 13.x the plugin resolves (one copy of the verifier; move to 14 when the plugin does), added to the Versions table of spec 0001 with a supply-chain PASS.
- Better Auth runs inside `apps/api` under `/v1/auth`, with the Drizzle adapter on its own pool connected as `app_auth` (pooled host, explicit user and password, `current_user` checked per connection, as spec 0001 R7 does for `app_api`). `bootstrap.sql` sets the `app_auth` password from a new Sensitive variable, `ARCA_DB_AUTH_PASSWORD` (Production and Preview), which an agent generates as it did the others. `BETTER_AUTH_SECRET` (Production and Preview, distinct values) is agent-generated the same way.
- Tables in schema `auth`, created by migrations owned by `app_migrator`, with DML for `app_auth`; `app_backup` gets `SELECT` on the tables spec 0004 R12 lists and nothing else; no other role has privileges. Workflow steps that touch `auth` use the `app_auth` pool. The schema and its tables join the guard allow-list for tables without row-level security, each with the reason. IDs are UUIDs. `auth.user` records the last sign-in time (for the inactivity rule in RETENTION.md). No foreign key from another schema cascades into `auth`.
- Exactly one module in `apps/api` reads the passkey plugin's credential rows; step-up and the device list go through it.
- Better Auth telemetry is disabled in configuration, asserted by a unit test.
- Packages beyond Better Auth and SimpleWebAuthn: none; Resend is called with `fetch` against its REST API.
- Only allow-listed Better Auth endpoints are reachable; every other path under `/v1/auth` answers 404 before Better Auth sees it. The allow-listed endpoints, and the routes of R2 to R7, are declared in `packages/api-contract` with Zod schemas, so they appear in the OpenAPI document and the typed client. The web client never imports a Better Auth client.
- Email and password, magic link, social and anonymous sign-in are not configured. Changing the email address is not offered in this slice and its endpoint is not allow-listed; when it is added, it needs a `sensitive_settings` step-up, confirmation at both addresses and a notice to the old one.
- The request identity helper and the pool's connection check use `app.account_id` instead of `app.person_id`; tests, guards and spec 0001's wording follow.
- `GET /v1/session` returns the signed-in account's ID, email and device label, or 401.

### R2. Enrollment

- **Owner enrollment.** `POST /v1/auth/enroll-owner {code, email}` works only while the `auth` user table is empty; otherwise 404. The code's SHA-256 hash is in a repository configuration file; comparison is over hashes in constant time. On success it sends a verification email; the link opens passkey-first registration (R3) with a registration context built like an invite token (256 random bits, stored hashed, single use) that expires after 30 minutes. An agent generates the code (128 bits, base64url), commits the hash and gives the code to the owner in the project thread.
- **Invites.** A signed-in account (every account is an adult by construction; children are case persons without accounts) creates an invite for an email address (`POST /v1/invites`); the token is 256 random bits, stored as a SHA-256 hash, single use, expiring after 7 days; at most 10 open invites per account. The invite email carries the link. Opening it shows who invited the person (the inviter's email) and starts passkey-first registration with the token as the passkey plugin's registration context; `resolveUser` creates the account only when the token is valid, unexpired and unused, and marks it used in the same transaction.
- Enrollment ends by showing the recovery kit (R6) once; the person confirms they saved it before continuing.
- Sign-up by any other path is impossible: the passkey plugin's `resolveUser` rejects a missing or invalid context.

### R3. Passkeys in the client

- `packages/platform` gains a `Passkeys` port: `create(optionsJSON)` and `get(optionsJSON)`, with WebAuthn JSON in and out, plus `isAvailable()`. The web adapter uses `@simplewebauthn/browser`. UI code calls only the port.
- Registration asks for a resident key, user verification required, and the PRF extension enabled; the server records whether the authenticator reported PRF support.
- Sign-in uses discoverable credentials (no email typed) and conditional UI where the browser supports it. Authentication options require user verification, and the server rejects any assertion without the UV flag, with a test.
- Screens, all through i18n in pt-BR: sign in, accept invite, owner enrollment, recovery kit, device list, add a passkey, recovery. Touch targets and layouts follow spec 0001 R5.

### R4. Sessions and devices

- Cookie `__Host-` prefixed, `Secure`, `HttpOnly`, `SameSite=Lax`; idle timeout 3 days; absolute lifetime 30 days, enforced by a check on the session's creation time.
- Better Auth's origin check on, trusted origins limited to the environment's own origin.
- The session stores a device label derived on the server from the user agent ("Chrome on Android"), never the raw user agent or the IP address.
- Adding a passkey to an account that already has one needs a `sensitive_settings` step-up. The new passkey cannot sign in or satisfy a step-up for 24 hours; during that window any older active passkey or session can cancel it from the device list, and the account gets notices (R7). This is the same rule as a recovery passkey (R6).
- `GET /v1/devices` lists the account's sessions and passkeys (label, created, last used); `DELETE /v1/devices/sessions/:id` and `DELETE /v1/devices/passkeys/:id` revoke one, after a `sensitive_settings` step-up. The last passkey cannot be removed.
- `POST /v1/devices/sessions/revoke-others` signs out every other session, after a `sensitive_settings` step-up.

### R5. Step-up

- `POST /v1/auth/step-up/options {purpose, subjectHash?}` and `POST /v1/auth/step-up/verify {challengeId, response}`, exactly as ADR-0015 describes. The challenge row stores the session ID and the account ID; verify rejects a `challengeId` from another session and any credential that is not an active credential of that account. Closed purpose enum (`sensitive_settings`, `account_deletion`, `data_export`, `financial_action`, `vault_unlock`, `knowledge_activation`); a subject hash required for purposes bound to data (`knowledge_activation`, `financial_action`) and forbidden for the others; challenge `SHA-256("arca-step-up/v1" ‖ purpose ‖ subjectHash ‖ nonce)` with length-prefixed components; single use; 2-minute expiry; RP ID, origin, user presence and user verification checked; revoked credentials rejected; signature counter updated.
- The verified assertion is stored in `auth.step_up` (account, credential ID, purpose, subject hash, nonce, authenticator data, client data JSON, signature, verified time). A pure function in `apps/api` re-verifies a stored assertion: it recomputes the challenge from purpose, subject hash and nonce, compares it with `clientDataJSON.challenge`, checks RP ID hash, origin and flags, and verifies the signature against a public key **the caller supplies**. Consumers that must not trust the database, such as ADR-0014's activation (approver keys pinned in a repository allow-list), pass their pinned key; nothing in the function reads a credential row.
- A server-side guard, `requireStepUp(purpose, subjectHash?)`, used by routes: generic purposes accept a step-up by the same session within 5 minutes (`vault_unlock`: 15 minutes); data-bound purposes consume the matching step-up once.
- Tests: a challenge replayed, expired, for another purpose, for another subject hash, from another session, signed by a credential of another account, signed by a revoked credential, or signed by a passkey still in its 24-hour inactive window is rejected.

### R6. Recovery

- The recovery kit holds two secrets of 128 random bits each, shown once as one printable page and a downloadable text file: the account recovery code, stored as a salted hash, and the vault recovery secret, which the server never stores (ADR-0018). Generating a new kit invalidates the old code and needs a `sensitive_settings` step-up.
- `POST /v1/auth/recovery/start {email}` always answers the same way; if the account exists, it emails a link valid for 30 minutes, built like an invite token (256 random bits, stored hashed, single use). The link page asks for the recovery code; with both, the person registers a new passkey, which stays inactive for 24 hours. During that time any other active passkey or session can cancel it from the device list, and the account gets notices (R7). After 24 hours it becomes active, the old recovery code is invalidated, and a new kit is issued at the next sign-in in this order: if the person has a vault, they open it with the old vault recovery secret, an envelope is sealed for the new passkey, then both secrets are regenerated and the recovery envelope is re-sealed before the kit is shown. A kit is never shown with a vault secret that is not sealed in; if the vault cannot be opened, only the account code is regenerated and the kit says the old vault secret still applies.
- Five wrong recovery codes lock recovery for the account for 24 hours and send a notice.

### R7. Audit log and security notices

- Schema `audit`, table `audit.event` (ID, time, actor account ID, subject account ID, event code, request ID, a JSON `details` limited per event code to identifiers and enum values). Inserted only by `app_audit` through its own pool and password (`ARCA_DB_AUDIT_PASSWORD`, set like the others); no role but `app_migrator` may update or delete; row-level security lets an account read the events whose subject it is. Every event code and its allowed `details` keys are a closed list in code.
- Events: sign-in, sign-in failure (per credential, rate-limited in the log), passkey added, activated, revoked; session revoked; step-up verified (with purpose); invite created, accepted, expired; owner enrolled; recovery started, failed, completed, cancelled; recovery kit regenerated.
- Notices by email for (spec 0005 later routes every notice through the notification service, which then becomes the only producer; this direct path is replaced, not kept beside it): new passkey, recovery started and completed, recovery locked, `knowledge_activation` step-up, every session revoked by "sign out others". The email says what happened and when, with the device label at most. Spec 0005 adds the same notices on every device.
- `GET /v1/audit/events` lists the signed-in account's events, paginated.

### R8. Email

- An `EmailSender` port in `apps/api` with two adapters: Resend (production only) and an outbox writer (every other environment). Messages are built from i18n templates in pt-BR with generic text and one link; no personal data beyond the recipient address.
- Resend: the production domain added with the São Paulo sending region, SPF, DKIM and DMARC set; the API key is a Sensitive Vercel variable (Production only). The ticket records Resend's log retention for the plan in [RETENTION.md](../RETENTION.md).
- Outbox: table `auth.outbox`, present in every environment so schemas never diverge; production refuses to select the outbox adapter; shown at `/internal/outbox` only on preview deployments, behind Vercel Deployment Protection; rows expire after 7 days.

### R9. Relying party and environments

- A repository configuration file names the production relying-party ID and origin. While it is empty, production refuses owner enrollment, invites, registration and recovery with a clear error code, and the web app shows that sign-in is not available yet.
- A preview uses its branch URL host (`VERCEL_BRANCH_URL`) as relying-party ID and origin; ceremonies from any other origin, including the per-deployment URL, are rejected.
- Local development uses `localhost`, which WebAuthn treats as a secure context.

### R10. Rate limits

- Better Auth's rate limiter with database storage, on by default for every auth endpoint.
- Our own limits, stored in `auth.rate_limit` (written by `app_auth`, on the no-row-level-security allow-list, never backed up), keyed by an HMAC of the IP address under a key rotated monthly (never the address itself) or by account: enrollment 5 per hour per IP; recovery start 3 per hour per email hash and 10 per hour per IP; step-up options 20 per hour per session; invites 20 per day per account.
- An edge rule in Vercel Firewall limits `/v1/auth/*` per IP. If the rule cannot be versioned in the repository, an agent applies it through the Vercel API after the owner's OK, and the ticket records it.

## Threat model for this slice

Assets: passkeys, sessions, recovery codes, invites, the enrollment code, stored step-up assertions, the audit log.

| Threat (STRIDE, agentic) | Where | Control |
| --- | --- | --- |
| Spoofing: account takeover by phishing | Sign-in | Passkeys only, bound to the relying-party ID; no passwords or magic links |
| Spoofing: takeover through the inbox | Recovery | Email link and recovery code both required; 24-hour inactive period with cancel; notices to email |
| Spoofing: strangers creating accounts | Enrollment | Invite-only; enrollment code works on an empty database only; `resolveUser` rejects any other context |
| Tampering: replay or reuse of a step-up | Step-up | Single-use challenge bound to purpose, subject and session; 2-minute expiry; UV required; counter checked |
| Repudiation: "I never approved that" | Step-up, audit | Stored assertion re-verifiable against the credential; append-only audit log |
| Information disclosure: account enumeration | Recovery, invites | Identical responses; rate limits |
| Information disclosure: device fingerprinting data at rest | Sessions | Coarse label only; no IP or raw user agent stored |
| Elevation: a preview passkey used in production | Relying party | RP ID per environment; production RP ID fixed in the repository |
| Denial of service: brute force on codes | Enrollment, recovery | 128-bit codes; per-IP and per-account limits; recovery lockout |
| Elevation: `app_auth` reaching case data | Database | `app_auth` has privileges on `auth` only; guards unchanged for every other schema |
| Tampering: a DB-owner attacker inserting a credential | Database | Accepted residual of ADR-0012; every new passkey sends a notice, and `knowledge_activation` step-ups notify the owner (ADR-0014) |

## Definition of done

- Every requirement is covered by a test: unit tests for the step-up challenge and re-verification, database tests for privileges and the audit log's grants, and Playwright with a virtual authenticator (with PRF) for enrollment, invite, sign-in, step-up, recovery and device revocation at phone and desktop sizes.
- The access-matrix suite covers `app_auth` and `app_audit`.
- A preview shows invite, sign-in, step-up, recovery and devices with the outbox; owner enrollment is proven in Playwright against an empty database, since seeded previews already have accounts; production refuses enrollment until the relying-party file names the domain.
- No user-facing string outside i18n; no personal data in fixtures, logs or telemetry.

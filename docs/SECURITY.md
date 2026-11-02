# Security

As of 2026-11-01. Security is a product pillar, not a phase: Arca holds passports, family relationships, assets and bank details, and families trust it with their future. A feature that cannot be built securely is not built.

## Principles

1. **Deny by default.** Every request, query, job and agent action starts with no access and gains only what it needs.
2. **Defense in depth.** Authorization is enforced in the API and again by row-level security in the database; neither alone is trusted.
3. **Each adult owns their data.** Being in the same case does not grant access. Finances, documents and answers are private to their owner until shared explicitly, and an adult can leave a case and take their data.
4. **Least knowledge.** The server stores documents as ciphertext; third parties receive identifiers or the minimum fields a call needs.
5. **Model output is untrusted.** Anything an LLM produces is validated before it is shown, stored or acted on. Agents never act with more permission than the person they serve.
6. **No home-made security.** Standard protocols, reviewed libraries and documented constructions only.
7. **Fail closed.** On error or uncertainty, refuse and log; never fall back to a weaker path.

## Standards we verify against

| Standard | Scope | Target |
| --- | --- | --- |
| [OWASP ASVS 5.0](https://softwaremill.com/whats-new-in-asvs-5-0/) | Web app and API | Level 2 everywhere; Level 3 for authentication, session management, the vault, financial actions and administration |
| [OWASP Top 10:2025](https://owasp.org/Top10/2025/) | Web app and API | Each category mapped to controls and tests below |
| OWASP Top 10 for LLM Applications and [Top 10 for Agentic Applications (2026)](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026) | AI features and agents | Each risk mapped to controls and evaluation cases |
| OWASP MASVS | Android and iOS apps | Verified before each store launch (Phases 4 and 5) |

## Threat model

Revisited at the start of every epic. New features list the assets they touch and the threats below that apply.

**Assets:** identity documents; family relationships and custody; assets, income and bank details; immigration history (including visa refusals); passkeys, sessions and vault keys; the integrity of the knowledge base (a poisoned rule harms every family that relies on it).

| Threat | Example | Main controls |
| --- | --- | --- |
| Account takeover | Phished or stolen session | Passkeys only; step-up for vault and financial actions; session binding and short lifetimes; alerts on new devices |
| Broken access control | User reads another case by changing an ID | API authorization plus row-level security; an access-matrix test suite for every endpoint |
| Intra-family exposure or coercion | A separated spouse sees the other's finances; one relative controls another's application | Per-person ownership and explicit sharing; each adult signs in separately; audit log visible to the data owner |
| Indirect prompt injection | Text in an uploaded PDF or a researched web page tells an agent to reveal data or change a rule | Document and web content treated as data, never instructions; agents have no write tools outside their task; schema-validated outputs; knowledge-base changes need human approval; injection cases in the evaluation suite |
| Excessive agency | An agent submits a form, emails a third party or moves money | Agents cannot act outside Arca; every outbound action is prepared by the agent and confirmed by the person |
| Cross-case data leakage through AI | Retrieval returns another family's facts | Shared knowledge base holds public rules only; case data is retrieved only within the requesting person's scope; no case data in shared embeddings or prompts of other cases |
| Insider or admin abuse | An operator browses family data | No standing access to case data; break-glass access is time-limited, justified and audited, and the owner is notified |
| Vendor compromise | A processor is breached | Ciphertext-only storage; identifiers-only job payloads; data-flow register ([ARCHITECTURE.md](ARCHITECTURE.md#data-flows)); scrubbing before telemetry |
| Supply-chain attack | A malicious dependency version or CI action steals secrets | Lockfile installs; dependency install scripts blocked except an allow-list; minimum release age before adopting new versions; Actions pinned by commit SHA; Dependabot version updates with a cooldown, Dependabot alerts and osv-scanner; SBOM per build; must-pass supply-chain reviewer on every dependency change |
| Cross-site scripting | Injected script reads decrypted documents in the browser | Strict CSP and Trusted Types; no third-party scripts in the app; sanitized rendering of untrusted text, including model output |
| Data exfiltration through model output | Injected instructions make the assistant render an image URL that carries case data | Remote images stripped and links marked in rendered model output |
| Payment-detail fraud | Bank details swapped before a large transfer | Two-person approval and a cooling-off notice for any change to bank or exchange details |
| Lost or stolen device | Phone unlocked by a thief | Vault requires fresh passkey verification; remote sign-out of devices; native keys behind biometrics |
| Impersonation of Arca or partners | Phishing messages "from Arca" asking for payment | Arca never requests payment or documents by message link; partner contacts shown only inside the app; published anti-phishing guidance |
| Denial of wallet | Abuse of AI endpoints runs up costs | Per-user and per-case rate limits and budgets; alerts on spend anomalies |

## Required controls

**Identity and access**
- Better Auth with passkeys only ([ADR-0006](adr/0006-auth.md), [ADR-0015](adr/0015-identity-enrollment-step-up-and-recovery.md)); invite-only enrollment until Phase 3; native passkey APIs on mobile; purpose-bound step-up for sensitive actions, its assertion stored and re-verifiable; device list with remote sign-out; recovery that needs the email link and the recovery code, with a 24-hour inactive period and notices.
- Forced row-level security on every table with case data, identity set per transaction, plus API-level checks; deny-by-default policies ([ADR-0008](adr/0008-database-security-and-environments.md)).
- Separate SQL-created roles for API, jobs, auth, audit and migrations, none able to bypass row-level security.
- Access-matrix tests in CI for every role, person and table.

**Web and API**
- Zod validation at every boundary; parameterized queries only (Drizzle).
- Strict Content Security Policy without inline scripts, Trusted Types, HSTS, secure cookies (HttpOnly, Secure, SameSite) with CSRF protection, CORS allow-list.
- Rate limiting at the edge (Vercel Firewall) and in the API with shared storage in Postgres, never in-memory; per-person AI budgets.
- No third-party scripts in the app. The service worker caches only the static app shell; responses with personal data are `Cache-Control: no-store` and never cached.
- Errors return generic messages; details go to logs with personal data scrubbed.
- Untrusted rich text (including model output) is sanitized before rendering; external links are marked and opened safely.

**Data**
- Vault encryption on the client in the age format with hybrid post-quantum recipients, passkey (PRF) and recovery-kit envelopes, rotation, and plaintext reaching an authorized processing session only in one request's memory ([ADR-0018](adr/0018-vault-encryption.md)).
- Bank account and document numbers encrypted per field with KMS-wrapped keys ([ADR-0008](adr/0008-database-security-and-environments.md)).
- Deleting an account destroys its vault envelopes (crypto-shredding, [ADR-0018](adr/0018-vault-encryption.md)) and its rows, and deletes its stored objects; traces and error reports never carry account identifiers, so they need no deletion ([ADR-0016](adr/0016-observability-and-scrubbing.md), [ADR-0017](adr/0017-data-lifecycle-and-backups.md)); workflow runs hold identifiers only with zero retention and have their payloads purged by Vercel within 36 days, and their metadata (no personal data) within one year ([ADR-0009](adr/0009-background-jobs-guarantees.md)); in-app account deletion and data export from Phase 1.
- Retention periods per data type, each with its enforcement: [RETENTION.md](RETENTION.md). Every table is in the personal-data registry or on its no-personal-data list, enforced by a guard ([ADR-0017](adr/0017-data-lifecycle-and-backups.md)).
- Backups per ADR-0008 and [ADR-0017](adr/0017-data-lifecycle-and-backups.md): RPO 15 minutes, RTO 4 hours, a daily off-vendor copy in a separate AWS account under Object Lock, written by a role that cannot read it back, quarterly restore drills.

**AI**
- Every adapter enforces data minimization ([ADR-0004](adr/0004-ai-providers-behind-ports.md)); prefer vendor settings that disable training on and retention of our data, recorded in the data-flow register.
- No secrets or credentials in prompts. Tools given to agents are allow-listed per task and run with the requesting person's permissions.
- The evaluation suite includes adversarial cases: injected instructions in documents and web pages, attempts to read other cases, attempts to make agents take outbound actions.

**Environments and secrets**
- Development, preview and production are separate: production is its own Neon branch; before the first case-data table, previews are switched to fork from a `development` branch that never held production data ([ADR-0012](adr/0012-automation-first-setup.md)). Developer machines are never connected to the hosted database. Production data never leaves production: preview and CI databases start from a synthetic seed. Previews sit behind deployment protection.
- Secrets live in the platform's environment-variable store, never in the repository; scoped per environment and rotated. Cloud access uses OIDC federation (Vercel and GitHub Actions to AWS), so no long-lived cloud keys exist.
- Every vendor and store account is owned by the organization, uses phishing-resistant MFA (passkeys or security keys), named accounts and least-privilege roles.

**Software delivery**
- Branch protection, required checks and the reviewer gates in [REVIEW.md](REVIEW.md): a must-pass security reviewer on every change, plus must-pass specialists (auth and cryptography, data access, supply chain, AI safety) on changes in their areas, so sensitive changes get at least two independent security reads.
- CodeQL for code scanning; osv-scanner for dependency advisories (on each pull request and each push to `main`; Dependabot alerts cannot read pnpm 12's two-document lockfile), registry licenses checked against an allow-list; secret scanning with push protection; gitleaks; Dependabot version updates ([ADR-0010](adr/0010-stack-revised.md)); Actions pinned by SHA; SBOM per build; the reviewer subagents as a required CI check ([ADR-0011](adr/0011-reviewers-in-ci.md)).
- Dynamic scanning (OWASP ZAP baseline) against preview deployments.
- External penetration test before Phase 3 (other families) and before each store launch; findings tracked to closure.

**Operations**
- Security events (sign-ins, step-ups, vault access, permission and bank-detail changes) go to the audit log and alerting. The audit log is append-only, enforced by database grants.
- Incident response runbook before real data enters (Phase 1, [spec 0004](specs/0004-real-data-readiness.md) R11): severity levels, containment steps, owner contacts, and notification steps. Under Brazil's Resolução CD/ANPD 15/2024, a controller notifies the ANPD and affected data subjects within 3 business days of learning that an incident affected personal data ([Cescon Barrieu](https://cesconbarrieu.com.br/anpd-aprova-o-regulamento-de-comunicacao-de-incidente-de-seguranca/)).
- A component-level threat model (STRIDE plus the LLM and agentic risks above) is written for each epic before its code.
- Responsible disclosure: [SECURITY.md](../SECURITY.md) in the repository and `security.txt` on the production domain.

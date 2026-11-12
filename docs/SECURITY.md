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
| Account takeover | Phished or stolen session | Passkeys only; step-up for vault, financial and account changes and for giving the admin role; sessions bound to their passkey, with a 3-day idle and 30-day absolute lifetime (ADR-0015 records the trade-off); notices on new passkeys and on sign-ins from an unseen browser or system |
| Knowledge-base poisoning | An agent tricked by a researched page (a rule audit's lead, for one), or holding the owner's token, merges a wrong rule, adds an owner-list account, weakens or steers a country guide, or plants text in a version to mislead the check | Merged versions are only proposed; a lead never changes a rule without an official text, and an audit writes guides and official-domain lists only from official texts, in their own pull requests ([rule audit](runbooks/rule-audit.md)); the monthly run of the audit merges on its own only route versions, their cases, country sets, their hashes and route notes, never edits its own instructions, and starts no workflow but the catalog check of its own routes, from a head that passes its path check, merging nothing whose last check left an item differing ([the monthly run](runbooks/rule-audit.md#the-monthly-run), [the check loop](runbooks/rule-audit.md#the-check-loop)); the independent check compares each route version with the official pages it cites, and code checks every quote and value before a version counts as checked; the report sits in its own panel apart from the rule; country guides change only in their own pull request and never outweigh the pages; a signed-in admin (owner list or an in-app grant given with a step-up) activates or rejects each version, checked versions together with one tap, flagged ones one by one, and checking a flagged version again never makes it checked while the flagged report lives (on-demand checks are admin-only and share the daily cap); decisions are insert-only, written only by `app_auth`, and a decision counts only when its author was an admin at the time; required immutability check run from `main`. Accepted residuals: a stolen admin session can decide; a wrong or tampered official page, a model error, a steering guide, or old wording that a long page still carries outside the passages picked for the check can make a bad version checked; writers as `app_auth`, `app_jobs` or the owner role, or a token holder who deploys changed code on the decision or evaluation path, can forge a decision, a grant or a report ([ADR-0022](adr/0022-single-approver-activation.md), [ADR-0027](adr/0027-admins-and-the-checked-batch-activation.md)) |
| Broken access control | User reads another case by changing an ID | API authorization plus row-level security; an access-matrix test suite for every endpoint |
| Intra-family exposure or coercion | A separated spouse sees the other's finances; one relative controls another's application | Per-person ownership and explicit sharing; each adult signs in separately; audit log visible to the data owner |
| Server-side request forgery | A cited URL, a redirect or a DNS answer steers the independent check's fetch to an internal address, a metadata service or a huge page; a forged passkey attestation carries a certificate naming a URL for the WebAuthn verifier to request | Only cited `official` URLs, or the machine-readable address their sources name in a page's place with no fallback to the page, over `https` on a pinned official-domain list, re-checked on every redirect hop (at most three); a JSON or XML answer read as its strings only, with no document type read and no entity expanded; markup read to at most 512 nested elements, 500,000 in all and a budget of work moving content; a lookup that refuses special-purpose addresses and connects to the checked one; explicit certificate verification; no cookies or credentials; limits on bytes, decompressed size, markup, text and time; at most 20 starts in 24 hours per environment, automatic and admin-requested together ([ADR-0027](adr/0027-admins-and-the-checked-batch-activation.md)); passkey registration refuses any attestation that carries certificates before the verifier reads it, so it requests nothing ([spec 0003](specs/0003-identity-and-access.md), R3) |
| Hostile file sent to a parser | An official host, or whoever controls it, serves a crafted PDF to the independent check to run code, fetch an address, stall the instance or exhaust its memory | One maintained parser, pdf.js, given a copy of the bytes after the fetcher's byte caps, with no URL, fonts, maps, forms, scripts or links read and no code compiled from the file, in a thread of its own that is stopped at the fetch's time limit, at a heap limit or when the process's memory grows past a bound; a page cap and a text cap; a file it cannot read fails closed with a fixed reason and the step completes. Text a PDF hides from a reader (invisible, covered, struck) still reaches the model, as text a style sheet hides does ([ADR-0028](adr/0028-pdf-text-in-the-independent-check.md)) |
| Indirect prompt injection | Text in an uploaded PDF or a researched web page tells an agent to reveal data or change a rule | Document and web content treated as data, never instructions; agents have no write tools outside their task; schema-validated outputs; knowledge-base changes need human approval; a rule report's note never reaches an agent; quotes in the independent check's report are verified against the fetched page; injection cases in the evaluation suite |
| Prompt injection into development agents | Text in a diff, doc, commit message or fetched page (including a monthly rule audit's leads) steers the coding agent or its reviewers to a false PASS or to run commands with the owner's tokens | Reviewers read changed content as data; deterministic checks in CI; GitHub access scoped to this repository, with the owner's own GitHub token out of the agent environment for new sessions since 2026-11-11 and revoked the same day, on his word ([ADR-0012](adr/0012-automation-first-setup.md)); the monthly run of the rule audit, which nobody watches, starts from a fresh clone, reads no issue and leaves nothing behind outside its pull requests ([the monthly run](runbooks/rule-audit.md#the-monthly-run)). Residual, accepted in [ADR-0019](adr/0019-reviewers-in-the-authoring-session.md): no CI review or canary catches a steered reviewer. Residual, threat model R-12: a steered session can use the tokens in its environment |
| Excessive agency | An agent submits a form, emails a third party or moves money | Agents cannot act outside Arca; every outbound action is prepared by the agent and confirmed by the person |
| Cross-case data leakage through AI | Retrieval returns another family's facts | Shared knowledge base holds public rules only; case data is retrieved only within the requesting person's scope; no case data in shared embeddings or prompts of other cases |
| Insider or admin abuse | An operator browses family data | No standing access to case data; break-glass access is time-limited, justified and audited, and the owner is notified |
| Vendor compromise | A processor is breached | Ciphertext-only storage; identifiers-only job payloads; data-flow register ([ARCHITECTURE.md](ARCHITECTURE.md#data-flows)); scrubbing before telemetry |
| Supply-chain attack | A malicious dependency version or CI action steals secrets | Lockfile installs; dependency install scripts blocked except an allow-list; minimum release age before adopting new versions; Actions pinned by commit SHA; Dependabot version updates with a cooldown, Dependabot alerts and osv-scanner; SBOM per build; must-pass supply-chain reviewer on every dependency change |
| Cross-site scripting | Injected script reads decrypted documents in the browser | Strict CSP and Trusted Types; no third-party scripts in the app; sanitized rendering of untrusted text, including model output |
| Data exfiltration through model output | Injected instructions make the assistant render an image URL that carries case data | Remote images stripped and links marked in rendered model output |
| Payment-detail fraud | Bank details swapped before a large transfer | Two-person approval and a cooling-off notice for any change to bank or exchange details |
| Lost or stolen device | Phone unlocked by a thief | Vault requires fresh passkey verification; revoking the device's passkey signs out its sessions and offers vault identity rotation; native keys behind biometrics |
| Impersonation of Arca or partners | Phishing messages "from Arca" asking for payment | Arca never requests payment or documents by message link; partner contacts shown only inside the app; published anti-phishing guidance |
| Denial of wallet | Abuse of AI endpoints runs up costs | Per-user and per-case rate limits and budgets; alerts on spend anomalies |

## Required controls

**Identity and access**
- Better Auth with passkeys only ([ADR-0006](adr/0006-auth.md), [ADR-0015](adr/0015-identity-enrollment-step-up-and-recovery.md)); invite-only enrollment until Phase 3; native passkey APIs on mobile; purpose-bound step-up for sensitive actions, its assertion stored and re-verifiable, including giving the admin role; knowledge-base decisions stored under [ADR-0022](adr/0022-single-approver-activation.md) keep their step-up, and new ones need a signed-in admin ([ADR-0027](adr/0027-admins-and-the-checked-batch-activation.md)); device list with remote sign-out; recovery that needs the email link and the recovery code, with a 24-hour inactive period and notices.
- Forced row-level security on every table with case data, identity set per transaction, plus API-level checks; deny-by-default policies ([ADR-0008](adr/0008-database-security-and-environments.md)).
- Separate SQL-created roles for API, jobs, auth, audit and migrations, none able to bypass row-level security, plus `cases_definer`, which cannot log in and owns the few reviewed `SECURITY DEFINER` functions of the case schema.
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
- Bank account and document numbers kept as encrypted items in the person's vault, sealed on the device; the server never holds them in clear ([ADR-0021](adr/0021-stay-on-vercel-and-neon.md)).
- Deleting an account destroys its vault envelopes (crypto-shredding, [ADR-0018](adr/0018-vault-encryption.md)) and its rows, and deletes its stored objects; traces and error reports never carry account identifiers, so they need no deletion ([ADR-0016](adr/0016-observability-and-scrubbing.md), [ADR-0017](adr/0017-data-lifecycle-and-backups.md)); workflow runs hold identifiers only with zero retention and have their payloads purged by Vercel within 36 days, and their metadata (no personal data) within one year ([ADR-0009](adr/0009-background-jobs-guarantees.md)); in-app account deletion and data export from Phase 1.
- Retention periods per data type, each with its enforcement: [RETENTION.md](RETENTION.md). Every table is in the personal-data registry or on its list of unowned tables, enforced by a guard ([ADR-0017](adr/0017-data-lifecycle-and-backups.md)).
- Backups are Neon's own point-in-time restore inside the plan's history window, plus an optional manual snapshot ([ADR-0021](adr/0021-stay-on-vercel-and-neon.md)). Losing the Neon or Vercel account loses the data, a risk the project owner accepted.

**AI**
- Every adapter enforces data minimization ([ADR-0004](adr/0004-ai-providers-behind-ports.md)); prefer vendor settings that disable training on and retention of our data, recorded in the data-flow register.
- No secrets or credentials in prompts. Tools given to agents are allow-listed per task and run with the requesting person's permissions.
- The evaluation suite includes adversarial cases: injected instructions in documents and web pages, attempts to read other cases, attempts to make agents take outbound actions.

**Environments and secrets**
- Development, preview and production are separate: production is its own Neon branch; before the first case-data table, previews switch to a shared `development` branch that never held family data ([ADR-0012](adr/0012-automation-first-setup.md)). Developer machines are never connected to the hosted database. Production data never leaves production: preview and CI databases start from a synthetic seed. Previews sit behind deployment protection.
- Secrets live in the platform's environment-variable store, never in the repository; scoped per environment and rotated. The Vercel Blob store is reached through Vercel OIDC where it allows, so long-lived storage keys are kept to the one client uploads need ([ADR-0021](adr/0021-stay-on-vercel-and-neon.md)).
- Every vendor and store account is owned by the organization, uses phishing-resistant MFA (passkeys or security keys), named accounts and least-privilege roles.

**Software delivery**
- Branch protection, required checks and the reviewer gates in [REVIEW.md](REVIEW.md): a must-pass security reviewer on every change to code, config, the security docs, ADRs or `ARCHITECTURE.md` ([gates](REVIEW.md#gates-in-order)), plus must-pass specialists (auth and cryptography, data access, supply chain, AI safety) on changes in their areas, so sensitive changes get at least two independent security reads.
- CodeQL for code scanning; osv-scanner for dependency advisories (on each pull request and each push to `main`; Dependabot alerts cannot read pnpm 12's two-document lockfile), registry licenses checked against an allow-list; secret scanning with push protection; gitleaks; Dependabot version updates ([ADR-0010](adr/0010-stack-revised.md)); Actions pinned by SHA; SBOM per build. Reviews run in the authoring session, not in CI ([ADR-0019](adr/0019-reviewers-in-the-authoring-session.md)).
- Dynamic scanning (OWASP ZAP baseline) against preview deployments.
- External penetration test before Phase 3 (other families) and before each store launch; findings tracked to closure.

**Operations**
- Security events (sign-ins, step-ups, vault access, permission and bank-detail changes, knowledge-base decisions) go to the audit log and alerting. The audit log is append-only, enforced by database grants.
- Incident response runbook before real data enters (Phase 1, [spec 0004](specs/0004-real-data-readiness.md) R11), in [runbooks/incident-response.md](runbooks/incident-response.md): severity levels, who does what, containment steps, evidence, and notification steps. Under Brazil's Resolução CD/ANPD 15/2024, a controller notifies the ANPD and affected data subjects within 3 business days of learning that an incident affected personal data ([Cescon Barrieu](https://cesconbarrieu.com.br/anpd-aprova-o-regulamento-de-comunicacao-de-incidente-de-seguranca/)).
- A component-level threat model (STRIDE plus the LLM and agentic risks above) is written for each epic before its code. The foundations' combined model, with each control linked to its test, is [threat-models/foundations.md](threat-models/foundations.md); production takes real data only through the [real-data gate](runbooks/real-data-gate.md).
- Responsible disclosure: [SECURITY.md](../SECURITY.md) in the repository and `security.txt` on the production host.

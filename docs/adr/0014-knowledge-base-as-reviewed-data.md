# ADR-0014: The knowledge base as reviewed data in the repository, activated by the owner's passkey

- Status: Accepted
- Date: 2026-11-02
- Amends: [ADR-0002](0002-rules-as-versioned-data.md) (where route versions live, the shape of their sources, the country dataset, how approval is recorded); [ADR-0006](0006-auth.md) (a second passkey verification, against keys pinned in the repository); [ADR-0008](0008-database-security-and-environments.md) (two append-only tables and the step-up challenge table, with role-scoped policies); [ADR-0010](0010-stack-revised.md) (fast-check for property tests, `@simplewebauthn/server` as a direct API dependency); [ARCHITECTURE.md](../ARCHITECTURE.md) (code layout, rules flow, entities, data flows); CLAUDE.md domain rule 5 (what "sees the change" means)

## Context

[ADR-0002](0002-rules-as-versioned-data.md) makes rules versioned data evaluated by a pure function, with human approval before the engine sees a change. It does not say where the versions live, how they are tested, or how approval is recorded. Facts that shape the answer:

- The knowledge base holds public rules only: routes, requirements, fees, durations, country sets and their sources. It never holds case data ([SECURITY.md](../SECURITY.md), cross-case leakage). The repository is public, which is fine for public rules.
- CLAUDE.md requires table-driven tests for every rule version. Tests live in the repository, next to code.
- Agents act with the owner's GitHub token ([ADR-0012](0012-automation-first-setup.md)). A merged pull request, an approving review or a label from the owner's account is therefore no proof that a person approved anything: an agent can produce each of them.
- A passkey assertion needs the person's gesture on an authenticator. Passkeys may be synced through the owner's Apple or Google account, so they are not bound to one device, but an agent holding a GitHub token cannot produce an assertion.
- Nothing reaches a user from the knowledge base until slice 3 of the consultancy core (case model and intake), which comes after authentication ([spec 0002](../specs/0002-rules-engine-and-knowledge-base.md#the-epic-consultancy-core)).
- A poisoned or wrong rule harms every family that relies on it ([SECURITY.md](../SECURITY.md), assets).

## Decision

### Where the base lives

- Route versions, country sets (for example, the E-2 treaty countries), the official-domain lists, the country lists and the approver allow-list are JSON files in `packages/knowledge/data`, one file per version, validated by the rule schema in `packages/domain` (spec 0002).
- Each route version ships with its table-driven cases in a sibling cases file. CI rejects a version whose cases do not exercise every requirement every way.
- Sources are a list per version, each with an ID, URL, title, kind (`official` or `secondary`) and `verifiedAt`; an `official` source's host must be on an official-domain list the version pins (spec 0002, R4 and R6). This replaces ADR-0002's single source URL.
- Country codes come from a pinned Unicode CLDR release (ISO 3166-1 regions as CLDR lists them), plus a reviewed list of former states with ISO 3166-3 codes (spec 0002, R7). This is ADR-0002's ISO 3166 dataset.
- The API bundles the validated catalog at build time. The database holds the approval decisions and their notices, and gets knowledge tables only when retrieval (pgvector) needs them.
- Whether documents, steps, fees and action points (`knowledge_item`, `action_point`) also become files is decided by slice 5.

### Immutability

- A file under `packages/knowledge/data` or `packages/knowledge/vendor` never changes once it is on `main`. A required check fails a pull request that modifies, renames or deletes one. The check runs from `main` and reads the pull request's files as data, so a pull request cannot weaken the check that judges it (spec 0002, R6). Three kinds of file are append-only instead: cases files, `hashes.json` and the per-route verification logs. They may gain entries, never change or lose them.
- A rule change is a new version with a later effective date. A correction of a data error is a new version with a `corrects` field naming an earlier version; once the correction is in effect, the version it fixes is no longer selected (spec 0002, R5).
- Each version is identified by its route ID and number, and by a content hash. The hash is SHA-256 over the RFC 8785 canonical JSON of one container holding the version and every file it pins, transitively (country sets, official-domain lists, the country lists). Evaluations record both, plus the engine's commit, so an old evaluation can be reproduced exactly.

### Approval in two steps

1. **Proposal.** A change reaches `main` through a pull request like any other, reviewed by the gate. Merged versions are *proposed*: they exist in the catalog, but the engine does not evaluate them for any case. If a proposed version is the one in effect, evaluations say `pending_activation` rather than fall back to an older version.
2. **Decision.** An approver either *activates* or *rejects* a version in the app, with a passkey step-up bound to it.
   - An activated version is evaluated once its activation matures (below).
   - A rejected version leaves version selection once its rejection matures, as if it did not exist, and the route falls back to the version before it. It can never be activated again; a fix is a new version.
   - Rejection works on a proposed version, which is how a bad proposal, including one an agent was tricked into, stops blocking a route. It also works on an active version, which takes a rule out of use.

CLAUDE.md rule 5 holds in this sense. Version selection reads only the identity of proposed versions (number, `effectiveFrom`, `corrects`, `status`, hash, whether rejected), so a proposed closure or correction yields `pending_activation` instead of a silent fallback. The engine never evaluates the content of a version that is not active.

### Approvers and the allow-list

- Approvers come from an allow-list kept in the repository as immutable, numbered files under `packages/knowledge/data/approvers`, never from the database. It sits beside the knowledge data so the same immutability check, policy job and content-hash tooling cover it. Being in a case grants nothing.
- Each entry holds:
  - an opaque approver ID and the account ID;
  - for each notice address, a commitment: a random salt and SHA-256 of the salt and the address;
  - its credentials, each with its ID, COSE public key and a state: `active` (may decide and veto), `retired` (decides nothing; decisions it signed before its retirement took effect stay valid) or `revoked` (decides nothing, and every decision it signed stops counting).
- Every credential ever listed reappears, with a state, in every later version. Only ES256 and Ed25519 keys may be pinned. A version also lists the accepted web and native origins. Origins are only ever added, so an Android signing-key rotation never voids old decisions.
- **Commitments.** The commitment binds notices to the reviewed file; it does not hide the address, which anyone can confirm by guessing. That is accepted for the owner, whose address is already tied to the repository. Before any other approver is added, the commitment moves to HMAC-SHA-256 under a Production-only secret, and account IDs are reconsidered as public identifiers.
- **First version.** The first version holds the owner with at least two credentials: the phone's synced passkey and a device-bound security key kept offline, so one credential can always veto an attack made with the other. It comes into effect when production first sees it. While no version is in effect, every decision is refused.
- **Later versions are decisions too.** A merged allow-list file does nothing on its own. It comes into effect only when an `active` credential of the version in effect activates it, by the same ceremony with purpose `knowledge_allowlist`, and that activation matures like any other. Additions, retirements and revocations all take effect together at that point, never on merge or first sight. Git write access alone therefore never adds, removes or revokes a key.
- **Rotation** (a new phone, a new platform account): a new version adds the new credential and retires the old one, and an active credential activates it. **Loss of every credential:** if no credential of the version in effect can sign, the owner recovers through a recovery version, which comes into effect 7 days after notices to every address of the version in effect, unless an `active` credential vetoes it. A passkey created through account recovery (ADR-0006) is not pinned until such a version adds it.
- **Platform account.** Synced passkeys are accepted, because the owner works mostly from a phone. The Apple or Google account that syncs them is inside the trust boundary; SECURITY.md requires phishing-resistant multi-factor authentication on it, attested when the key is pinned. Any approver beyond the owner uses device-bound security keys.

### The ceremony

A decision is a purpose-bound passkey step-up, defined here. A later ADR on step-up for other sensitive actions may generalize it but must keep these properties.

- **Who.** The approver is resolved from the authenticated session's account ID, matched against the allow-list in effect, never from an ID the client sends. A session whose account is not on the list is refused before a challenge is issued. The assertion's credential must belong to that entry and be `active`.
- **Request.** The request names only the target: a route ID and number, an allow-list number, or a decision ID for a veto. The API resolves the target in its own bundled catalog, or in its decision table for a veto, and refuses one it does not hold. It computes the subject hash itself:
  - for a version, its content hash;
  - for a veto, SHA-256 over the vetoed decision's stored fields, in the length-prefixed encoding below.
  - The activation screen is built from the same entry. Nothing that is hashed or signed comes from the client.
- **Challenge.** The server draws a 32-byte random nonce and sets the challenge to SHA-256 over the ASCII tag `arca-step-up/v1`, the purpose as UTF-8, the 32-byte subject hash and the nonce. Each field is preceded by its length as a 4-byte big-endian integer, and the implementation commits test vectors for this encoding and the veto subject. Purposes: `knowledge_activation`, `knowledge_rejection`, `knowledge_allowlist` and `knowledge_veto`.
- **Lifecycle.** The challenge lives in `step_up_challenge` (below) with the purpose, subject hash, nonce, session, account and an expiry 2 minutes after issue. Submission consumes it atomically (`DELETE … RETURNING`) before verification, and only from the same session. An expired, consumed or foreign challenge is refused. The issue and submit endpoints are rate-limited in the same Postgres-backed storage as the auth endpoints of ADR-0006.
- **Verification at the step-up.** `@simplewebauthn/server`'s `verifyAuthenticationResponse` checks the assertion against the pinned credential, never against a credential row in the database. It receives:
  - the recomputed challenge;
  - the production relying-party ID;
  - the origins listed in the allow-list in effect;
  - `requireUserVerification: true`.

  The library checks the client data type (`webauthn.get`), the challenge, the origin, the `rpIdHash` and the flags. It verifies the signature over the authenticator data and the client data hash with the key's algorithm. There is no WebAuthn parsing or signature code of our own.
- **Counter.** The previous counter is the highest one in the authenticator data of that credential's stored decisions. A credential that reports 0, as synced passkeys do, makes the check a no-op.
- **Dependency.** `@simplewebauthn/server` is a direct dependency of `apps/api`, pinned in the catalog to the version the Better Auth passkey plugin resolves. A single-copy check in `policy.yml` and a Dependabot group that moves both together are added with slice 3.
- **Stored.** The decision row keeps the purpose, the subject hash, the nonce, the credential ID, the authenticator data, the client data JSON and the signature as bytes, so verification on load is byte-exact.
- **Verification on load.** The API loads only the decisions whose targets exist in its bundled catalog, through an index on the target columns.
  - It recomputes each challenge with the subject hash taken from the catalog, cross-checked against the row, and re-verifies with the same call and the pinned key, the counter excepted.
  - A decision signed by a credential now `retired` counts only if its database time precedes the time that retirement took effect.
  - Results are kept per process, keyed by row ID and content hash. A failure is written to the audit log once per row per deployment. Any error means the decision does not count.
  - Maturity is decided here, against the clock. Only then does the API construct the branded `VerifiedDecision` that `packages/domain` accepts, and the domain treats every one as mature.
- Native builds use the platform's passkey APIs behind the `packages/platform` port (ADR-0006). They return the same assertion fields, so the same verification applies.

### Notice, delay and veto

- **Notice record.** A notice record is written for every decision, after the email provider accepts the message for every committed address. The database sets its time. The email carries only the route ID or allow-list number, the version number, the decision kind, the approver ID and the credential ID. It never carries a title or other free text from a version or the allow-list, and no links. Push notices carry only a generic line ("A knowledge-base decision needs your review"); the details are in the app.
- **Delay.** Activations, rejections and allow-list activations count only 48 hours after their notice record. A veto counts as soon as its own notice record exists, since it only stops another decision.
- **Veto.** During those 48 hours, any `active` credential of the allow-list in effect can veto the pending decision in the app, with a `knowledge_veto` step-up. This includes a credential the pending allow-list version would retire or revoke. A vetoed decision never counts, and the same target needs a new step-up. A veto needs no merge or deploy, so the owner can answer a notice from the phone that received it.
  - If two credentials of the same approver keep vetoing each other, nothing new comes into effect. One stolen credential can block decisions but can never approve alone while the owner reads the notices.
- **Fail closed.** A decision without a notice record does not count. If the provider refuses the message or an address does not match its commitment, the decision does not count, and the failure goes to the audit log. A bounce that arrives after the provider accepted the message is not tracked yet. Device notices are the second channel, and a signed bounce webhook that voids the decision is a later addition.
- **Production only.** Decisions, notices and the 48-hour clock run only on the production deployment, identified by the environment check plus the endpoint mark of [spec 0001](../specs/0001-foundations-scaffold.md), R9. An absent, malformed or unknown environment value, or a missing endpoint mark, counts as production. The email credential for notices is a Production-only variable.
- **Outside production.** Previews, CI and the synthetic `development` branch use fixture decisions. These come from a file in `packages/knowledge/test/fixtures`, for fixture routes on user-assigned codes only, never from the database. A non-production verifier loads them and treats them as mature. The production build does not bundle the file, and a test shows the production verifier, including under an unknown environment value, rejects every fixture decision. Eligible, not-eligible and missing-information paths can therefore run end to end before production.

### Storage

- **`knowledge_decision`** has one row per decision (activate, reject, allow-list activation, veto). Each row holds:
  - the target and its content hash;
  - the approver ID and credential ID from the allow-list, never a reference to a user row, so account deletion never touches it;
  - the stored assertion fields above;
  - a time set by the database.
  - The nonce and the signature are each unique across the table, so a copied row is refused.
- **`knowledge_notice`** has one row per sent notice: its target, the channel kind, the provider's message ID and a time set by the database. It never holds an address or a raw provider payload.
- **Grants on both tables.** They are append-only like the audit log. `app_api` may insert and select; the time columns are excluded from its insert privilege, so it cannot backdate the clock. No runtime role may update or delete.
- **Row-level security on both tables.** It is enabled and forced. The policies are deliberately role-scoped: they let `app_api` insert and select, with no person predicate, since the tables hold no case data, and the Drizzle definition marks them as such ([ADR-0008](0008-database-security-and-environments.md), amended).
- **`step_up_challenge`** has row-level security enabled and forced.
  - Its select and delete policies are keyed on the account and session of the transaction identity.
  - `app_api` may insert, select and delete, never update. The nonce is unique.
  - `app_jobs` deletes expired rows daily, through a delete-only policy on expiry.
  - Rows go with the account when it is deleted.
- Nothing is revoked by deleting a row. A change goes through a veto, a rejection, or a credential retired or revoked in an activated allow-list version.
- **Access-matrix tests** cover the three tables:
  - `app_api`: inserts and reads allowed; an insert with a supplied time denied; updates and deletes on the knowledge tables denied for every role.
  - Challenges: a challenge consumable only from its own session; another session's challenge denied.
  - `app_auth` and `app_audit`: all access denied. `app_jobs`: all access denied except the expiry sweep.
- **Retention.** Approver and credential IDs in the knowledge tables are kept after the approver's account is deleted, as an integrity record. SECURITY.md's retention list records this.
- **Audit log** (written by `app_audit`): challenge issued and consumed; decision stored; notice sent or failed; decision matured; decision voided by revocation or veto; allow-list version in effect; every verification failure on load. The trail survives if decision rows are lost.

### What the owner sees

The API computes a structured display model from the catalog entry and serves it through a versioned route in `packages/api-contract`. It holds:

- the expression tree;
- the members of each pinned country set;
- the diff against the version this one replaces, sets included;
- each source's host in punycode, flagging hosts new since that version;
- the version's rule cases by synthetic family, with their expected status and unit.

The client renders the model deterministically with its i18n catalogs and escapes free text at render time. No model is in the path, and the owner sees what the rule does as well as what it says.

Decisions are built in slice 3, with the activation screen. Until then no version is active. That is safe, because nothing reaches a user.

**Every use that reaches a user** reads active versions only, through one interface that returns nothing else. That covers evaluations, the questions derived from them, retrieval and checklists. Only the activation screen shows proposed versions.

### What agents may do

- **Research agents and the watcher.** These agents (the watcher comes later) read untrusted web pages, so they get the narrowest tools. Their definitions, added in slice 2, give them no shell and no generic GitHub tools.
- **The proposal tool.** It commits files under `packages/knowledge/data/routes` and `country-sets` to a new branch and opens a pull request.
  - It normalizes every path and refuses one that resolves anywhere else.
  - It builds the pull request's title and body from the structured proposal (route ID, version number, source hosts, pinned list versions), with no model-written free text.
  - The agents cannot merge, and cannot touch official-domain lists, approver files, workflows, or the decision, verification or notice code.
- **Merging.** A knowledge pull request is merged outside those agents, and any agent that merges one reads its body as data.
- **Fetched pages.** Page text reaches the research agent only inside a delimited data block, with remote images and links stripped. The proposal is extracted through the `Extractor` port with a schema-validated output.
- **Trust roots.** Official-domain lists and the approver allow-list decide what counts as official and who decides. The `knowledge-immutable` job, running from `main`, fails a pull request that changes either one together with any other knowledge data. The exception is `hashes.json`, which it may append to. The job also fails a pull request that changes the decision, verification or notice code together with knowledge data.
  - A host added to an official-domain list must cite proof on a host already in a merged list version, or on a registry such as a country's domain authority. The first list for an issuer gets its own reviewed pull request.
- **Never deciding.** These agents never decide on a version; that needs an approver's passkey.
- **Model-facing text.** Knowledge-base text that reaches a model (retrieval in slice 6) goes inside a delimited data block. The evaluation suite carries an injection fixture route under `eval/`, added with a reviewed extension of the review gate's corpus exemption.
- **Adversarial research cases.** Slice 2 adds these to the evaluation suite, each expected to produce only a correctly structured proposal or a refusal, never a changed threshold or an out-of-scope write:
  - a researched page with injected instructions;
  - a lookalike official host;
  - an attempt to touch the approver list, an official-domain list or a path outside knowledge data.

## Alternatives

| Option | Why not |
| --- | --- |
| Route versions as database rows with an in-app editor | An admin editor, review queue and migrations before the first rule exists; no diff review, no tests beside the data |
| Approval by the owner merging the pull request, or by an approving review | Agents act with the owner's token, so neither proves a person approved |
| A code-owner review rule on `packages/knowledge` | Same reason; ADR-0012 also dropped code-owner reviews |
| Signed commits from the owner's own key | Strong, but needs a computer with the key for every rule; the owner works mostly from a phone |
| Verifying decisions against Better Auth's credential table | Anyone with database access could insert a credential; pinned keys need a reviewed change |
| Allow-list versions that take effect after a notice and silence | Git write plus an unread notice would admit a key; an active credential's signature is required instead |
| Immediate revocation on merge | A merged file, which an agent can produce, would void every activation at once |
| Immediate rejection | A rejected closure or correction puts the looser older version back in use; a stolen synced passkey would use it |
| Device-bound credentials only (rejecting the backup-eligible flag) | Safer against a compromised cloud account, but the owner's phone passkeys are synced; the offline security key covers that case |
| Proposed versions expiring after a number of days instead of rejection | Silent, and a bad proposal would still block the route until then |
| Activating country sets separately from routes | Two approvals for one change in meaning; pinning sets inside the route version's hash covers both with one |
| Let the AI reviewers approve | Breaks domain rule 5 in CLAUDE.md: a person approves |

## Consequences

- Every rule has a reviewable history in Git, tests beside it, and a reproducible identity.
- The owner activates or rejects each rule once, in the app. The activation screen must make that quick and must show the real rule and its cases, not a model's description of it.
- A source is re-verified by appending to its route's verification log, not by a new version, so keeping sources fresh needs no activation (spec 0002, R9).
- Adding a route stays a data change: a new JSON file and its cases, no code. A route that the schema cannot express extends the schema generically, which is a code change in `packages/domain` with its own review.
- The decision, notice and verification code is security-critical, with must-pass security, auth and cryptography, and data-access reviews.
- **Accepted gaps:**
  - a bounce after the provider accepted the message does not void a decision until a signed bounce webhook exists;
  - the owner's notice address is confirmable by a guess;
  - a stolen credential can block decisions until it is revoked.
  - a recovery version admits a key after 7 days of notices without a veto; it is the only path that relies on silence, it exists only for the loss of every credential, and its notices say so.
- **Residual risk**, in line with ADR-0012:
  - An agent holding the owner's GitHub token can merge a bad proposal or change the decision or notice code.
  - Someone with the owner database credentials, or code running in the API process, can insert or delete decision rows (every route then reads `pending_activation`), or write a notice row without sending the email.
  - That is the same exposure ADR-0012 accepts for any code change.
- **What this design guarantees** is narrower:
  - A decision written with database access alone never counts, because it needs a fresh signature by an active pinned credential over that exact target, and a copied row is refused.
  - An allow-list change made in Git alone never takes effect, because it needs an active credential's signature, a notice and 48 hours without a veto.
  - A bad proposal can be rejected without being activated.

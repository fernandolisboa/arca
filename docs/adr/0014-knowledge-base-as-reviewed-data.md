# ADR-0014: The knowledge base as reviewed data in the repository, activated by the owner's passkey

- Status: Accepted
- Date: 2026-11-02
- Amends: [ADR-0002](0002-rules-as-versioned-data.md) (where route versions live, the shape of their sources, the country dataset, how approval is recorded); [ADR-0006](0006-auth.md) (a second passkey verification, against keys pinned in the repository); [ARCHITECTURE.md](../ARCHITECTURE.md) (code layout, rules flow, entities, data flows); CLAUDE.md domain rule 5 (what "sees the change" means)

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

- A file under `packages/knowledge/data` never changes once it is on `main`. A required check fails a pull request that modifies, renames or deletes one; it runs from `main`, reading the pull request's files as data, so a pull request cannot weaken the check that judges it (spec 0002, R6). Cases files are the one exception: entries may be added, never changed or removed.
- A rule change is a new version with a later effective date. A correction of a data error is a new version with a `corrects` field naming an earlier version; once the correction is in effect, the version it fixes is no longer selected (spec 0002, R5).
- Each version is identified by its route ID and number, and by a SHA-256 content hash of the RFC 8785 canonical JSON of the version together with every file it pins, transitively (country sets, official-domain lists, the country lists). Evaluations record both, plus the engine's commit, so an old evaluation can be reproduced exactly.

### Approval in two steps

1. **Proposal.** A change reaches `main` through a pull request like any other, reviewed by the gate. Merged versions are *proposed*: they exist in the catalog but the engine does not evaluate them for any case. If a proposed version is the one in effect, evaluations say `pending_activation` rather than fall back to an older version.
2. **Decision.** The owner either *activates* or *rejects* a proposed version in the app, with a passkey step-up bound to that version. An activated version is evaluated once its activation matures (below). A rejected version leaves version selection at once, as if it did not exist, so the route falls back to the version before it; it can never be activated later, and a fix is a new version. Rejection is how a bad proposal, including one an agent was tricked into, stops blocking a route without the owner signing it.

CLAUDE.md rule 5 holds in this sense: version selection reads the identity of proposed versions (number, `effectiveFrom`, `corrects`, `status`, hash, whether rejected) so that a proposed closure or correction yields `pending_activation` instead of a silent fallback, but the engine never evaluates the content of a version that is not active.

### Approvers

- Approvers come from an allow-list kept in the repository as immutable, numbered files under `packages/knowledge/data/approvers`, covered by the immutability check and reviewed like code, never from the database. Being in a case grants nothing. It starts with the owner alone.
- Each entry has an opaque approver ID, the account ID, the credential IDs and COSE public keys allowed to decide, and, for each notice address, a SHA-256 commitment (a random salt and the hash of the salt and the address). The address itself is not published. At send time the API takes the address from the approver's account and sends only if it matches the commitment; otherwise the notice fails, and so does the decision (below).
- Synced passkeys are accepted, because the owner works mostly from a phone. The Apple or Google account that syncs them is therefore inside the trust boundary and needs phishing-resistant multi-factor authentication, as SECURITY.md already requires for vendor accounts.
- Only ES256 and Ed25519 keys may be pinned.

### The ceremony

- A decision is a step-up of [ADR-0015](0015-identity-enrollment-step-up-and-recovery.md) with purpose `knowledge_activation` or `knowledge_rejection`, whose subject hash is the version's content hash (which covers its route ID and number). ADR-0015 owns the challenge: `SHA-256("arca-step-up/v1" ‖ purpose ‖ subjectHash ‖ nonce)` with a 32-byte server nonce, stored in Postgres, bound to the requesting session and account, consumed once, expiring after 2 minutes, with rate limits in shared storage. It also stores the verified assertion's bytes (credential ID, authenticator data, client data JSON, signature, nonce).
- The decision is accepted only when the step-up's credential is one pinned for that approver in the allow-list in effect, and the step-up passes ADR-0015's own checks, including the signature counter.
- **Verification on load.** Every time it loads decisions, the API re-verifies each stored assertion with `@simplewebauthn/server`'s `verifyAuthenticationResponse` (the copy the Better Auth passkey plugin resolves, per ADR-0015), passing the pinned credential ID and public key from the allow-list, never a credential row from the database; the challenge recomputed from the stored purpose, subject hash and nonce; the production relying-party ID; the origins of ADR-0006 (the web origin and the registered native app origins); and `requireUserVerification: true`. The library checks that the client data type is `webauthn.get`, the challenge, the origin, the `rpIdHash` and the flags, and verifies the signature over the authenticator data and the client data hash with the key's algorithm. There is no WebAuthn parsing or signature code of our own. The counter cannot be re-checked on a stored assertion, so it is checked once, at the step-up. Any error means the decision does not count.
- Native builds use the platform's passkey APIs behind the `packages/platform` port (ADR-0006); they return the same assertion fields, so the same verification applies.

### Delay, notice and veto

- A *notice record* is written for every decision and for every allow-list version, only after the email provider accepts the message to every committed address. Its time is set by the database, and the record is insert-only. The notice names the route, version and decision, the approver ID and the credential ID. Push notices to devices carry only a generic line ("A knowledge-base decision needs your review") and the details are shown in the app.
- An activation counts only 48 hours after its notice record. A rejection or a veto counts once its notice record exists, since it can only take something out of use.
- When the production API first sees a new allow-list version, it notifies the addresses of the previous version too. Keys and addresses the new version adds can decide nothing until 48 hours after that notice. Keys it removes stop counting at once, and so does every decision they signed, active or pending.
- **Veto.** During the 48 hours, any approver with a matured key in the allow-list in effect or in the version before it can veto a pending activation or a new allow-list version in the app, with a step-up of purpose `knowledge_veto` whose subject hash is the content hash of what it vetoes. A vetoed activation never counts; a vetoed allow-list version adds no key that can decide. A veto needs no merge or deploy, so the owner can answer a notice from the phone that received it.
- **Fail closed.** No notice record means the decision does not count. A provider failure, a bounced message or a commitment mismatch leaves it not counting and goes to the audit log.
- **Production only.** Decisions, notices and the 48-hour clock run only on the production deployment (the environment check plus the endpoint mark of [spec 0001](../specs/0001-foundations-scaffold.md), R9). Previews never send notices or count decisions, and the email credential for notices is a Production-only variable, so a preview cannot send one.

### Storage

- `knowledge_decision`: one row per decision (activate, reject, veto), with the target (route ID, number and content hash, or allow-list number and hash), the approver ID and credential ID from the allow-list (never a reference to a user row, so account deletion never touches it), a copy of the step-up's assertion bytes and nonce, and a time set by the database.
- `knowledge_notice`: one row per sent notice, with its target, channels and the provider's acceptance, and a time set by the database.
- Both are append-only like the audit log: `app_api` may insert and select; no runtime role may update or delete, enforced by grants per [ADR-0008](0008-database-security-and-environments.md). Nothing is revoked by deleting a row; a change goes through a veto, a rejection, a key removed from the allow-list, or a new version. The access-matrix suite covers both tables: allowed inserts and reads for `app_api`; denied updates and deletes for every role, and denied access for `app_jobs`, `app_auth` and `app_audit`.
- **Audit log** (written by `app_audit`): step-up issued and verified (ADR-0015), decision stored, notice sent or failed, activation matured, decision voided by a key removal or a veto, allow-list version first seen, and every verification failure on load. The trail survives if decision rows are lost.
- `packages/domain` matches decisions to versions by ID and hash only; it never verifies signatures. It accepts them only as a branded `VerifiedDecision` type that only the API's verifier module constructs (spec 0002, R5).

### What the owner sees

The API computes the activation screen's content from the catalog entry and serves it through a versioned route in `packages/api-contract`; the client only displays it. The screen:

- renders each requirement, dependent rule, cost and duration deterministically from the expression tree, with no model in the path, and escapes free text;
- lists the members of each pinned country set;
- shows the diff against the version it replaces, sets included;
- shows each source's host in punycode and flags hosts new since that version;
- lists the version's cases by synthetic family with their expected status and unit, so the owner sees what the rule does as well as what it says.

Decisions are built in slice 3, with the activation screen. Until then no version is active, which is safe because nothing reaches a user.

**Every use that reaches a user** (evaluations, the questions derived from them, retrieval, checklists) reads active versions only, through one interface that returns nothing else. Only the activation screen shows proposed versions.

### What agents may do

- Research agents and, later, the rule watcher propose versions as pull requests. Their tools allow creating a branch and opening a pull request only: no merging, no changes under `packages/knowledge/data/approvers`, no changes to the decision, verification or notice code. A knowledge pull request is merged outside those agents.
- They never decide on a version; that needs an approver's passkey.
- Knowledge-base text that reaches a model (retrieval in slice 6) goes inside a delimited data block, and the synthetic evaluation suite includes a fixture route whose free-text fields carry injected instructions.

## Alternatives

| Option | Why not |
| --- | --- |
| Route versions as database rows with an in-app editor | An admin editor, review queue and migrations before the first rule exists; no diff review, no tests beside the data |
| Approval by the owner merging the pull request, or by an approving review | Agents act with the owner's token, so neither proves a person approved |
| A code-owner review rule on `packages/knowledge` | Same reason; ADR-0012 also dropped code-owner reviews |
| Signed commits from the owner's own key | Strong, but needs a computer with the key for every rule; the owner works mostly from a phone |
| Verifying decisions against Better Auth's credential table | Anyone with database access could insert a credential; pinned keys need a reviewed change |
| Device-bound credentials only (rejecting the backup-eligible flag) | Safer against a compromised cloud account, but the owner's phone passkeys are synced; revisit if a second approver uses a security key |
| Proposed versions expiring after a number of days instead of rejection | Silent, and a bad proposal would still block the route until then |
| Activating country sets separately from routes | Two approvals for one change in meaning; pinning sets inside the route version's hash covers both with one |
| Let the AI reviewers approve | Breaks domain rule 5 in CLAUDE.md: a person approves |

## Consequences

- Every rule has a reviewable history in Git, tests beside it, and a reproducible identity.
- The owner activates or rejects each rule once, in the app. The activation screen must make that quick and must show the real rule and its cases, not a model's description of it.
- Adding a route stays a data change: a new JSON file and its cases, no code. A route that the schema cannot express extends the schema generically, which is a code change in `packages/domain` with its own review.
- Step-up gains two purposes, `knowledge_rejection` and `knowledge_veto`, beside ADR-0015's `knowledge_activation`. The decision, notice and verification code is security-critical, with must-pass security, auth and cryptography, and data-access reviews.
- Residual risk, in line with ADR-0012: an agent holding the owner's GitHub token can merge a bad proposal, change the decision or notice code, or add a key of its own in the allow-list; and someone with the owner database credentials can insert decision rows, delete them (every route then reads `pending_activation`) or suppress a notice. That is the same exposure ADR-0012 accepts for any code change. What this design guarantees is narrower: a decision written with database access alone, without a change to the reviewed allow-list, never counts, because it needs a pinned key's signature over that exact version; a key added in Git by someone without database access cannot decide for 48 hours, during which the previous approvers are told and can veto it from the app; and a bad proposal can be rejected without being activated.

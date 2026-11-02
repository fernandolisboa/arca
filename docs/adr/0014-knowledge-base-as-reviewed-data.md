# ADR-0014: The knowledge base as reviewed data in the repository, activated by the owner's passkey

- Status: Accepted
- Date: 2026-11-02
- Amends: [ADR-0002](0002-rules-as-versioned-data.md) (where route versions live, the shape of their sources, the country dataset, how approval is recorded); [ADR-0006](0006-auth.md) (a second passkey verification, against keys pinned in the repository); [ADR-0008](0008-database-security-and-environments.md) (two append-only tables written by `app_api`); [ARCHITECTURE.md](../ARCHITECTURE.md) (code layout, rules flow, entities, data flows); CLAUDE.md domain rule 5 (what "sees the change" means)

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
- Each version is identified by its route ID and number, and by a SHA-256 content hash of the RFC 8785 canonical JSON of one container holding the version and every file it pins, transitively (country sets, official-domain lists, the country lists). Evaluations record both, plus the engine's commit, so an old evaluation can be reproduced exactly.

### Approval in two steps

1. **Proposal.** A change reaches `main` through a pull request like any other, reviewed by the gate. Merged versions are *proposed*: they exist in the catalog but the engine does not evaluate them for any case. If a proposed version is the one in effect, evaluations say `pending_activation` rather than fall back to an older version.
2. **Decision.** The owner either *activates* or *rejects* a proposed version in the app, with a passkey step-up bound to that version. An activated version is evaluated once its activation matures (below). A rejected version leaves version selection at once, as if it did not exist, so the route falls back to the version before it; it can never be activated later, and a fix is a new version. Rejection is how a bad proposal, including one an agent was tricked into, stops blocking a route without the owner signing it.

CLAUDE.md rule 5 holds in this sense: version selection reads the identity of proposed versions (number, `effectiveFrom`, `corrects`, `status`, hash, whether rejected) so that a proposed closure or correction yields `pending_activation` instead of a silent fallback, but the engine never evaluates the content of a version that is not active.

### Approvers and the allow-list

- Approvers come from an allow-list kept in the repository as immutable, numbered files under `packages/knowledge/data/approvers`, never from the database. Being in a case grants nothing. It starts with the owner alone. It sits beside the knowledge data so that the same immutability check, policy job and content-hash tooling cover it; research agents are kept out of it by the path rule below, not by its location.
- Each entry has an opaque approver ID, the account ID and, for each notice address, a commitment: a random salt and SHA-256 of the salt and the address. The commitment binds notices to the reviewed file; it does not hide the address, which anyone can confirm by guessing. That is accepted for the owner, whose address is already tied to the repository. Before any other approver is added, the commitment moves to HMAC-SHA-256 under a Production-only secret, and account IDs are reconsidered as public identifiers.
- Each entry lists its credentials, each with its ID, COSE public key and a state: `active` (may decide), `retired` (may no longer decide; the decisions it signed stay valid) or `revoked` (compromised; every decision it signed stops counting). Only ES256 and Ed25519 keys may be pinned.
- Synced passkeys are accepted, because the owner works mostly from a phone. The Apple or Google account that syncs them is therefore inside the trust boundary; SECURITY.md requires phishing-resistant multi-factor authentication on it, attested when the key is pinned. Any approver beyond the owner should use a device-bound security key.
- **Which version is in effect.** A new allow-list version comes into effect 48 hours after the production API first sees it and sends its notice to the addresses of both the new version and the version in effect, unless it is vetoed in that window. Until then the version in effect stays in force in full, for additions, retirements and keys alike. A vetoed version never comes into effect; the next file is numbered after it and judged against the version in effect.
- The one exception is revocation: a credential that a new version marks `revoked` stops counting as soon as production first sees that version, together with its decisions. If that version is then vetoed, the revocation is undone with it.
- **Rotation** (a new phone, a new platform account): a new version adds the new credential and retires the old one; after 48 hours the new one decides, and past decisions stay valid. **Recovery:** a passkey created through account recovery (ADR-0006) is not pinned, so an approver who has lost every pinned credential decides again only after a new allow-list version adding a new one comes into effect.

### The ceremony

A decision is a purpose-bound passkey step-up. This ADR fixes the requirements below. ADR-0015, proposed with the rest of the foundations, generalizes the same ceremony to other step-ups and must keep these properties; until it is accepted, this section is the reference.

- **Request.** The approver asks to activate, reject or veto. The request names only the target: a route ID and number, an allow-list number, or a decision ID for a veto. The API resolves the target in its own bundled catalog, or in its decision table for a veto, and refuses one it does not hold. It computes the subject hash itself: the target's content hash, or for a veto the SHA-256 of the vetoed decision's stored assertion bytes. The activation screen is built from the same entry. Nothing that is hashed or signed comes from the client.
- **Challenge.** The server draws a 32-byte random nonce and sets the challenge to SHA-256 over: the ASCII tag `arca-step-up/v1`, the purpose as UTF-8, the 32-byte subject hash and the nonce, each field preceded by its length as a 4-byte big-endian integer. The implementation commits a test vector for this encoding. Purposes: `knowledge_activation`, `knowledge_rejection` and `knowledge_veto`.
- **Lifecycle.** The challenge row lives in Postgres with the purpose, subject hash, nonce, the requesting session and account, and an expiry 2 minutes after issue. Submission consumes it atomically (`DELETE … RETURNING`) before verification, and only from the same session. An expired, consumed or foreign challenge is refused. The issue and submit endpoints are rate-limited with storage in Postgres (ADR-0006).
- **Verification at the step-up.** `@simplewebauthn/server`'s `verifyAuthenticationResponse` checks the assertion against the credential pinned for that approver as `active` in the allow-list in effect, never against a credential row in the database. It receives the recomputed challenge, the production relying-party ID, the origins of ADR-0006 (the web origin and the registered native app origins) and `requireUserVerification: true`. The library checks that the client data type is `webauthn.get`, the challenge, the origin, the `rpIdHash` and the flags, and verifies the signature over the authenticator data and the client data hash with the key's algorithm. It also checks the signature counter, which is possible only here. There is no WebAuthn parsing or signature code of our own.
- `@simplewebauthn/server` is a direct dependency of `apps/api`, pinned in the catalog to the version the Better Auth passkey plugin resolves. A lockfile check keeps a single copy installed, so both passkey paths verify the same way.
- **Stored.** The decision row keeps the purpose, the subject hash, the nonce, the credential ID, the authenticator data, the client data JSON and the signature as bytes, so verification on load is byte-exact.
- **Verification on load.** The API loads only the decisions whose targets exist in its bundled catalog, through an index on the target columns. It re-verifies each one with the same call and the pinned key, the counter excepted, and keeps the result per process, keyed by the row ID and content hash. A failure is written to the audit log once per row per deployment. Any error means the decision does not count. Maturity is decided here against the clock. Only then does the API construct the branded `VerifiedDecision` that `packages/domain` accepts, and the domain treats every one as mature.
- Native builds use the platform's passkey APIs behind the `packages/platform` port (ADR-0006). They return the same assertion fields, so the same verification applies.

### Notice, delay and veto

- **Notice record.** A record is written for every decision and for every new allow-list version, but only after the email provider accepts the message for every committed address. The database sets its time. The email carries only the route ID, version number, decision kind, approver ID and credential ID: never a title or any other free text from a version or the allow-list, and no links. Push notices carry only a generic line ("A knowledge-base decision needs your review"); the details are in the app.
- An activation counts only 48 hours after its notice record. A rejection or a veto counts once its notice record exists, since it can only take something out of use.
- **Veto.** During those 48 hours, any approver with an `active` credential in the allow-list in effect can veto in the app, with a `knowledge_veto` step-up. A veto can target a pending activation or a new allow-list version. A vetoed activation never counts, and activating that version again needs a new step-up. A vetoed allow-list version has no effect at all. A veto needs no merge or deploy, so the owner can answer a notice from the phone that received it.
- **Fail closed.** A decision without a notice record does not count. If the provider refuses the message or the address does not match its commitment, the decision does not count, and the failure goes to the audit log. A bounce that arrives after the provider accepted the message is not tracked yet. The device notices are the second channel. A signed bounce webhook that voids the decision is a later addition, recorded under Consequences.
- **Production only.** Decisions, notices and the 48-hour clock run only on the production deployment, identified by the environment check plus the endpoint mark of [spec 0001](../specs/0001-foundations-scaffold.md), R9. The email credential for notices is a Production-only variable.
- **Outside production**, previews, CI and the synthetic `development` branch use fixture decisions. The synthetic seed ships them for fixture routes on user-assigned codes only, and the verifier accepts them only when the environment check says non-production. Eligible, not-eligible and missing-information paths can therefore run end to end before production. A test shows the production verifier rejects every fixture decision.

### Storage

- **`knowledge_decision`** has one row per decision (activate, reject or veto). Each row records:
  - the target and its content hash;
  - the approver ID and credential ID from the allow-list, never a reference to a user row, so account deletion never touches it;
  - the stored assertion fields above;
  - a time set by the database.
  - The nonce and the signature are each unique across the table, so a copied row is refused.
- **`knowledge_notice`** has one row per sent notice: its target, the channel kind, the provider's message ID and a time set by the database. It never holds an address or a raw provider payload.
- **Grants.** Both tables are append-only like the audit log. `app_api` may insert and select, with the time columns excluded from its insert privilege, so it cannot backdate the clock. No runtime role may update or delete. Both have row-level security enabled and forced, with policies that allow only `app_api` to insert and select, since they hold no case data to scope by person ([ADR-0008](0008-database-security-and-environments.md), amended).
- Nothing is revoked by deleting a row. A change goes through a veto, a rejection, or a credential retired or revoked in a new allow-list version.
- **Access-matrix tests** cover both tables: inserts and reads allowed for `app_api`; inserts with a supplied time denied; updates and deletes denied for every role; all access denied for `app_jobs`, `app_auth` and `app_audit`.
- **Retention.** Approver and credential IDs in these tables are kept after the approver's account is deleted, as an integrity record. SECURITY.md's retention list records this.
- **Audit log** (written by `app_audit`) records:
  - challenge issued and consumed;
  - decision stored;
  - notice sent or failed;
  - activation matured;
  - decision voided by revocation or veto;
  - allow-list version first seen and in effect;
  - every verification failure on load.
  - The trail survives if decision rows are lost.

### What the owner sees

The API computes a structured display model from the catalog entry and serves it through a versioned route in `packages/api-contract`. The model holds the expression tree, the members of each pinned country set, the diff against the version this one replaces (sets included), each source's host in punycode with hosts new since that version flagged, and the version's cases by synthetic family with their expected status and unit. The client renders it deterministically with its i18n catalogs, escapes free text at render time and puts no model in the path, so the owner sees what the rule does as well as what it says.

Decisions are built in slice 3, with the activation screen. Until then no version is active, which is safe because nothing reaches a user.

**Every use that reaches a user** reads active versions only, through one interface that returns nothing else. That covers evaluations, the questions derived from them, retrieval and checklists. Only the activation screen shows proposed versions.

### What agents may do

- Research agents and, later, the rule watcher read untrusted web pages, so they get the narrowest tools. Their harness, the agent definitions slice 2 adds, gives them no shell and no generic GitHub tools. They get one proposal tool that commits files under `packages/knowledge/data/routes`, `country-sets` and `official-domains` to a new branch and opens a pull request. They cannot merge, and they cannot touch `data/approvers`, workflows, or the decision, verification or notice code. A knowledge pull request is merged outside those agents.
- The `knowledge-immutable` policy job enforces the split from `main`. It fails a pull request that changes `data/approvers` together with anything else, or that changes the decision, verification or notice code together with knowledge data, so an approver change is always its own pull request.
- They never decide on a version; that needs an approver's passkey.
- Knowledge-base text that reaches a model (retrieval in slice 6) goes inside a delimited data block. The synthetic evaluation suite includes a fixture route whose free-text fields carry injected instructions.
- Slice 2 ships adversarial research cases in the evaluation suite. Each is expected to produce only a correctly structured proposal or a refusal, never a changed threshold or an out-of-scope write:
  - a researched page with injected instructions;
  - a lookalike official host;
  - an attempt to touch the approver list or a path outside knowledge data.

## Alternatives

| Option | Why not |
| --- | --- |
| Route versions as database rows with an in-app editor | An admin editor, review queue and migrations before the first rule exists; no diff review, no tests beside the data |
| Approval by the owner merging the pull request, or by an approving review | Agents act with the owner's token, so neither proves a person approved |
| A code-owner review rule on `packages/knowledge` | Same reason; ADR-0012 also dropped code-owner reviews |
| Signed commits from the owner's own key | Strong, but needs a computer with the key for every rule; the owner works mostly from a phone |
| Verifying decisions against Better Auth's credential table | Anyone with database access could insert a credential; pinned keys need a reviewed change |
| Device-bound credentials only (rejecting the backup-eligible flag) | Safer against a compromised cloud account, but the owner's phone passkeys are synced; required for later approvers instead |
| Proposed versions expiring after a number of days instead of rejection | Silent, and a bad proposal would still block the route until then |
| Immediate allow-list removals | A merged file, which an agent can produce, would void every activation at once with no veto |
| Activating country sets separately from routes | Two approvals for one change in meaning; pinning sets inside the route version's hash covers both with one |
| Let the AI reviewers approve | Breaks domain rule 5 in CLAUDE.md: a person approves |

## Consequences

- Every rule has a reviewable history in Git, tests beside it, and a reproducible identity.
- The owner activates or rejects each rule once, in the app. The activation screen must make that quick and must show the real rule and its cases, not a model's description of it.
- Adding a route stays a data change: a new JSON file and its cases, no code. A route that the schema cannot express extends the schema generically, which is a code change in `packages/domain` with its own review.
- The decision, notice and verification code is security-critical, with must-pass security, auth and cryptography, and data-access reviews.
- With one approver, a rejection is immediate and permanent. Before a second approver is added, rejections get the same 48-hour notice and veto window as activations.
- Accepted gaps:
  - a bounce after the provider accepted the message does not void a decision until a signed bounce webhook exists;
  - the owner's notice address is confirmable by a guess.
- Residual risk, in line with ADR-0012:
  - An agent holding the owner's GitHub token can merge a bad proposal, change the decision or notice code, or add a key of its own in the allow-list.
  - Someone with the owner database credentials can insert decision rows, delete them (every route then reads `pending_activation`) or suppress a notice.
  - That is the same exposure ADR-0012 accepts for any code change.
- What this design guarantees is narrower:
  - A decision written with database access alone, without a change to the reviewed allow-list, never counts. It needs a fresh pinned-key signature over that exact target, and a copied row is refused.
  - A key added in Git by someone without database access cannot decide for 48 hours. During that window the previous approvers are told and can veto it from the app.
  - A bad proposal can be rejected without being activated.

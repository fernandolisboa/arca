# ADR-0014: The knowledge base as reviewed data in the repository, activated by the owner's passkey

- Status: Accepted
- Date: 2026-11-02
- Amends: [ADR-0002](0002-rules-as-versioned-data.md) (where route versions live, the shape of their sources, the country dataset, how approval is recorded); [ADR-0006](0006-auth.md) (a second passkey verification, against keys pinned in the repository); [ADR-0008](0008-database-security-and-environments.md) (two append-only tables with role-scoped policies); [ADR-0010](0010-stack-revised.md) (fast-check for property tests, `@simplewebauthn/server` as a direct API dependency); [ARCHITECTURE.md](../ARCHITECTURE.md) (code layout, rules flow, entities, data flows); CLAUDE.md domain rule 5 (what "sees the change" means)

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
- **Entry.** Each entry has:
  - an opaque approver ID and the account ID;
  - for each notice address, a commitment;
  - its credentials, each with its ID, COSE public key and a state;
  - the accepted web and native origins, each with a state.
- **Credential states.**
  - `active`: may decide and veto.
  - `retired`: decides nothing from the time its retirement takes effect; decisions it signed before then stay valid.
  - `revoked`: decides nothing, and every route-version decision it ever signed stops counting.
- **Origin states.** `active` or `retired`. A fresh step-up accepts only active origins, and verification on load accepts the origins that were active at the decision's time. Rotating a native signing key retires its origin and removes the old key from the asset links file.
- Every credential and origin ever listed reappears, with a state, in every later version, which validation checks. Only ES256 and Ed25519 keys may be pinned.
- **Commitment.**
  - Each commitment is SHA-256 over a 32-byte random salt and the address, in the length-prefixed encoding of the ceremony below.
  - The address is in canonical form: NFC, the domain lowercased, the local part as registered. Test vectors are committed.
  - It binds notices to the reviewed file but does not hide the address, which anyone can confirm by guessing. That is accepted for the owner, whose address is already tied to the repository.
  - Before any other approver is added, the commitment moves to HMAC-SHA-256 under a Production-only secret, and account IDs are reconsidered as public identifiers.
- **Address source.** At send time the address comes from the approver's account record. Email change is not offered (ADR-0006); if it ever is, an approver's address changes only after a new allow-list version with its commitment takes effect.
- **Independent channel.** At least one committed address is with a provider other than the platform account that syncs that approver's passkeys, and the entry names both providers so the reviewers of `data/approvers` can check it.
- **Platform account.** Synced passkeys are accepted, because the owner works mostly from a phone. The Apple or Google account that syncs them is inside the trust boundary; SECURITY.md requires phishing-resistant multi-factor authentication on it, attested when the key is pinned. Any approver beyond the owner uses device-bound security keys.

### Which allow-list is in effect

- **Pinning a credential.** A credential's ID and public key come from a registration the owner performs on the app's approver-key screen, which shows them for the owner to commit. They never come from a database row or from an agent's context.
- **Bootstrap.** The first version holds the owner with at least two credentials: the phone's synced passkey and a device-bound security key kept offline, so one can always veto an attack made with the other. It comes into effect only after every credential it lists has signed a `knowledge_allowlist` activation of it, from a session of the listed account. That is proof of possession for each key, so a foreign key blocks the bootstrap instead of being trusted. While no version is in effect, every decision is refused.
- **Later versions.** A merged allow-list file does nothing on its own. It comes into effect only when an `active` credential of the version in effect signs a `knowledge_allowlist` activation of it, and that activation matures like any other. Additions, retirements and revocations all take effect together at that point, never on merge.
- **Evaluation order.** The version in effect is computed as a fold in version order. Each allow-list activation is judged against the version in effect at its database time, and one that has taken effect is never voided later. A revocation voids route-version decisions only, never an allow-list activation already in effect. Any chain therefore has one answer; a bad later version is handled by a veto or a further version.
- **Vetoing your own removal.** A credential cannot veto an allow-list activation that retires or revokes it. Holding a stolen credential therefore never blocks its own revocation.
- **Rotation** (a new phone, a new platform account): a new version adds the new credential and retires the old one, and an active credential activates it.
- **Loss of every credential.** There is no in-app recovery path. With a synced passkey and an offline security key, losing both is unlikely. If it happens, the bootstrap is reset by a reviewed change to the verification code, which is the ADR-0012 residual risk named below. A passkey created through account recovery (ADR-0006) is never pinned by that recovery alone.

### The ceremony

A decision is a purpose-bound passkey step-up, defined here. A later ADR on step-up for other sensitive actions may generalize it but must keep these properties.

- **Who.** The approver is resolved from the authenticated session's account ID, matched against the allow-list in effect, never from an ID the client sends. A session whose account is not on the list is refused before a challenge is issued. So is every read route that serves proposed versions, display models, decisions or notices. The assertion's credential must belong to that entry and be `active`.
- **Request.** The request names only the target: a route ID and number, an allow-list number, or a decision ID for a veto.
  - The API resolves the target in its own bundled catalog, or in its decision table for a veto, and refuses one it does not hold.
  - It refuses an activation of a rejected target.
  - It computes the subject hash itself: for a version, its content hash; for a veto, SHA-256 over the vetoed decision's stored fields in the length-prefixed encoding below.
  - The activation screen is built from the same entry. Nothing that is hashed or signed comes from the client.
- **Challenge.** The server draws a 32-byte random nonce. The challenge is SHA-256 over four fields: the ASCII tag `arca-step-up/v1`, the purpose as UTF-8, the 32-byte subject hash and the nonce. Each field is preceded by its length as a 4-byte big-endian integer. The implementation commits test vectors for this encoding, for the veto subject and for the commitments.
- **Purposes.** `knowledge_activation`, `knowledge_rejection`, `knowledge_allowlist` and `knowledge_veto`.
- **Lifecycle.**
  - The challenge lives in `auth.step_up_challenge`, the one table for all step-up challenges, written only by `app_auth`, which runs the step-up endpoints. It holds the purpose, subject hash, nonce, session row ID (never the session token), account and an expiry 2 minutes after issue.
  - Submission consumes it atomically (`DELETE … RETURNING`) before verification, and only from the same session. An expired, consumed or foreign challenge is refused.
  - The issue and submit endpoints are rate-limited in the same Postgres-backed storage as the auth endpoints of ADR-0006.
- **Verification at the step-up.** `@simplewebauthn/server`'s `verifyAuthenticationResponse` checks the assertion against the pinned credential, never against a credential row in the database. It is given:
  - the recomputed challenge;
  - the production relying-party ID;
  - the active origins;
  - `requireUserVerification: true`.

  The library checks the client data type (`webauthn.get`), the challenge, the origin, the `rpIdHash` and the flags, and verifies the signature over the authenticator data and the client data hash with the key's algorithm. There is no WebAuthn parsing or signature code of our own.
- **Counter.** The previous counter is the highest one in the authenticator data of that credential's stored decisions; a credential that reports 0, as synced passkeys do, makes the check a no-op.
- **Dependency.** `@simplewebauthn/server` is a direct dependency of `apps/api`, pinned in the catalog to the version the Better Auth passkey plugin resolves. Slice 3 adds a single-copy check in `policy.yml` and a Dependabot group that moves both together.
- **Stored.** The decision row keeps the purpose, the subject hash, the nonce, the credential ID, the authenticator data, the client data JSON and the signature as bytes, so verification on load is byte-exact.
- **Verification on load.**
  - The API loads the decisions whose targets exist in its bundled catalog, plus the vetoes of those decisions by target decision ID, through indexes on both.
  - It recomputes each challenge, taking the subject hash from the catalog and cross-checking it against the row, and re-verifies with the same call and the pinned key, the counter excepted.
  - Only this cryptographic result is cached per process, keyed by row ID and content hash. A failure is written to the audit log once per row per deployment, and any error means the decision does not count.
  - The API then wraps each verified row as the branded `VerifiedDecision`, constructed only in its verifier module.
- **Decision state.** Maturity, vetoes, credential states and the allow-list in effect are business rules, so they are not computed in the API. They are computed on every load, uncached, by a pure function in `packages/domain`: `decisionStates(verified, notices, allowLists, now)`. The API passes the clock explicitly as `now`, separate from any evaluation date, and the function is table-tested there (spec 0002, R5).
- **Native builds** use the platform's passkey APIs behind the `packages/platform` port (ADR-0006). They return the same assertion fields, so the same verification applies.

### Notice, delay and veto

- **Notice record.**
  - The API sends the email in the request that stores the decision, under `app_api`, and writes a notice row after the provider accepts the message for every committed address. The database sets the row's time.
  - The email carries only the route ID or allow-list number, the version number, the decision kind, the approver ID and the credential ID. It never carries a title or other free text from a version or the allow-list, and no links.
  - Push notices go to the approver's devices registered before the challenge was issued. They carry only a generic line from the i18n catalog, and the details are in the app.
  - Notice texts are i18n catalog keys with natural pt-BR copy, rendered in the approver's locale.
- **Delay.**
  - Activations, rejections and allow-list activations count only 48 hours after the earliest email notice row of that exact decision. A unique constraint on (decision, channel) keeps one such row per decision, and a retry never restarts the clock.
  - A decision without its own email notice row does not count. If the provider refuses the message, or an address does not match its commitment, the decision does not count and the failure goes to the audit log.
- **Veto.**
  - During those 48 hours, any `active` credential of the allow-list in effect can veto the pending decision in the app with a `knowledge_veto` step-up, except a credential vetoing its own retirement or revocation.
  - A veto counts from its own database time as soon as it is stored. Its notice is sent afterwards, and a failure is audited without voiding the veto, since refusing a stop would fail open.
  - A pending decision matures only if no verified veto of it has a database time before its notice time plus 48 hours.
  - A vetoed decision never counts; the same target needs a new step-up. A veto needs no merge or deploy, so the owner can answer a notice from the phone that received it.
- **Rejection versus activation.** A rejection always wins over an activation of the same version, whatever their order.
- **Production only.**
  - Decisions, notices and the 48-hour clock run only on the production deployment, identified by the environment check plus the endpoint mark of [spec 0001](../specs/0001-foundations-scaffold.md), R9.
  - An absent, malformed or unknown environment value, or a missing endpoint mark, counts as production.
  - The email credential for notices is a Production-only variable.
- **Outside production.**
  - Previews, CI and the synthetic `development` branch use fixture decisions from a file in `packages/knowledge/test/fixtures`, for fixture routes on user-assigned codes only, never from the database.
  - A non-production verifier loads them as mature. The production build does not bundle the file.
  - A test shows the production verifier, including under an unknown environment value, rejects every fixture decision.
  - Eligible, not-eligible and missing-information paths can therefore run end to end before production.

### Storage

- **`knowledge_decision`.** One row per decision (activation, rejection, allow-list activation, veto), with:
  - the target and its content hash;
  - the approver ID and credential ID from the allow-list, never a reference to a user row, so account deletion never touches it;
  - the stored assertion fields above;
  - a time set by the database.
  - The nonce and the signature are each unique across the table, so a copied row is refused.
- **`knowledge_notice`.** One row per sent notice: the `decision_id` it was sent for (not null, referencing `knowledge_decision`), the channel kind, the provider's message ID and a time set by the database. It never holds an address or a raw provider payload.
- **Grants.** Both tables are append-only like the audit log. `app_api` may insert and select, with the time columns excluded from its insert privilege so it cannot backdate the clock. No runtime role may update or delete.
- **Row-level security.**
  - It is enabled and forced on both tables, with deliberately role-scoped policies: only `app_api` may insert and select, with no person predicate, since the tables hold no case data ([ADR-0008](0008-database-security-and-environments.md), amended).
  - A schema test in the `db` check fails any forced-RLS table whose policies have no identity predicate, unless it is on an explicit list of role-scoped tables, today these two.
- **`auth.step_up_challenge`.** It belongs to the auth schema and the auth role. `app_api` and `app_jobs` have no access to it.
- **No deletion as revocation.** Nothing is revoked by deleting a row. A change goes through a veto, a rejection, or a credential retired or revoked in an allow-list version that took effect.
- **Access-matrix tests.**
  - `app_api` may insert into and read the knowledge tables. Inserts with a supplied time, and updates and deletes by any role, are denied.
  - `app_auth`, `app_jobs` and `app_audit` are denied all access to the knowledge tables.
  - `app_api`, `app_jobs` and `app_audit` are denied all access to `auth.step_up_challenge`.
- **Retention.** Approver and credential IDs in the knowledge tables are kept after the approver's account is deleted, as an integrity record. SECURITY.md's retention list records this.
- **Audit log** (written by `app_audit`). It records:
  - challenge issued and consumed;
  - decision stored;
  - notice sent or failed;
  - decision matured;
  - decision voided by revocation or veto;
  - allow-list version in effect;
  - every verification failure on load.

  The trail survives if decision rows are lost.

### What the owner sees

The API computes a display model from the catalog entry and serves it through a versioned route in `packages/api-contract`. The model is its own wire shape, defined in `api-contract`, that the API maps to, so the contract does not import the rule or snapshot schemas. It holds:

- the expression tree;
- the members of each pinned country set;
- the diff against the version this one replaces, sets included;
- each source's host in punycode, flagging hosts new since that version;
- the version's rule cases by synthetic family, with their expected status and unit.

The client renders the model deterministically with its i18n catalogs and escapes free text at render time. No model is in the path, and the owner sees what the rule does as well as what it says.

Decisions are built in slice 3, with the activation screen. Until then no version is active. That is safe, because nothing reaches a user.

**Every use that reaches a user** reads active versions only, through one interface that returns nothing else. That covers evaluations, the questions derived from them, retrieval and checklists. Only the activation screen shows proposed versions.

### What agents may do

- **Research agents and the watcher.** These agents (the watcher comes later) read untrusted web pages, so they get the narrowest tools. Their definitions, added in slice 2, give them no shell, no generic GitHub tools and no tool or port that reads case data. A research task carries only public terms and identifiers: country, route ID, requirement key and the missing knowledge item, never snapshot facts, intake text or person IDs.
- **The fetch tool.** It allows GET over `https` only, with no credentials or cookies and a size and count limit per task. Responses come back only inside a delimited data block, with links and remote images stripped. Every fetched host is logged with the proposal, and the agents have no other network tool.
- **The proposal tool.** It sits behind a port, `KnowledgeProposalSink`, with a GitHub adapter and a fake for tests. It commits files under `packages/knowledge/data/routes` and `country-sets` to a new branch and opens a pull request.
  - It normalizes every path and refuses one that resolves anywhere else.
  - It accepts only the route and country-set IDs the task names, and refuses a `closed` or `corrects` version the task did not ask for.
  - It builds the pull request's title and body from the structured proposal (route ID, version number, source hosts, pinned list versions), with no model-written free text.
  - The agents cannot merge, and cannot touch official-domain lists, approver files, workflows, or the decision, verification or notice code.
- **Merging.** A knowledge pull request is merged outside those agents, and any agent that merges one reads its body and files as data.
- **Extraction.** The proposal is extracted from fetched text through the `Extractor` port, with a schema-validated output.
- **Trust roots.** Official-domain lists and the approver allow-list decide what counts as official and who decides. The `knowledge-immutable` job, running from `main`, fails a pull request that changes either one together with any other knowledge data. The exception is `hashes.json`, which it may append to. The job also fails a pull request that changes the decision, verification or notice code together with knowledge data.
  - A host added to an official-domain list must cite proof on a host already in a merged list version, or on a registry such as a country's domain authority. The first list for an issuer gets its own reviewed pull request.
- **Never deciding.** These agents never decide on a version; that needs an approver's passkey.
- **Model-facing text.** Knowledge-base text that reaches a model (retrieval in slice 6) goes inside a delimited data block. The evaluation suite carries an injection fixture route in `packages/knowledge/test/fixtures/injection/`. Its exemption from the review gate's injection check is a separate reviewed change and is narrow: reviewers stop reporting text there aimed at the assistant, but still report text aimed at reviewers or tools, and still check that the files use user-assigned codes, respect the caps and are never bundled.
- **Adversarial research cases.** Slice 2 adds these to the evaluation suite, each expected to produce only a correctly structured proposal or a refusal, never a changed threshold or an out-of-scope write:
  - a researched page with injected instructions;
  - a lookalike official host;
  - an attempt to touch the approver list, an official-domain list or a path outside knowledge data;
  - a page targeting a different route than the one researched;
  - a page asking the agent to fetch a URL that carries task content.

## Alternatives

| Option | Why not |
| --- | --- |
| Route versions as database rows with an in-app editor | An admin editor, review queue and migrations before the first rule exists; no diff review, no tests beside the data |
| Approval by the owner merging the pull request, or by an approving review | Agents act with the owner's token, so neither proves a person approved |
| A code-owner review rule on `packages/knowledge` | Same reason; ADR-0012 also dropped code-owner reviews |
| Signed commits from the owner's own key | Strong, but needs a computer with the key for every rule; the owner works mostly from a phone |
| Verifying decisions against Better Auth's credential table | Anyone with database access could insert a credential; pinned keys need a reviewed change |
| Allow-list versions, or a recovery version, that take effect after a notice and silence | Git write plus an unread notice would admit a key; an active credential's signature is required instead |
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
  - a stolen credential can veto decisions until another credential revokes it;
  - push notices are best-effort, so the independent email address is the channel the delay relies on;
  - losing every pinned credential leaves no in-app recovery.
- **Residual risk**, in line with ADR-0012:
  - An agent holding the owner's GitHub token can merge a bad proposal or change the decision, notice or verification code, which is also the only reset after losing every credential.
  - Someone with the owner database credentials, or code running in the API process, can insert or delete decision rows (every route then reads `pending_activation`), or write a notice row without sending the email.
  - That is the same exposure ADR-0012 accepts for any code change.
- **What this design guarantees** is narrower:
  - A decision written with database access alone never counts, because it needs a fresh signature by an active pinned credential over that exact target, and a copied row is refused.
  - An allow-list change made in Git alone never takes effect. The first version needs a signature from every credential it lists, from the owner's session, and every later one needs an active credential's signature, a notice and 48 hours without a veto.
  - A bad proposal can be rejected without being activated.

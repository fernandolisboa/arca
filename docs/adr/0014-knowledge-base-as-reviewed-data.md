# ADR-0014: The knowledge base as reviewed data in the repository, activated by the owner's passkey

- Status: Accepted
- Date: 2026-11-02
- Amends: [ADR-0002](0002-rules-as-versioned-data.md) (where route versions live, how approval is recorded); [ADR-0006](0006-auth.md) (step-up also activates knowledge-base versions); [ARCHITECTURE.md](../ARCHITECTURE.md) (code layout, rules flow)

## Context

[ADR-0002](0002-rules-as-versioned-data.md) makes rules versioned data evaluated by a pure function, with human approval before the engine sees a change. It does not say where the versions live, how they are tested, or how approval is recorded. Facts that shape the answer:

- The knowledge base holds public rules only: routes, requirements, fees, durations, country sets and their sources. It never holds case data ([SECURITY.md](../SECURITY.md), cross-case leakage). The repository is public, which is fine for public rules.
- CLAUDE.md requires table-driven tests for every rule version. Tests live in the repository, next to code.
- Agents act with the owner's GitHub token ([ADR-0012](0012-automation-first-setup.md)). A merged pull request, an approving review or a label from the owner's account is therefore no proof that a person approved anything: an agent can produce each of them.
- Passkeys (ADR-0006) are bound to a device and need the person's gesture. An agent cannot produce an assertion from the owner's passkeys.
- Nothing reaches a user from the knowledge base until slice 3 of the consultancy core (case model and intake), which comes after authentication ([spec 0002](../specs/0002-rules-engine-and-knowledge-base.md#the-epic-consultancy-core)).
- A poisoned or wrong rule harms every family that relies on it ([SECURITY.md](../SECURITY.md), assets).

## Decision

### Where the base lives

- Route versions, country sets (for example, the E-2 treaty countries), the official-domain lists and the country list are JSON files in `packages/knowledge`, one file per version, validated by the rule schema in `packages/domain` (spec 0002).
- Each route version ships with its table-driven cases in a sibling file. CI rejects a version whose cases do not exercise every requirement every way.
- The API bundles the validated catalog at build time. The database holds the activations, and gets knowledge tables only when retrieval (pgvector) needs them.
- Whether documents, steps, fees and action points (`knowledge_item`, `action_point`) also become files is decided by slice 5.

### Immutability

- A file under `packages/knowledge/data` never changes once it is on `main`. CI fails a pull request that modifies, renames or deletes one. Cases files are the one exception: entries may be added, never changed or removed.
- A rule change is a new version with a later effective date. A correction of a data error is a new version with a `corrects` field naming an earlier version and that version's effective date, which wins over the version it fixes.
- Each version is identified by its route ID and number, and by a SHA-256 content hash of the RFC 8785 canonical JSON of the version together with every country-set, official-domain and countries version it pins. Evaluations record both, plus the engine's commit, so an old evaluation can be reproduced exactly.

### Approval in two steps

1. **Proposal.** A change reaches `main` through a pull request like any other, reviewed by the gate. Merged versions are *proposed*: they exist in the catalog but the engine does not evaluate them for any case. If a proposed version is the one in effect, evaluations say `pending_activation` rather than fall back to an older version.
2. **Activation.** The owner activates a proposed version in the app. The activation stores the passkey assertion, the approver and the time, and binds them to the version's ID and content hash, so it also covers the country sets and official-domain list the version pins.

Activation rules:

- **Who:** approvers come from an allow-list kept in the repository as immutable, numbered files and reviewed like code, never from the database. Each entry pins the approver's account, the credential IDs and public keys allowed to activate, and the address for activation notices. It starts with the owner alone. Being in a case grants nothing.
- **Challenge:** a server-issued, random, single-use nonce, combined deterministically with the purpose, route ID, number and content hash (SHA-256 over their canonical encoding), so an assertion signs exactly one version.
- **Verification:** every time it loads activations, the API recomputes the challenge from the stored activation and compares it with the assertion's `clientDataJSON`, checks the relying-party ID, the origin and the user-presence and user-verification flags, and checks the signature against a public key pinned in the allow-list, never against a credential row in the database. It fails closed: any error means not active. An activation signed with a key removed from the allow-list stops counting.
- **Delay and notice:** an activation counts only 48 hours after the production API, which runs code from `main`, sends its notice to the pinned address and to every registered device. The notice names the version, the approver and the credential. Removing the key from the allow-list within the window cancels it.
- **Matching:** the domain package only matches activations to versions by ID and hash; it never verifies signatures.
- **What the owner sees:** the activation screen renders each requirement, dependent rule, cost and duration deterministically from the expression tree, with no model in the path; lists the members of each pinned country set; shows the diff against the version it replaces, sets included; and shows each source's host in punycode, flagging hosts that are new since that version. Free-text fields are escaped.

Activation is built in slice 3, together with the activation screen. Until then no version is active, which is safe because nothing reaches a user.

**Every use that reaches a user** (evaluations, the questions derived from them, retrieval, checklists) reads active versions only, through one interface that returns nothing else. Version selection may read the identity of proposed versions (number, effective date, status, hash) to report `pending_activation`, never their content. Only the activation screen shows proposed versions.

### What agents may do

- Research agents and, later, the rule watcher propose versions as pull requests. They never activate one; activation needs the owner's passkey.
- An agent that finds a rule changed opens a pull request with the new version and the official source, and the owner activates it.

## Alternatives

| Option | Why not |
| --- | --- |
| Route versions as database rows with an in-app editor | An admin editor, review queue and migrations before the first rule exists; no diff review, no tests beside the data |
| Approval by the owner merging the pull request, or by an approving review | Agents act with the owner's token, so neither proves a person approved |
| A code-owner review rule on `packages/knowledge` | Same reason; ADR-0012 also dropped code-owner reviews |
| Signed commits from the owner's own key | Strong, but needs a computer with the key for every rule; the owner works mostly from a phone |
| Activating country sets separately from routes | Two approvals for one change in meaning; pinning sets inside the route version's hash covers both with one |
| Let the AI reviewers approve | Breaks domain rule 5 in CLAUDE.md: a person approves |

## Consequences

- Every rule has a reviewable history in Git, tests beside it, and a reproducible identity.
- The owner activates each rule once, in the app. The activation screen must make that quick and must show the real rule, not a model's description of it.
- Adding a route stays a data change: a new JSON file and its cases, no code. A route that the schema cannot express extends the schema generically, which is a code change in `packages/domain` with its own review.
- Residual risk, in line with ADR-0012: an agent holding the owner's GitHub token can merge a bad proposal, change the activation check, or add a key of its own and change the notice address in the allow-list, and, through a preview build that reads the owner database credentials, write activation rows and suppress the notice. That is the same exposure ADR-0012 accepts for any code change. What this design guarantees is narrower: an activation row written with database access alone, without a change to the reviewed allow-list, never counts, because it needs a pinned key's signature over that exact version; and the 48-hour notice protects against a key added in Git by someone without database access. Allow-list versions are immutable files, and a change to one notifies the addresses of the previous version too.

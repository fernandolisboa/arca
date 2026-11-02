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

- A file under `packages/knowledge/data` never changes once it is on `main`. CI fails a pull request that modifies, renames or deletes one.
- A rule change is a new version with a later effective date. A correction of a data error is a new version with the same effective date and a `corrects` field, which wins over the version it fixes.
- Each version is identified by its route ID and number, and by a SHA-256 content hash of the RFC 8785 canonical JSON of the version together with every country-set version it pins. Evaluations record both, plus the engine's commit, so an old evaluation can be reproduced exactly.

### Approval in two steps

1. **Proposal.** A change reaches `main` through a pull request like any other, reviewed by the gate. Merged versions are *proposed*: they exist in the catalog but the engine does not evaluate them for any case. If a proposed version is the one in effect, evaluations say `pending_activation` rather than fall back to an older version.
2. **Activation.** The owner activates a proposed version in the app. The activation stores the passkey assertion, the approver and the time, and binds them to the version's ID and content hash, so it also covers the country sets the version pins.

Activation rules:

- **Who:** approvers come from an explicit allow-list kept in the repository, not the database, and reviewed like code; it starts with the owner alone. Being in a case grants nothing.
- **Challenge:** issued by the server, random, single use, and naming the version ID and content hash.
- **Verification:** the API checks the relying-party ID, the origin, the user-presence and user-verification flags, and the signature against the approver's registered credential, every time it loads activations. It fails closed: any error means not active. An activation signed with a revoked credential stops counting.
- **Matching:** the domain package only matches activations to versions by ID and hash; it never verifies signatures.
- **Detection:** the first time the production API, which runs code from `main`, sees an activation, it notifies the owner by email and on every registered device, naming the version and the date the signing credential was created.
- **What the owner sees:** the activation screen renders each requirement, dependent rule, cost and duration deterministically from the expression tree, with no model in the path; shows the diff against the version it replaces; and shows each source's host. Free-text fields are escaped.

Activation is built in slice 3, together with the activation screen. Until then no version is active, which is safe because nothing reaches a user.

**Every use that reaches a user** (evaluations, the questions derived from them, retrieval, checklists) reads active versions only, through one interface that returns nothing else. Only the activation screen sees proposed versions.

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
- Residual risk, in line with ADR-0012: an agent with the owner's tokens can still merge a bad proposal or change the activation check through a pull request (a reviewed code change). With the owner database credentials that ADR-0012 leaves readable to preview builds, it could also insert a credential of its own and an activation signed with it, directly in SQL; that path skips the registration flow and its alerts, and the owner role can bypass the audit log's grants. The control for that path is the activation notice above, sent by production code from `main` to the owner's email and devices, which the database alone cannot suppress.

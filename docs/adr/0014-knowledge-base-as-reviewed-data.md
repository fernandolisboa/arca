# ADR-0014: The knowledge base as reviewed data in the repository, activated by the owner's passkey

- Status: Accepted
- Date: 2026-11-02
- Amends: [ADR-0002](0002-rules-as-versioned-data.md) (where route versions live, how approval is recorded); [ARCHITECTURE.md](../ARCHITECTURE.md) (code layout, rules flow)

## Context

[ADR-0002](0002-rules-as-versioned-data.md) makes rules versioned data evaluated by a pure function, with human approval before the engine sees a change. It does not say where the versions live, how they are tested, or how approval is recorded. Facts that shape the answer:

- The knowledge base holds public rules only: routes, requirements, fees, durations and their sources. It never holds case data ([SECURITY.md](../SECURITY.md), cross-case leakage). The repository is public, which is fine for public rules.
- CLAUDE.md requires table-driven tests for every rule version. Tests live in the repository, next to code.
- Agents act with the owner's GitHub token ([ADR-0012](0012-automation-first-setup.md)). A merged pull request, an approving review or a label from the owner's account is therefore no proof that a person approved anything: an agent can produce each of them.
- Passkeys (ADR-0006) are bound to a device and need the person's gesture. An agent cannot produce a passkey assertion.
- Nothing shows an evaluation to a user until the intake slice, which comes after authentication.
- A poisoned or wrong rule harms every family that relies on it ([SECURITY.md](../SECURITY.md), assets).

## Decision

### Where the base lives

- Route versions, country sets (for example, the E-2 treaty countries) and the country list are JSON files in `packages/knowledge`, one file per version, validated by the rule schema in `packages/domain` ([spec 0002](../specs/0002-rules-engine-and-knowledge-base.md)).
- Each version ships with its table-driven cases in a sibling file. CI rejects a version whose cases do not exercise every requirement both ways.
- The API bundles the validated catalog at build time. The database gets knowledge tables only when retrieval (pgvector) or approvals need them.

### Immutability

- A version file never changes once it is on `main`. CI fails a pull request that modifies, renames or deletes one. A correction is a new version with its own effective date.
- Each version is identified by its route ID and number, and by a SHA-256 content hash of its canonical JSON (RFC 8785). Evaluations record both, plus the engine's commit, so an old evaluation can be reproduced exactly.

### Approval in two steps

1. **Proposal.** A change reaches `main` through a pull request like any other, reviewed by the gate. Merged versions are *proposed*: they exist in the catalog but the engine does not evaluate them for any case.
2. **Activation.** The owner approves a proposed version in the app with a passkey assertion whose challenge is bound to the version ID and its content hash (step-up, ADR-0006). The approval stores that assertion, the approver and the time, and the API verifies the assertion against the approver's registered credential before it evaluates the version. A version whose bundled hash differs from the approved one is not active.

Activation is built in the first slice that shows an evaluation to a user, together with the approval screen. Until then no version is active, which is safe because nothing reads evaluations.

### What agents may do

- Research agents and, later, the rule watcher propose versions as pull requests. They never activate one; activation needs the owner's passkey, which they do not have.
- An agent that finds a rule changed opens a pull request with the new version and the official source, and the owner activates it.

## Alternatives

| Option | Why not |
| --- | --- |
| Route versions as database rows with an in-app editor | An admin editor, review queue and migrations before the first rule exists; no diff review, no tests beside the data |
| Approval by the owner merging the pull request, or by an approving review | Agents act with the owner's token, so neither proves a person approved |
| A code-owner review rule on `packages/knowledge` | Same reason; ADR-0012 also dropped code-owner reviews |
| Signed commits from the owner's own key | Strong, but needs a computer with the key for every rule; the owner works mostly from a phone |
| Let the AI reviewers approve | Breaks domain rule 5 in CLAUDE.md: a person approves |

## Consequences

- Every rule has a reviewable history in Git, tests beside it, and a reproducible identity.
- The owner approves each rule once, in the app. The approval screen must make that quick: a plain summary of each requirement with its official source.
- Adding a route stays a data change: a new JSON file and its cases, no code. A route that the schema cannot express extends the schema generically, which is a code change in `packages/domain` with its own review.
- Residual risk, in line with ADR-0012: an agent with the owner's tokens can still merge a bad proposal, change the activation check through a pull request, or, with owner access to the database, register a credential of its own and sign an approval with it. An approval cannot be forged with the owner's existing passkeys, a changed check is a reviewed code change, and a new credential triggers the new-device alerts of ADR-0006 and an audit entry.

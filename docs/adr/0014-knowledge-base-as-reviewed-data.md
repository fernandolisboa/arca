# ADR-0014: The knowledge base as reviewed data in the repository, activated by a person's passkey

- Status: Accepted
- Date: 2026-11-02
- Amends: [ADR-0002](0002-rules-as-versioned-data.md) (where route versions live, the shape of their sources, the country dataset, how approval is recorded); [ADR-0010](0010-stack-revised.md) (fast-check for property tests); [ARCHITECTURE.md](../ARCHITECTURE.md) (code layout, rules flow, entities); CLAUDE.md domain rule 5 (what "sees the change" means)

## Context

[ADR-0002](0002-rules-as-versioned-data.md) makes rules versioned data evaluated by a pure function, with human approval before the engine sees a change. It does not say where the versions live, how they are tested, or how approval is recorded. Facts that shape the answer:

- The knowledge base holds public rules only: routes, requirements, fees, durations, country sets and their sources. It never holds case data ([SECURITY.md](../SECURITY.md), cross-case leakage). The repository is public, which is fine for public rules.
- CLAUDE.md requires table-driven tests for every rule version. Tests live in the repository, next to code.
- Agents act with the owner's GitHub token ([ADR-0012](0012-automation-first-setup.md)). A merged pull request, an approving review or a label from the owner's account is therefore no proof that a person approved anything: an agent can produce each of them.
- A passkey assertion needs a person's gesture on an authenticator, which an agent holding a GitHub token cannot produce.
- Nothing reaches a user from the knowledge base until slice 3 of the consultancy core (case model and intake), which comes after authentication and step-up ([spec 0002](../specs/0002-rules-engine-and-knowledge-base.md#the-epic-consultancy-core)).
- A poisoned or wrong rule harms every family that relies on it ([SECURITY.md](../SECURITY.md), assets).

## Decision

### Where the base lives

- Route versions, country sets (for example, the E-2 treaty countries), the official-domain lists and the country lists are JSON files in `packages/knowledge/data`, one file per version, validated by the rule schema in `packages/domain` ([spec 0002](../specs/0002-rules-engine-and-knowledge-base.md)).
- Each route version ships with its table-driven cases in a sibling cases file. CI rejects a version whose cases do not exercise every requirement every way.
- Sources are a list per version, each with an ID, URL, title, kind (`official` or `secondary`) and `verifiedAt`; an `official` source's host must be on an official-domain list the version pins (spec 0002, R4 and R6). This replaces ADR-0002's single source URL.
- Country codes come from a pinned Unicode CLDR release, plus a reviewed list of former states with ISO 3166-3 codes (spec 0002, R7). This is ADR-0002's ISO 3166 dataset.
- The API bundles the validated catalog at build time. The database gets knowledge tables only when decisions (slice 3) or retrieval (slice 6) need them.
- Whether documents, steps, fees and action points (`knowledge_item`, `action_point`) also become files is decided by slice 5.

### Immutability

- A file under `packages/knowledge/data` or `packages/knowledge/vendor` never changes once it is on `main`. A required check fails a pull request that modifies, renames or deletes one. The check runs from `main` and reads the pull request's files as data, so a pull request cannot weaken the check that judges it (spec 0002, R6). Cases files and `hashes.json` are append-only instead: they may gain entries, never change or lose them.
- A rule change is a new version with a later effective date. A correction of a data error is a new version with a `corrects` field naming an earlier version; once the correction is in effect, the version it fixes is no longer selected (spec 0002, R5). Re-verifying a source is a new version too, so every date a user sees has been through the same approval.
- Each version is identified by its route ID and number, and by a content hash over the version and every file it pins, transitively (spec 0002, R6). Evaluations record both, plus the engine's commit, so an old evaluation can be reproduced exactly.

### Approval in two steps

1. **Proposal.** A change reaches `main` through a pull request like any other, reviewed by the gate. Merged versions are *proposed*: they exist in the catalog, but the engine does not evaluate them for any case.
2. **Decision.** An approver either *activates* or *rejects* a version in the app, with a passkey step-up bound to its content hash.
   - Only an active version is evaluated.
   - A rejected version leaves version selection as if it did not exist, and the route falls back to the version before it. It can never be activated again; a fix is a new version. Rejection works on a proposed version, which is how a bad proposal stops blocking a route, and on an active one, which takes a rule out of use. A rejection wins over an activation of the same version.

This is what CLAUDE.md rule 5 means by the engine seeing a change. The engine contract that enforces it, including the identity fields selection may read and the `pending_activation` status, is spec 0002 R5; this ADR does not repeat it.

Until decisions exist (slice 3), no version is active. That is safe, because nothing reaches a user before then.

### Decisions: required properties

The decision ceremony, the approver list and its lifecycle, notices and storage are designed in the slice 3 spec and a later ADR, after the foundations' step-up ADR is accepted. That design must give these properties, and its reviewers check it against them:

- **A person decides.** A decision is a fresh passkey step-up by a listed approver, bound to the purpose and the exact content hash, on the production deployment only. Being in a case grants nothing.
- **Database access alone decides nothing.** Approvers and their public keys come from a reviewed, immutable list in the repository, never from the database, and every stored decision is re-verified against those keys before it counts.
- **Git access alone decides nothing.** A change to the approver list takes effect only through a decision by a credential already in effect, and a new credential proves possession of its key before it counts.
- **A stop is always possible.** Every decision reaches every approver through a channel independent of the account that syncs the approver's passkeys, and counts only after a delay during which any approver can veto it from the app. A veto is final.
- **No home-made cryptography.** Assertions are verified by a maintained WebAuthn library; there is no parsing or signature code of our own.
- **The engine sees states, not decisions.** The decision states (active, rejected or proposed) are computed by a pure, table-tested function in `packages/domain`, in a module separate from the rules engine, from decisions the API has verified. The engine receives only the resulting state per version.
- **Outside production**, fixture decisions for fixture routes come from a test file that the production build does not bundle, and the production verifier rejects them.
- **What the owner sees.** The activation screen shows the rule as data, rendered deterministically: its expression tree, its pinned country sets with their members, the diff against the version it replaces, each source's host with new hosts flagged, and its rule cases. No model is in the path.

### Research agents: required properties

The research agent and its tools are specified with slice 2. That design must give these properties:

- **Narrow tools.** No shell, no generic GitHub tools, no tool or port that reads case data. A research task carries only public terms and identifiers (country, route ID, requirement key), never snapshot facts, intake text or person IDs.
- **Fetching.** One fetch tool: GET over `https` only, no credentials or cookies, size and count limits per task. It resolves each host before connecting and refuses loopback, private, link-local, unique-local and cloud metadata addresses and names that are not public DNS names; it connects to the address it checked, so a DNS change cannot redirect it, and follows a small number of redirects, each checked the same way. Responses come back only inside a delimited data block, with links and remote images stripped, and every fetched host is logged with the proposal.
- **Proposing.** One proposal tool behind a port, `KnowledgeProposalSink`, with a GitHub adapter and a fake for tests. It writes only new route-version and country-set files and their cases files, for the IDs the task names, and builds the pull request's title and body from the structured proposal, with no model-written text. It cannot merge and cannot touch official-domain lists, the approver list, workflows or code.
- **Its own credential.** The adapter authenticates with a dedicated GitHub App installation or a fine-grained token limited to this repository (contents and pull requests only), stored Production-only and rate-limited per task, never the owner's token. Slice 2 says where the agent runs and adds the GitHub row of the data-flow register for what the runtime sends.
- **Never deciding.** Agents never decide on a version; that needs an approver's passkey.
- **Adversarial cases** in the evaluation suite, each expected to produce only a correctly structured proposal or a refusal: a page with injected instructions; a lookalike official host; an attempt to touch the approver list, an official-domain list or a path outside knowledge data; a page targeting a different route; a page asking the agent to fetch a URL that carries task content; a page pointing the agent at an internal or private address.

### Trust roots in their own pull requests

Official-domain lists decide what counts as official. The `knowledge-immutable` check fails a pull request that changes them together with any other knowledge data, except an append to `hashes.json` (spec 0002, R6). A host added to a list cites proof on a host already in a merged list version, or on a registry such as a country's domain authority; the first list for an issuer gets its own reviewed pull request. The approver list gets the same rule when slice 3 adds it.

## Alternatives

| Option | Why not |
| --- | --- |
| Route versions as database rows with an in-app editor | An admin editor, review queue and migrations before the first rule exists; no diff review, no tests beside the data |
| Approval by the owner merging the pull request, or by an approving review | Agents act with the owner's token, so neither proves a person approved |
| A code-owner review rule on `packages/knowledge` | Same reason; ADR-0012 also dropped code-owner reviews |
| Signed commits from the owner's own key | Strong, but needs a computer with the key for every rule; the owner works mostly from a phone |
| Verifying decisions against Better Auth's credential table | Anyone with database access could insert a credential; keys pinned in a reviewed file need a reviewed change |
| A source re-verification log outside the content hash | Cheaper to keep fresh, but a merged log entry would change the date users see with no approval |
| Proposed versions expiring after a number of days instead of rejection | Silent, and a bad proposal would still block the route until then |
| Activating country sets separately from routes | Two approvals for one change in meaning; pinning sets inside the route version's hash covers both with one |
| Designing the full decision ceremony now | Nothing uses it before slice 3, and it builds on the foundations' step-up design, which is still being written; the properties above bind it instead |
| Let the AI reviewers approve | Breaks domain rule 5 in CLAUDE.md: a person approves |

## Consequences

- Every rule has a reviewable history in Git, tests beside it, and a reproducible identity.
- The owner activates or rejects each rule once, in the app. The activation screen must make that quick and must show the real rule and its cases, not a model's description of it.
- Keeping sources fresh costs one activation per re-verified version; the diff shows only the changed dates, so the check is quick. Until it is activated, the route reads `pending_activation`, which is the conservative answer. Slice 3 may add a lighter path for an unchanged source if it keeps every date a user sees approved by a person.
- Adding a route stays a data change: a new JSON file and its cases, no code. A route that the schema cannot express extends the schema generically, which is a code change in `packages/domain` with its own review.
- Slice 1 can be built and tested with fixture states and no decisions at all.
- **Residual risk**, in line with ADR-0012: an agent holding the owner's GitHub token can merge a bad proposal or change code, including the future decision code. Merged versions stay proposed, so a bad proposal still needs a person's passkey before it reaches anyone.

# ADR-0022: Single-approver activation through a purpose-bound step-up

- Status: Accepted
- Date: 2026-11-05
- Amends: [ADR-0014](0014-knowledge-base-as-reviewed-data.md), replacing its section "Decisions: required properties"; [ADR-0015](0015-identity-enrollment-step-up-and-recovery.md) (a new step-up purpose)

## Context

ADR-0014 makes merged route versions *proposed* until a person activates them with a passkey, and set a floor of properties for the decision ceremony that slice 3 would design: approver keys pinned in the repository, a hardware security key per approver with attestation, a hash-chained decision log mirrored to an anchor the database owner cannot rewrite, notice and veto windows, an approver-list bootstrap ceremony and a delayed recovery path.

Facts that change the cost and value of that floor:

- Arca is one family's app, and the owner is the only approver (decided 2026-11-03).
- On 2026-11-05 the owner rejected owner ceremonies (drills, tabletops, manual checks) as over-engineering for this app. The floor needs several: buying and registering a security key, a bootstrap from production, acting within veto windows.
- ADR-0014 itself names the open path: anyone who can merge and deploy code on the evaluation or decision path bypasses every passkey check, because the checks run in that code. Agents hold that ability by design (ADR-0012). The anchor, the chain and the hardware tier defend the database against tampering while the code path stays open.
- The foundations already built a purpose-bound step-up (spec 0003 R5): a fresh, user-verified passkey assertion bound to an action, its targets and its security-relevant fields, stored with the assertion and re-verifiable.

## Decision

- **A decision is a step-up.** Activating or rejecting a version is a step-up of the new purpose `knowledge_decision`, bound to the action (`activateVersion` or `rejectVersion`), the route ID and version number as targets, and the content hash as a field. The step-up's own guarantees apply: user verification, the environment's relying party and origin, single use, a short expiry, the same session.
- **Approvers are listed in the repository** by account ID, per environment. Production lists the owner's account. A pull request changes the list, reviewed like any change.
- **The client computes the content hash** from the files it renders, with the shared canonicalizer and WebCrypto, and never takes the hash from the server. The server recomputes it from the bundled catalog and refuses a mismatch. No model is in the path that renders the rule, its sources or its cases.
- **Decisions are insert-only** rows that reference the step-up they consumed. Before a decision counts, the API checks the approver list and re-verifies the stored assertion.
- **States are pure.** A function in `packages/domain`, separate from the rules engine, computes active, rejected or proposed per version identity; a rejection wins and takes effect at once, and a rejected version is never activated again. The engine sees only the states (ADR-0014 and spec 0002 R5 unchanged).
- **No veto windows, notices, hardware keys, anchor, decision chain, approver-list ceremony or recovery path.** An activation counts when it is stored. A wrong activation is undone by rejecting the version, which also takes effect at once, followed by a correction version.
- The independent check stays advisory, as ADR-0014 says; until it exists the activation screen says so.

## Alternatives

| Option | Why not |
| --- | --- |
| ADR-0014's floor as written | Many tickets and recurring owner ceremonies to defend the database, while the code-deploy path that bypasses it stays open by design |
| Pin the owner's passkey public key in the repository and verify against it | Protects against a forged credential row, but needs the key exported from production into a pull request, an owner step on every new passkey, for the same residual the open code path leaves |
| No activation at all; merged versions count | Breaks CLAUDE.md rule 5: a person approves each change with a passkey |

## Consequences

- One tap and a passkey prompt per version, from the phone. Slice 3 ships the screen and the decision with no owner setup.
- **Residual risk, accepted:** whoever holds the database owner credentials (residual R-2 in the threat model) can insert a credential and a decision whose assertion verifies against it, activating a version without the owner. Whoever can merge and deploy code can do the same and more (ADR-0012, ADR-0014). Both already reach every family's data, so this adds no new class of attacker. A merged bad rule still needs either the owner's passkey or one of those two attacks before it reaches anyone.
- Glossary terms that described the dropped ceremony (veto, notice, offline credential, recovery path) are retired; Activation and Approver change meaning.
- ADR-0014's other sections stand: where the base lives, immutability, proposal then decision, research agents, the independent check, reporting a wrong rule and trust roots.

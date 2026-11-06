# ADR-0024: Build with the mattpocock-skills flow

- Status: Accepted
- Date: 2026-11-06
- Amends: [ADR-0019](0019-reviewers-in-the-authoring-session.md) (which reviewers the authoring session runs)

## Context

The owner installed Matt Pocock's skills (the `mattpocock-skills` plugin) and asked the project to follow their flow, which he used before, instead of the process the agents had grown: specs as long files reviewed over many rounds, tickets cut by hand, and nine reviewer subagents on every change. The plugin covers the same ground (grilling, spec, tickets, TDD, review) with less ceremony.

## Decision

- New work runs `grill-with-docs`, then `to-spec` and `to-tickets` for a multi-session build, then `implement` per ticket in a fresh session (`tdd` at the spec's seams, then `code-review`). The details and Arca's adaptations live in [CLAUDE.md](../../CLAUDE.md#how-we-build).
- Specs are GitHub issues from now on; tickets are their sub-issues, with blockers and triage labels ([docs/agents/](../agents/)). The specs already in `docs/specs/` stay as the reference for the features they cover and are not rewritten.
- The glossary moves from `docs/GLOSSARY.md` to `CONTEXT.md` at the root, where the skills look for it, and keeps its table with the pt-BR labels.
- Review is `code-review` (Standards and Spec axes) on every change, plus one security reviewer on changes to auth, cryptography, storage, case data, the database, dependencies, CI, vendors or AI. The security reviewer absorbs the checklists of the four specialists; the correctness, architecture, standards and context reviewers are removed, their checks covered by tests, the Standards axis against CLAUDE.md and the ADRs, and the Spec axis.
- CLAUDE.md's domain, privacy and security rules outrank any skill.

## Consequences

- Two or three review sub-agents per change instead of five to nine.
- A sensitive change gets one dedicated security read instead of two. Accepted: the app serves one family, and tests, the access-matrix suite and the deterministic CI checks still guard the riskiest paths.
- Specs as issues are not versioned with the code; a spec that a later change contradicts is updated on its issue, not in a pull request.

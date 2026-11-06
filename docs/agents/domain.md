# Domain docs

How the engineering skills read this repo's domain documentation. Single context: one `CONTEXT.md` at the root and `docs/adr/`.

## Before exploring, read these

- **`CONTEXT.md`**: the glossary. Every domain term has one English name and one pt-BR UI label. Use them in issue titles, test names, identifiers and proposals; never invent a synonym.
- **`docs/adr/`**: the ADRs that touch the area you are about to work in.
- **`CLAUDE.md`**: the non-negotiable domain, privacy and platform rules. They outrank any skill.
- **`docs/specs/`**: the specs written before 2026-11-06, still the reference for the features they cover. New specs are GitHub issues.

## Glossary format

`CONTEXT.md` is a table (term, pt-BR label, meaning), not the list format of the `domain-modeling` skill. Add new terms as rows in that table.

## ADRs

Offer an ADR only when the decision is hard to reverse, surprising without context and the result of a real trade-off (the `domain-modeling` rule). Use the existing ADR layout: number, title, status, date, then context, decision and consequences, kept short.

## Flag ADR conflicts

If your output contradicts an existing ADR, say so explicitly instead of silently overriding it:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_

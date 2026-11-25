# ADR-0037: Route version titles in the screen's language, as reviewed data beside the versions

- Status: Accepted
- Date: 2026-11-25

## Context

The results screen showed every route version's title, requirement, assessment, cost and duration in English, as the versions write them. The family reads Portuguese; some members read no English. Route versions are immutable and hashed, and an activation is bound to the content hash ([ADR-0014](0014-knowledge-base-as-reviewed-data.md)), so adding a Portuguese field to a version would mean a new version of every route and a new activation of each. The owner's API credit is nearly spent, so the texts cannot come from a model call at run time.

## Decision

- **A reviewed data file per route.** `packages/knowledge/rule-texts/pt-BR/<route-id>.json` pairs each English title a version writes (`en`, exactly as written) with its translation (`text`, up to 400 characters). A Claude Code session writes them, with no call to the app's model providers; a reviewed pull request changes them, with the repository's reviewers and no activation, as for suggested ratings ([ADR-0035](0035-suggested-ratings.md)). The build validates each file and ships it in the API's runtime module with each English title replaced by its SHA-256, so the server bundle holds no route version's own text ([ADR-0031](0031-rule-updates-on-request.md)). The Portuguese it does ship is display text only: never evaluated, and shown only where it matches the English of an active version.
- **Document notes too ([#519](https://github.com/fernandolisboa/arca/issues/519)).** A document item's title and its note, capped at 200 characters like titles, are rule texts on the same terms.
- **Keyed by the English text, not by item ID.** A version that rewords a title gets no translation until the file catches up, so a stale translation can never show for a changed rule; the title shows in English meanwhile.
- **The API translates.** `GET /case/evaluations` gives each title in Portuguese where the route's file has it, with the version's English in `original`; with no translation, `original` is null. The engine, the version, its hash and every evaluation stay as they are. Only titles of active versions reach the screen, as before (CLAUDE.md rule 5).
- **Rule 1 holds.** Every number a translation shows is the version's own, kept by the numbers test and the hash key, and each item's sources and verification dates still come from the version.
- **Tests.** `packages/knowledge/test/rule-texts.test.ts` fails when a title of a version in effect today or later has no translation, when an entry translates a title no version of its route writes, and when a translation drops a number its English states or adds one it does not (amounts, ages, dates, article numbers).
- **Screen.** The titles show in Portuguese with "Textos traduzidos pelo Arca. Na dúvida, vale a fonte oficial." and a switch that shows each English original under it. Sources stay as they are.
- **Totals.** The API also returns the engine's cost totals per currency, which it already computed in code (CLAUDE.md rule 3): what certainly applies and what may on top. Durations are not summed: the schema does not tell a waiting time from a validity period, and their sum would mislead.

## Consequences

- A new route version from a session review gets its titles in the same pull request (the runbook says so). One from an update request lives only in the database, so its titles show in English until a session review brings that route into the repository.
- A wrong translation misleads without changing any result; the numbers test, the reviewers and the English one switch away limit that, but a dropped qualifier or a flipped comparison passes the test and rests on the reviewers. Eligibility stays with the engine.
- A second locale is another folder under `rule-texts/` and a locale choice in the API.

## Alternatives considered

| Option | Why not |
| --- | --- |
| A Portuguese field in each route version | A new version and an activation of every route, and the next version has to carry it too |
| Translate with a model when the screen opens | A model call per view, on credit that is nearly spent, and not reproducible |
| Key translations by item ID | A reworded item would keep the old meaning in Portuguese |

# ADR-0026: Destination comparison data and scoring

- Status: Accepted
- Date: 2026-11-07
- Spec: [#310](https://github.com/fernandolisboa/arca/issues/310) (consultancy core slice 4, the destination comparison)
- Builds on: [ADR-0014](0014-knowledge-base-as-reviewed-data.md), [ADR-0002](0002-rules-as-versioned-data.md)
- Amends: [ADR-0022](0022-single-approver-activation.md) (decisions gain a subject kind)

## Context

Each adult ranks the countries that have a route by criteria they weigh themselves. Spec 0002 already fixed that objective scores come from sourced knowledge data, reviewed and activated like route versions, that subjective scores come from each person's own ratings, that weights and ratings are private case data never sent to a model, and that every score is computed in code. What stays open is how that data is shaped and activated, how a value becomes a score, what an unknown does to a total, and how preferences are stored. The owner is the only approver and wants no chores: whatever is reviewed should cost few passkey approvals.

## Decision

- **Country indicators.** A new versioned, immutable knowledge file holds one measured fact for many countries (for example, intentional homicides per 100,000 people): a value type (`decimal` or `token`), sources on pinned official-domain lists, and per country a value as a decimal string or token, its reference year and the source it comes from. A country without a value is unknown.
- **One activated comparison version.** The criteria live in a comparison version file that pins every indicator version it reads. Its content hash covers the version and every pinned file, as for a route version, so **one activation covers a whole data refresh**; an indicator's own hash is recorded for review but never activated alone. The catalog holds exactly one comparison series, which the build enforces. The comparison uses the highest-numbered active version; a higher-numbered proposed one is reported as pending (its identity read, never its content), and a rejected one is skipped. There are no effective dates: comparison data describes the present, not a law in force from a date.
- **Kinds are code, criteria are data.** A criterion has a stable ID, a default weight from 0 to 5 and one kind: `indicator` (a decimal indicator scored linearly between the value that scores 0 and the value that scores 10, clamped, so the two anchors also say which direction is better), `category` (a score per token of a token indicator, every token scored) or `personal` (the person's own rating). Adding a criterion or refreshing values is a data change; a new kind is a reviewed code change made generically.
- **Fixed anchors.** Scores do not depend on which other countries are shown: hiding a country never moves another one's score.
- **Unknowns stay out of the total.** A country without a value shows "sem dado" on that criterion and opens no research task for now: refreshing comparison data is a maintainer's script run, not a per-country question. The total is the weighted mean of the known scores, and the screen shows the coverage, the share of the person's weight those scores carry. Countries with less than half of the weight known are listed apart as "Poucos dados", without a rank. Ties break by coverage, then country code.
- **Exact arithmetic.** Scores, totals and coverage are exact ratios of `bigint`s; only what is shown is rounded, half-even, to one decimal place (a percentage for the coverage).
- **Preferences are one JSON row per case member**, validated by a domain schema (weights 0 to 5, ratings 1 to 5 stars, up to 30 criteria the person names, hidden countries), under forced row-level security for its account only. Entries for a criterion a later version dropped are kept and ignored. The names a person gives their own criteria are the only new free text; they are case data, never logged and never sent to a model.
- **Decisions gain a subject kind** (`route` or `comparison`), so a decision on one kind never counts for the other; a comparison version's key in the decision states has a shape no route key can take. The kind is bound into the step-up the passkey signs (ADR-0022's purpose-bound subject) and stored on the decision row with a database check per kind, so an approval of one kind can never be replayed as the other.

## Alternatives

- **One activation per indicator file, or per country profile.** Finer-grained review, but a yearly refresh of three indicators for twenty countries would cost three to twenty approvals instead of one. Rejected for the owner's time; the view still shows each indicator's values and what changed.
- **Min-max normalization over the countries shown.** Needs no anchors, but a score would change when the person hides a country or the catalog gains one, which reads as arbitrary. Rejected.
- **Intervals for unknowns** (an unknown score ranging over 0 to 10, as the engine's three-valued logic does). Principled, but a ranking of overlapping intervals is hard to read on a phone. The coverage figure and the "Poucos dados" group say the same thing more plainly.
- **Normalized preference tables** (one row per weight, rating and criterion). More rows, policies and export code for data only its own account ever reads as a whole. Rejected (KISS); the domain schema keeps the JSON's shape and limits.
- **A separate direction field on indicator criteria.** Redundant with the anchors' order, and a second place to get wrong. Rejected.

## Consequences

- Refreshing comparison data is a script run plus a reviewed pull request with new indicator files and a new comparison version, then one activation.
- A new country in the route catalog shows "sem dado" on objective criteria until the next comparison version adds its values.
- Criterion kinds that read case facts (such as language from the person's CEFR levels) need a schema change and a scoring change in code, reviewed like any engine change.

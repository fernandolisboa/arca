# ADR-0039: Document guides, from reviewed official sources in the repository

- Status: Accepted
- Date: 2026-11-25

## Context

The document checklist ([#519](https://github.com/fernandolisboa/arca/issues/519)) shows, for each document a route asks for, where to get it in the country that issues it: the office, how to ask, cost, lead time, the online link and how its apostille is obtained. The spec first put these guides in insert-only `knowledge` rows, activated like session reviews. [Its amendment](https://github.com/fernandolisboa/arca/issues/519#issuecomment-7154282795) of 2026-11-25 moved them to the pattern of [ADR-0038](0038-departure-checklists.md) instead: a guide is a fact about the issuing country, not a rule of a destination route, so the rule schema and activation add process for no gain. CLAUDE.md rule 1 still holds: every cost and lead time shown comes with its official source and the date it was read. No model call is wanted.

## Decision

Apply ADR-0038's approach to document guides. ADR-0038's decision does not change; it only links here.

- **A reviewed data file.** `packages/knowledge/document-guides/<n>.json` holds one guide per issuing country (Brazil first). Each entry is keyed by an open document kind, the same tag route versions' document items carry (`birth_certificate`), and gives the online link when there is one, the cost as a range of whole minor units in the guide's currency, the lead time as a duration range in one unit, marked when the source counts business days, and the sources it rests on, from the file's source list, each with its address, title and verification date. The build validates the highest-numbered file against `documentGuidesSchema` and ships it in the API's runtime module. A new file is a reviewed pull request, with no activation, no update request and no model call. The catalog stays open: a country gets a guide by data, and nothing in code names one or a kind.
- **Only what a source states.** Cost, lead time and the online link are left out when the cited sources do not state them, as a document item's apostille and validity are; the screen then says Arca does not know, never "free" or "immediate".
- **Official sources only.** The file lists its allowed domains. The schema refuses a domain that is a commercial or generic suffix such as `com.br`, a source that is not `https`, not marked official or on another host, an online link on another host, a source no entry cites, an entry with no source, and two entries for one kind in a guide. The build refuses a verification date after the day it runs. The checks are the ones the departure checklists run, shared in code.
- **Wording in the catalog.** The office or channel, how to ask and how the apostille is obtained live in the pt-BR catalog's own file, `pt-BR-document-guides.ts`, under `documentGuide.<country>.<kind>`. Those texts carry costs and deadlines too, so the data file pins a SHA-256 of them (`wordingSha256`). An API test fails when the hash differs, when the file lists an entry the catalog does not word, or when the catalog words one the file does not list.
- **The lookup.** `guideEntriesFor` takes the country codes of a person's citizenships and a document kind, and returns the entry of each issuing country whose citizenship the person holds, or none. A route version never pins a guide; the checklist reads the guide file in use.
- **Research.** Guide content comes from the country research threads that add each route's documents (#524 to #527), in the session review's pull request, following the documents section of [the runbook](../runbooks/session-rule-review.md#documents). Guide entries have no evidence file and the `review-quotes` job does not read them: the pull request quotes the official passage behind each cost, lead time, link and text, and the review's adversarial rounds check them.

## Consequences

- The checklist can say where to get a document in Brazil, with the official page behind it, at no model cost, and a birth certificate is researched once for every route that asks for one.
- Until a guide file is merged, the repository has none, the catalog words nothing, and every entry shows as not known.
- Costs and lead times change; refreshing them is another reviewed pull request, and the screen tells the reader to open the source before acting.
- A merged file changes what every account sees with no activation. A wrong or tampered file is held back only by the reviewers and the schema's domain check, and the file names its own domains and the guide's currency, so the reviewers are the real gate; it never decides eligibility.
- Guides for other issuing countries need only data. Update requests in the app do not cover guides.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Insert-only `knowledge` rows activated like session reviews (the spec's first design) | Guides are not rules of a route; rows, migrations and activation add process for data that decides nothing |
| Put the guide inside each route version | The same document would be researched again for every route and country |
| Write the texts in the data file | Strings outside i18n, and one more place for Portuguese to drift from the catalog's voice |

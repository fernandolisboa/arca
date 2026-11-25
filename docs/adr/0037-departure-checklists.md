# ADR-0037: Departure checklists, from reviewed official sources in the repository

- Status: Accepted
- Date: 2026-11-25

## Context

On 2026-11-25 the owner approved the family-fit priorities, whose sixth item is a sourced checklist for leaving Brazil (the Receita Federal's exit notice and exit return, the Banco Central's foreign assets declaration, social security abroad, the voter registration, the children's travel authorization, a power of attorney) and a source-of-funds trail for a property sale, the documents that show where invested money came from for a visa such as the U.S. EB-5. Tax planning is out of scope. These are obligations of the country being left, not rules of a destination route, so the rule schema and its activation do not fit them; but CLAUDE.md rule 1 still holds: every deadline or threshold shown comes with its official source and the date it was read. No model call is wanted: the owner's API credit is nearly spent.

## Decision

- **A reviewed data file.** `packages/knowledge/departure-checklists/<n>.json` holds, per country being left, its sections and items; each item lists the sources it rests on, from the file's source list, each with its address, title and verification date. The build validates the highest-numbered file against `departureChecklistsSchema` and ships it in the API's runtime module. A new file is a reviewed pull request, with the repository's reviewers, and nothing else: no activation, no update request, no model. The catalog stays open: a country gets a checklist by data, and nothing in code names one.
- **Official sources only.** The file lists the domains its sources may sit on (`gov.br`, `jus.br`, and `uscis.gov` for the EB-5 trail); the schema refuses a source that is not `https`, not marked official, or on another host, and a source no item cites. The list is reviewed with the file; it is not a rule's official-domain list and decides nothing about routes.
- **Wording in the catalog.** Section and item IDs are data, unique across the file; their titles and texts live in the pt-BR catalog's own file, `pt-BR-departure.ts`, under `departure.section.<id>` and `departure.item.<id>`, so they read as natural Portuguese and a second locale can follow. Those texts carry deadlines and amounts too, so the data file pins a SHA-256 of them (`wordingSha256`): changing a text changes the dated file, and both paths call the same reviewers. An API test fails when the hash differs, when the file lists an item the catalog does not word, or when the catalog words one the file does not list. The build refuses a verification date after the day it runs.
- **API and screen.** `GET /v1/departure-checklists` answers the same public data to any signed-in account. "Saída do país" shows each country's sections side by side on a wide screen, each item with its sources' titles, links and dates. The list is read-only: it does not record what a person has done.

## Consequences

- The family sees what to do when leaving and which papers to keep, with the official page behind each line, at no model cost.
- The sources were read on 2026-11-25; deadlines and thresholds change (the exit return follows the yearly income tax deadline), so the screen tells the reader to open the source before acting, and refreshing the file is another reviewed pull request.
- A merged file changes what every account sees with no activation. A wrong or tampered file is held back only by the reviewers and the schema's domain check, and the file names its own domains, so the reviewers are the real gate; it never decides eligibility.
- The voter registration and the e-CAC power of attorney rest on consular pages and a Receita news item, since the TSE and the e-CAC service pages refused automated reading; a later file should cite the TSE and the Receita service pages.
- Marking items done per person, or linking an item to a vault document, would need case data and is left for later.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Model the obligations as route versions | They are not routes and have no eligibility to evaluate; the rule schema and activation would add process for no gain |
| Write the texts in the data file | Strings outside i18n, and one more place for Portuguese to drift from the catalog's voice |
| A model researches the list at run time | Costs a call per change, the credit is nearly spent, and the result would not be reviewed before people see it |

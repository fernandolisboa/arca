# pt-d8

Research notes for Portugal's D8 residence visa for remote work for employers or clients abroad, route `pt-d8` in `packages/knowledge/data/routes`. The seed research is in [portugal.md](../portugal.md#residence-visas); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-11

The first full audit by the runbook ([#356](https://github.com/fernandolisboa/arca/issues/356)), on demand, done together with [`pt-d7`](pt-d7.md). The two routes share every source but three; what they share is in [that record](pt-d7.md#2026-11-11), and this one holds what is D8's own.

- **Version audited:** 3
- **Outcome:** correction, version 4 (pull request [#377](https://github.com/fernandolisboa/arca/pull/377)), from version 3's own date, 2026-01-01, so it replaces version 3 entirely, and with it versions 1 and 2, which start on the same date. The pull request carries both routes.
- **Sources re-read** (all on 2026-11-11 UTC; pages of diariodarepublica.pt rendered with the session's Playwright and read from the saved text, gazette PDFs with `curl` and `pdftotext`):
  - `lei-23-2007-remote` (new): the consolidated Lei n.º 23/2007, article 61.º-B, read in full.
  - `dr-84-2007-income`, which was `dr-84-2007`, and `dr-84-2007-work-link` (new): the consolidated Decreto Regulamentar n.º 84/2007, article 31.º-A, read in full.
  - Shared with `pt-d7` and read as its record says: `lei-23-2007`, `lei-23-2007-partner`, `-entry-ban`, `-conviction`, `-visa-validity`, `-visa-decision`, `-permit`, `-fees` and `-scope`, `portaria-1563-2007`, `portaria-1563-2007-period`, `dl-139-2025`, `codigo-contributivo`, `dr-84-2007-family`, `dr-84-2007-means`, `lei-7-2001`, `portaria-91-2025`, `portaria-229-2021` and `codigo-civil`.
  - Not readable: none of the cited sources. Not re-read: none. Secondary sources: none added.
- **Amendments looked for:** as in the `pt-d7` record, up to Diário da República n.º 218/2026 of 2026-11-10. Articles 61.º-B of the law and 31.º-A of the regulation read as they were added in 2022. No decree sets the minimum wage for 2027 yet ([#220](https://github.com/fernandolisboa/arca/issues/220)).
- **Leads:** as in the `pt-d7` record: the EUR 970 expected for 2027 has no decree.
- **Findings:**
  - Confirmed, unchanged: average monthly income from work over the last three months of at least four minimum wages, which the regulation does not make net (Decreto Regulamentar n.º 84/2007, article 31.º-A, n.º 1, c); the household means scale, net; the spouse rule; the exclusion of EU, EEA and Swiss citizens; the leap-day convention. The `household-means` requirement now also cites article 24.º-B, n.º 1, b), of the regulation.
  - Missing, now an assessment `remote-work`: the work is done remotely for people or companies domiciled or seated outside Portugal, shown by a work contract or an employer's statement, or by a company contract, a services contract or proof of services provided (Lei n.º 23/2007, article 61.º-B; Decreto Regulamentar n.º 84/2007, article 31.º-A, n.º 1, a) and b)). The case records the income from work, not for whom the work is done.
  - Missing, now an assessment `means-for-12-months`: Portaria n.º 1563/2007, article 5.º, n.º 6, asks every residence visa applicant for means assured for at least 12 months, "without prejudice" to the paragraphs before it. The portaria is from 2007 and this visa from 2022: n.º 6 names its proofs only for retirees and for people living on income from assets, and n.º 1, on work as an employee or independent professional in Portugal, refers to the documents of other visas. The country guide reads n.º 6 as reaching every residence visa, and the assessment follows it and says in its title what the text leaves open.
  - The entry ban and conviction assessments, the partner, the adult children, the visa fee and the durations: as in the `pt-d7` record, with the same provisions.
  - Gaps kept, besides those of the `pt-d7` record:
    - The case records one monthly amount of income from work, not the average of the last three months that article 31.º-A, n.º 1, c), asks for; the requirement reads that amount.
    - The document attesting tax residence (article 31.º-A, n.º 1, d) belongs to the document checklist; the text does not say where the residence must be.
  - The cases file starts from version 3's cases: `extended-family-remote-income` became `extended-family-remote-income-between-the-bounds` and reads "missing information", one case pins the upper bound, and the partner and adult children cases are those of `pt-d7`.
- **Watch next:** as in the `pt-d7` record. The 2027 version is version 5, from 2027-01-01, and changes both the four minimum wages and the household means.

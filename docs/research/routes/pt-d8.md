# pt-d8

Research notes for Portugal's D8 residence visa for remote work for employers or clients abroad, route `pt-d8` in `packages/knowledge/data/routes`. The seed research is in [portugal.md](../portugal.md#residence-visas); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-11

The first full audit by the runbook ([#356](https://github.com/fernandolisboa/arca/issues/356)), on demand, done together with [`pt-d7`](pt-d7.md). The two routes share every source but two; what they share is in [that record](pt-d7.md#2026-11-11), and this one holds what is D8's own.

- **Version audited:** 3
- **Outcome:** correction, version 4 (pull request [#377](https://github.com/fernandolisboa/arca/pull/377)), from version 3's own date, 2026-01-01, so it replaces version 3 entirely. The pull request carries both routes.
- **Sources re-read** (all on 2026-11-11 UTC, as in the `pt-d7` record):
  - `lei-23-2007-remote` (new): the consolidated Lei n.º 23/2007, article 61.º-B, read in full.
  - `dr-84-2007`: the consolidated Decreto Regulamentar n.º 84/2007, article 31.º-A, read in full.
  - The sources shared with `pt-d7`, as listed there.
  - Not readable: none of the cited sources.
- **Amendments looked for:** as in the `pt-d7` record, up to Diário da República n.º 218/2026 of 2026-11-10. Articles 61.º-B of the law and 31.º-A of the regulation read as they were added in 2022. No decree sets the minimum wage for 2027 yet ([#220](https://github.com/fernandolisboa/arca/issues/220)).
- **Leads:** as in the `pt-d7` record: the EUR 970 expected for 2027 has no decree.
- **Findings:**
  - Confirmed, unchanged: average monthly income from work over the last three months of at least four minimum wages, which the regulation does not make net (Decreto Regulamentar n.º 84/2007, article 31.º-A, n.º 1, c); the household means scale, net; the spouse rule; the exclusion of EU, EEA and Swiss citizens; the leap-day convention. The `household-means` requirement now also cites article 24.º-B, n.º 1, b), of the regulation.
  - Missing, now an assessment `remote-work`: the work is done remotely for people or companies domiciled or seated outside Portugal, shown by a work contract or an employer's statement, or by a company contract, a services contract or proof of services provided (Lei n.º 23/2007, article 61.º-B; Decreto Regulamentar n.º 84/2007, article 31.º-A, n.º 1, a) and b)). The case records the income from work, not for whom the work is done.
  - Missing, now an assessment `tax-residence`: a document attesting the applicant's tax residence (article 31.º-A, n.º 1, d). The text does not say where the residence must be.
  - Not added: the 12 months of article 5.º, n.º 6, of Portaria n.º 1563/2007, whose two proofs are for retirees and for people living on income from property or investments; for the family members, article 24.º-B, n.º 1, b), asks for means for the stay asked for or 12 months, whichever is less.
  - The entry ban and criminal record assessments, the partner, the adult children, the visa fee and the durations: as in the `pt-d7` record, with the same provisions.
  - Gaps kept: as in the `pt-d7` record.
- **Watch next:** as in the `pt-d7` record. The 2027 version is version 5, from 2027-01-01, and changes both the four minimum wages and the household means.

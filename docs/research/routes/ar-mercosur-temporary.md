# ar-mercosur-temporary

Research notes for Argentina's temporary residence by nationality for natives of the Mercosur states, route `ar-mercosur-temporary` in `packages/knowledge/data/routes`. The seed research is in [other-destinations.md](../other-destinations.md#argentina); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-11

The first audit by the runbook ([#358](https://github.com/fernandolisboa/arca/issues/358)), on demand, together with the other three Mercosur routes.

- **Version audited:** 2
- **Outcome:** correction, version 3 (pull request PR_NUMBER), from version 2's own date, 2025-05-29, so it replaces version 2 entirely. Versions 1 and 2 start on that date and form one chain, so version 3 stands for both. Every provision version 3 cites read the same on 2025-05-29 as on the day of the audit, except the impediment of article 29, m), added from 2026-07-31, which no item cites. The fee decree is in force from 2024-07-06. The pull request carries the four Mercosur routes, against the runbook's one pull request per route, so that they are reviewed and merged together.
- **Sources re-read** (all on 2026-11-11 UTC with `curl`, read from the saved pages):
  - `ley-25871-nationality`, `-reunification`, `-family` and `-impediments`: the consolidated Ley 25.871. Articles 10, 20, 22 to 29, 62 and 99 read in full.
  - `decreto-616-2010-nationality`, `-reunification` and `-disability`: the original Decreto 616/2010, articles 20, 22, 23 and 29.
  - `decreto-366-2025`: articles 6, 44 and 47.
  - `disp-dnm-1637-2022-beneficiaries` (new): the original Disposición DNM 1637/2022 with its annex, articles 2 to 4 and 8 to 13.
  - `dnm-mercosur`: the directorate's service page.
  - `disp-dnm-4880-2015` and `disp-dnm-6206-2017` (new): both originals; until now the version cited them only through a note on the law's page.
  - `ccyc-periods`, `ccyc-minors` and `ccyc-unions`: the consolidated Civil and Commercial Code, articles 6, 25, 27 and 509 to 512.
  - `decreto-584-2024-unit` and `decreto-584-2024-exemption` (new): the original Decreto 584/2024. Its fee table (article 1) is published only as images and was not read; the amounts come from the directorate's table.
  - `dnm-fee-table` (new): the directorate's fee table page.
  - Not readable: none. Not re-read: none.
- **Amendments looked for**, up to 2026-11-11: the list of norms that modify Ley 25.871 (the newest is Resolución 1087/2026 of 2026-10-22, a visa waiver for Kuwait, then DNU 681/2026 of 2026-07-30), and the lists for Decreto 584/2024 (three DNM dispositions of 2024, none changing the unit's value) and Disposición DNM 1637/2022 (none). Nothing changes a cited provision.
- **Leads:** an open-web search for a 2026 disposition on Mercosur residence or its fee found nothing newer than the texts read; a search result summarizing a 2019 fee table gave ARS 3,000, a table Decreto 584/2024 replaced (its article 17 repeals Decreto 231/2009).
- **Findings:**
  - Confirmed, unchanged: the natives of 11 states and the five years of a naturalized national in eight (now also cited to Disposición DNM 1637/2022, annex, article 2); the spouse, parents, unmarried children under 18 and adult children with a disability (article 23, ñ, and article 10); the registered union (Disposición DNM 4880/2015 as worded in 2017).
  - Missing, now costs: the residence fee of 50 UMSM in the Mercosur column, ARS 50,000 at ARS 1,000 a unit (a computed amount), for the principal; the same for each family member who is a native of a listed state; for any other family member the table has a column of 100 UMSM and does not say which applies, so that fee is possible. Unmarried children under 18 who apply with a parent pay nothing (Decreto 584/2024, article 5, II).
  - Missing, now a duration: the two years of article 23, l).
  - Corrected: the spouse's and the partner's children. Article 23, ñ), names only a resident's own children, so they now show as possible, not as family members.
  - Missing, now assessments: a conviction or record (an indictment or committal to trial) for a crime Argentine law punishes with three years of prison or more (article 29, c)), a conviction for a lesser one (article 29, d)), where since 2025 a conviction need not be final and the directorate may grant an exceptional dispensation, and an entry ban in force (article 29, b). No fact records either, so both show the principal's visa refusals, as Portugal's do.
  - Corrected: the leap-day convention. Article 6 of the Civil and Commercial Code counts periods of years, not ages, and no other text read says when a person born on 29 February turns a year older, so `leapDayBirthday` is now `unsettled` and the code's article 6 is no longer cited.
  - Sources: split one per provision, so the law, the decree and the code each appear as several sources with the same address.
  - Gaps, in [OPEN-QUESTIONS.md](../../OPEN-QUESTIONS.md): Brazilians can also get permanent residence at once (Disposición DNM 1637/2022, annex, article 3, a), V, under Ley 26.240), a route the catalog does not have; the consular application costs 300 consular units, whose value no text read gives.
  - The cases file starts from version 2's cases; every case that met the requirement now reads "needs assessment".
- **Check loop:** runs [43061828774](https://github.com/fernandolisboa/arca/actions/runs/43061828774) (6 of 13 items match), [43064316443](https://github.com/fernandolisboa/arca/actions/runs/43064316443) (8 of 14) and [43065678291](https://github.com/fernandolisboa/arca/actions/runs/43065678291) (6 of 14, 2 differ), then FINAL_RUN. Fixed on the way: the criminal assessment split by article 29, c) and d), after the check showed that a record without a conviction counts only for the graver crimes, and both name the directorate's exceptional dispensation; the fees written as 50 or 100 UMSM times ARS 1,000; the partner cited only to the texts that state it. Left over:
  - `unreadable`: `dependent:children` and `dependent:partner`, whose ages and two years of living together are in the Civil and Commercial Code, a page the reader cuts before articles 25 and 510; the audit read it whole from the saved page.
  - `checker-gap`: `dependent:spouse-children` and `dependent:partner-children`, possible only because article 23, ñ), does not name them, an absence no quote can show; `cost:residence-fee-native-family`, where the value check refused the model's quote, though the first fee, with the same amounts, matched; `cost:residence-fee-other-family`, possible only because the table does not say which column applies.
- **Watch next:** the unit's value (Decreto 584/2024, article 3), which the Chief of Cabinet may change at any time; Decreto 616/2010, never adapted to the 2025 and 2026 changes to the law; a guide version 2 with the fee table and Disposición DNM 1637/2022.

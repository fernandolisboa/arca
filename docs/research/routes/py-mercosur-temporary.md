# py-mercosur-temporary

Research notes for Paraguay's Mercosur temporary residence, route `py-mercosur-temporary` in `packages/knowledge/data/routes`. The seed research is in [other-destinations.md](../other-destinations.md#paraguay); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-11

The first audit by the runbook ([#358](https://github.com/fernandolisboa/arca/issues/358)), on demand, together with the other three Mercosur routes. The pull request carries the four Mercosur routes, as the [Argentine record](ar-mercosur-temporary.md) explains.

- **Version audited:** 2
- **Outcome:** correction, version 3 (pull request [#385](https://github.com/fernandolisboa/arca/pull/385)), from 2026-07-01, a later date inside version 2's period, because the fee it adds is the amount in force from that day (Decreto N.º 6225/2026, Resolución DNM N.º 478/2026). The closed period before it, with the earlier jornal, gets no version: the API evaluates only as of today, so version 2, with the errors version 3 corrects, stays selected for dates before 2026-07-01. The two leap-day cases moved to 2030 so that they fall inside version 3's period.
- **Sources re-read** (all on 2026-11-11 UTC with `curl`; `www.bacn.gov.py` answered 520 once and the retry read):
  - `ley-3578-nationals`, `-residence`, `-records` and `-family`: Ley N.º 3578/2008 with the agreement, articles 2, 4 and 9.
  - `ley-6984`: Ley N.º 6984/2022, articles 4.10, 46, 50, 52, 100 and 101.
  - `dnm-mercosur-temporary`: the directorate's page; `dnm-fee-table` (new): the fee table in force from 2026-07-01; `dnm-ecuadorian-fees` (new).
  - `ley-7371-majority` (new): Ley N.º 7371/2025, article 27, the current wording of article 36 of the Civil Code, in place of `ley-2169`; Ley N.º 2169/2003, article 1; the Civil Code, articles 339 to 342 (no longer cited).
  - Read and not cited: Ley N.º 6774/2021, as the guide describes it.
  - Not readable: none. Not re-read: none.
- **Amendments looked for**, up to 2026-11-11: the Congress library's search for "6984", "migracion", "migratoria", "extranjeros" and "jornal", read for laws newer than Ley N.º 7371/2025. None amends Ley N.º 6984 or the agreement; Ley N.º 7432/2025 (integration committees with Argentina) and Ley N.º 7467/2025 (sports events) do not touch residence.
- **Leads:** a law firm's page on 2026 solvency rules concerns permanent residence (Resolución DNM N.º 407), not this route.
- **Findings:**
  - Confirmed, unchanged: the eight states the directorate lists, the five years of a naturalized national, the family of article 4.10 and the dependence the agreement asks.
  - Missing, now costs: 20 jornales, PYG 2,341,540 in cash, for the principal; two jornales, a computed PYG 234,154, for an Ecuadorian principal, by reciprocity; no fee for family members, since no text read says what one without a party's nationality pays (OPEN-QUESTIONS).
  - Missing, now a duration: two years, not extendable.
  - Missing, now an assessment: the certificates of no criminal records of article 4.1, c) to e), of the agreement. No fact records them, so it shows the principal's visa refusals.
  - Corrected: the leap-day convention. Articles 339 to 342 of the Civil Code count periods, not ages, and no text read says when a person born on 29 February turns a year older, so `leapDayBirthday` is now `unsettled` and those articles are no longer cited.
  - Corrected: the spouse's children. Article 4, principle 10, of Ley N.º 6984 names only the migrant's own children, so they now show as possible, not as family members.
  - Sources: the agreement split one per provision, plus its opening, which names its six parties.
  - The cases file starts from version 2's cases; every case that met the requirement now reads "needs assessment".
- **Check loop:** runs [43061828774](https://github.com/fernandolisboa/arca/actions/runs/43061828774) (5 of 10 items match), [43064316443](https://github.com/fernandolisboa/arca/actions/runs/43064316443) (4 of 10), [43065678291](https://github.com/fernandolisboa/arca/actions/runs/43065678291) (5 of 10) and, on the reviewed head, [43068431755](https://github.com/fernandolisboa/arca/actions/runs/43068431755) (3 of 9, none differs). Fixed on the way: the Ecuadorian fee written as two jornales of PYG 117,077; Ley N.º 6984 cited by its principle 10 by name; the family fee, which no text states, dropped. Left over:
  - `checker-gap`: `cost:residence-fee` and `cost:residence-fee-ecuadorian`, which matched in run 3. Items that matched in earlier runs and not in the last, on the same pages, are the passage locator's run-to-run variance.
  - `checker-gap`: `dependent:spouse`, `dependent:children` and `dependent:parents`, because the passage locator does not reach article 4, principle 10, of the long Ley N.º 6984 page, and the restriction to principals from the agreement's other parties joins its opening to article 9.2; `dependent:spouse-children`, possible only because no text read names them, an absence no quote can show.
- **Watch next:** the jornal, which follows the minimum wage decree (the last took effect on 2026-07-01); a new fee table is a new version.

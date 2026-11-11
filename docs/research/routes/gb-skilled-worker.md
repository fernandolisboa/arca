# gb-skilled-worker

Research notes for the United Kingdom's Skilled Worker visa, route `gb-skilled-worker` in `packages/knowledge/data/routes`. The seed research is in [other-destinations.md](../other-destinations.md#united-kingdom); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-11

The first audit by the runbook ([#359](https://github.com/fernandolisboa/arca/issues/359)), on demand, together with the Irish, Australian and Japanese routes. The issue asked for one pull request per country; the four share one, as the four Mercosur routes did in [#385](https://github.com/fernandolisboa/arca/pull/385), so that one review round covers them.

- **Version audited:** 1
- **Outcome:** correction, version 2 (pull request [#387](https://github.com/fernandolisboa/arca/pull/387)), from 2026-04-08, a later date inside version 1's period, because the visa fees it adds are the amounts in force from that day (Home Office fees table of 8 April 2026, unchanged on 8 October 2026). The closed period from 2026-03-26 gets no version of its own: the API evaluates only as of today, so version 1 stays selected for those dates.
- **Sources re-read** (all on 2026-11-11 UTC, with `curl` on the GOV.UK content API, `https://www.gov.uk/api/content/<path>`, and on `legislation.gov.uk/.../data.xml`):
  - Appendix Skilled Worker, whole (its change history ends with HC 584, applied 8 October 2026): `sw-age`, `sw-afghanistan`, `sw-sponsorship-and-job`, `sw-salary`, `sw-english`, `sw-funds`, `sw-dependents`, `sw-dependant-funds`, and the new `sw-occupation-lists`, `sw-salary-phd`, `sw-salary-isl-new-entrant`, `sw-grant-period`; SW 6.1A, 29.1A and 32A.2 on the Temporary Shortage List were read but are not cited (below).
  - Appendix Skilled Occupations (`skilled-occupations`), Appendix Relationship with Partner, Appendix Children, the introduction (`rules-introduction`), and Appendix English Language (new, `english-language-appendix`).
  - The explanatory memoranda of HC 1333 and HC 1691 (`english-b2-hc-1333`, `visa-brake-hc-1691`).
  - Immigration Act 1971, ss. 2 and 3ZA, now cited per section (`immigration-act-1971-abode`, `immigration-act-1971-irish`) in place of the whole act.
  - New: the Home Office fees table of 8 October 2026 (`fees-table`) and the health surcharge page (`health-surcharge`).
  - Read and no longer cited: the Age of Legal Capacity (Scotland) Act 1991, s. 6, which extends to Scotland only, and the Family Law Reform Act 1969, s. 9, which extends to England and Wales and says nothing of 29 February.
  - Not readable: none.
- **Amendments looked for**, up to 2026-11-11: the statements of changes collection on GOV.UK (latest HC 584 of 3 September 2026) and the explanatory memoranda of HC 259 and HC 584. Neither changes a rule this route reads: HC 584 lets a Skilled Worker found to be a victim of modern slavery work for any employer and fixes a provider's name; HC 259 adds neonatal leave to the Scale-up route. No statement laid after HC 584 was listed.
- **Leads:** the GOV.UK Skilled Worker guide, which an official text confirmed: its fees match the fees table, and its partner and children page names the limit on family for a medium-skilled job that SW 29.1A and 32A.2 state.
- **Findings:**
  - Missing, now costs: the visa fee, per person, from outside the UK £819 for a certificate of three years or less and £1,618 for more, from inside it £943 and £1,865 (£628 and £1,235 either way for a job on the Immigration Salary List, named in the titles), chosen by the principal's country of residence; the immigration health surcharge, £1,035 a year, or £776 for a child under 18, shown at its most, the 5 years of the longest grant. All are possible: the case records neither the certificate's length nor the job's list. The engine adds possible costs, so the two fee bands overstate the possible total; their titles say they are alternatives.
  - Missing, now a duration: permission until 14 days after the certificate's end date, at most 5 years after its start (SW 18.1).
  - Not modeled: a job on the Temporary Shortage List (SW 6.1A, certificate issued before 31 December 2026) qualifies, but brings no partner or children (SW 29.1A, 32A.2). The case records no job, so family rules for it could only show every family member as possible; the route covers jobs in Table 1, 2 or 3 and on the Immigration Salary List, and the list, which closes to new certificates in seven weeks, is left out (OPEN-QUESTIONS).
  - Split: `sponsored-job` joined four provisions; it is now `sponsored-job`, `eligible-occupation`, `salary` (option A), `salary-phd` and `salary-isl-or-new-entrant` (the lower floors). `funds` is now `funds` and `funds-dependants`.
  - Corrected: the leap-day convention. The only UK text that names 1 March is Scottish (Age of Legal Capacity (Scotland) Act 1991, s. 6(2)); the Immigration Rules apply UK-wide and the English act does not settle it, so `leapDayBirthday` is now `unsettled`. The case of a child born on 29 February moved from "dependent" to "possible".
  - Confirmed, unchanged: age 18, the Afghan visa brake, £41,700 and the going rate, B2 English, £1,270 and the dependants' £285, £315 and £200, the partner's 2 years.
- **Check loop:** runs [43075817319](https://github.com/fernandolisboa/arca/actions/runs/43075817319) (10 of 21 items match), [43076496175](https://github.com/fernandolisboa/arca/actions/runs/43076496175) (18 of 22, 1 differs) and [43076956976](https://github.com/fernandolisboa/arca/actions/runs/43076956976) (21 of 23, none differs). Fixed on the way: the pay floors split into the PhD floor and the Immigration Salary List or new-entrant floor, after the second run said one item joined two different discounts. Left over:
  - `checker-gap`: `requirement:not-applying-from-abroad-as-afghan`, whose explanatory memorandum to HC 1691 is cut before the passage; `dependent:spouse`, which joins three passages of Appendix Skilled Worker the model would not read together.
- **Watch next:** the Temporary Shortage List ends for certificates issued from 31 December 2026; a new statement of changes may extend it or end it. The fees table changes each April and often in October. A guide `gb` version 2 that adds the fees table and the health surcharge page, in a pull request of its own.

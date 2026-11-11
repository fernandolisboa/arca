# cl-mercosur-temporary

Research notes for Chile's Mercosur temporary residence, route `cl-mercosur-temporary` in `packages/knowledge/data/routes`. The seed research is in [other-destinations.md](../other-destinations.md#chile); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-11

The first audit by the runbook ([#358](https://github.com/fernandolisboa/arca/issues/358)), on demand, together with the other three Mercosur routes.

- **Version audited:** 1
- **Outcome:** correction, version 2 (pull request PR_NUMBER), from version 1's own date, 2022-05-14, so it replaces version 1 entirely.
- **Sources re-read** (on 2026-11-11 UTC with `curl`):
  - `sermig-mercosur` (last updated 2025-12-18) and `sermig-dependents` (last updated 2025-12-16): the migration service's pages.
  - `agreement-nationals`, `-residence` and `-records`: the agreement as Paraguay's Ley N.º 3578/2008 prints it, articles 2, 4 and 9.
  - Not readable: `ley-21325-treaty-residence`, `ley-21325-dependents`, `decreto-177-treaty-permits`, `decreto-177-dependents` and `codigo-civil`, all on `www.bcn.cl`, which answered 401 again; the Ley Chile JSON service, a lead, answered 401 too. They keep 2026-11-07 and go stale on 2027-02-05. Their new titles split what version 1's titles joined, from the reading of 2026-11-07 in the country guide.
  - The service's fee table by nationality is drawn by a script and was not found in the page or in a rendered copy.
- **Amendments looked for**, up to 2026-11-11: Ley Chile could not be read. News of 2026-07 reports a planned change to Decreto N.º 177 for seasonal farm workers; no published decree was found, and nothing points at treaty permits or dependents.
- **Leads:** that planned change, unconfirmed.
- **Findings:**
  - Confirmed, unchanged: the five states of subcategory 15, the five years of a naturalized national, the dependents of article 74 and the leap-day convention.
  - Missing, now an assessment: the principal's means for the dependents' upkeep, against the Social Development Ministry's indicators, which no text sets as an amount. This settles the open question on means for dependents: the dependents stay included, and the means are weighed.
  - Missing, now an assessment: the criminal record certificate the service's page asks of adults. No fact records it, so it shows the principal's visa refusals.
  - Missing, now a duration: up to two years.
  - Not modeled, in [OPEN-QUESTIONS.md](../../OPEN-QUESTIONS.md): the fee, which depends on nationality.
  - Sources: split one per provision. Article 70 is cited without choosing between N.º 9 and N.º 13, since the service still names N.º 13.
  - The cases file starts from version 1's cases; every case that met the requirement now reads "needs assessment".
- **Check loop:** runs [43061828774](https://github.com/fernandolisboa/arca/actions/runs/43061828774) (3 of 10 items match), [43064316443](https://github.com/fernandolisboa/arca/actions/runs/43064316443) (3 of 10) and [43065678291](https://github.com/fernandolisboa/arca/actions/runs/43065678291) (5 of 10), then FINAL_RUN. Fixed on the way: the dependents' titles now follow the service's page (spouse, partner, children between 18 and 24 who study), and the means assessment cites the page that states it. Left over:
  - `unreadable`: `assessment:means-for-dependents`, `dependent:children`, `dependent:spouse-children`, `dependent:partner-children` and `leapDayBirthday`, which rest on Ley N.º 21.325, Decreto N.º 177 and the Civil Code on `www.bcn.cl`: the check gets a page drawn by scripts with no text, and the session gets 401. They were read on 2026-11-07 from the Ley Chile JSON service, a lead host.
- **Watch next:** a readable host for Ley Chile before 2027-02-05 (an official-domain list version of its own); the planned change to Decreto N.º 177.

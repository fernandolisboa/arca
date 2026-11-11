# uy-mercosur-permanent

Research notes for Uruguay's permanent residence for nationals of the Mercosur states, route `uy-mercosur-permanent` in `packages/knowledge/data/routes`. The seed research is in [other-destinations.md](../other-destinations.md#uruguay); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-11

The first audit by the runbook ([#358](https://github.com/fernandolisboa/arca/issues/358)), on demand, together with the other three Mercosur routes. The pull request carries the four Mercosur routes, as the [Argentine record](ar-mercosur-temporary.md) explains.

- **Version audited:** 2
- **Outcome:** correction, version 3 (pull request [#385](https://github.com/fernandolisboa/arca/pull/385)), from version 2's own date, 2023-02-17, so it replaces versions 1 and 2. Article 46 of Ley N.º 18.250 has its current wording from 2024-01-01 (Ley N.º 20.212, articles 155 and 2); the assessment that cites it rests also on Decreto N.º 45/023, article 2, in force throughout, and the API evaluates only as of today, so the closed period from 2023-02-17 to 2023-12-31 gets no version of its own.
- **Sources re-read** (all on 2026-11-11 UTC with `curl`, Latin-1 pages read from the saved files):
  - `ley-18250-mercosur`, `-decision`, `-family`, `-entry-refusal` and `-denial`: the consolidated Ley N.º 18.250, articles 10, 33, 34 and 45 to 52.
  - `ley-20075`: article 169.
  - `decreto-45-2023-requirements` and `-reciprocity`: Decreto N.º 45/023 whole.
  - `ley-17927-nationals` and `-family`: the agreements, articles 2, 4, 9 and 11.
  - `dnm-residencia-legal` (last updated 2026-07-29) and `dnm-permanente-mercosur` (new, last updated 2026-10-20).
  - `ley-18246`, article 1; `decreto-394-2009`, article 16; `codigo-civil-majority` (new), article 280.
  - Not readable: none. Not re-read: none.
- **Amendments looked for**, up to 2026-11-11: the notes on each article of Ley N.º 18.250 (the newest amending law is Ley N.º 20.446 of 2025-12-16, on articles 24 and 26) and the decrees that regulate it. The 2025 accountability law, Ley N.º 20.531 (promulgated 2026-10-01), was read whole for references to Ley N.º 18.250 or Mercosur residence: none.
- **Leads:** a news item on that accountability law's bill spoke of foreigners with permanent residence; the law's text shows it concerns a cultural prize, not residence.
- **Findings:**
  - Confirmed, unchanged: article 33, literal B, and the 11 states the directorate lists; the partner's registered judicial recognition after five years; parents and the spouse who depend on a principal from one of the six signatories.
  - Corrected: article 10 names unmarried children who are minors or adults with a disability, so a child of 18 or more now shows as possible (the disability is not recorded) instead of a family member; the spouse's children, whom article 10 does not name, now show as possible. Majority at 18 is article 280 of the Civil Code. No Uruguayan text read says when a person born on 29 February turns a year older, so `leapDayBirthday` is `unsettled`.
  - Missing, now assessments: the denial grounds of article 46 and the refusal grounds of article 45, B to D, which Decreto N.º 45/023, article 2, asks adults to declare. No fact records them, so both show the principal's visa refusals.
  - Not modeled, in [OPEN-QUESTIONS.md](../../OPEN-QUESTIONS.md): the fee in indexed units and the exemption for Brazilians and Paraguayans, and the 90-business-day decision time.
  - Sources: split one per provision, each IMPO source cited at its article's own page (`/bases/leyes/18250-2008/33` and so on), since the whole of Ley N.º 20.075 and the Civil Code time out; plus the agreement's opening, which names its six parties.
  - The cases file starts from version 2's cases; the adult child and the stepchildren of one case are now possible, and new cases pin the 18th birthday and a 29 February birthday, which is a possible family member on 28 February of a common year.
- **Check loop:** runs [43061828774](https://github.com/fernandolisboa/arca/actions/runs/43061828774) (3 of 8 items match), [43064316443](https://github.com/fernandolisboa/arca/actions/runs/43064316443) (3 of 8), [43065678291](https://github.com/fernandolisboa/arca/actions/runs/43065678291) (1 of 8) and, on the reviewed head, [43068431755](https://github.com/fernandolisboa/arca/actions/runs/43068431755) (3 of 8, none differs). The two assessments matched in every run but the third, on the same pages: the passage locator's run-to-run variance. Left over:
  - `checker-gap`: `dependent:spouse`, `dependent:children` and `dependent:parents`, whose restriction to principals from the agreement's parties joins its opening to article 9.2; `dependent:partner`, which joins article 1 of Ley N.º 18.246 (five years, written "cinco años") to article 16 of Decreto N.º 394/009, and whose value check refused the quote; `dependent:spouse-children`, possible only because article 10 does not name them, an absence no quote can show.
- **Watch next:** the directorate's page, the only text with the fees and the list of states; whether the Uruguay and Paraguay agreement (Ley N.º 20.019) is in force; Decreto N.º 239/026, in force from 2027-01-24, which does not reach this route.

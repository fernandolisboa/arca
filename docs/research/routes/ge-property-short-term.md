# ge-property-short-term

Research notes for Georgia's short-term residence permit for owners of real estate, route `ge-property-short-term` in `packages/knowledge/data/routes`. The seed research is in [other-destinations.md](../other-destinations.md); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-11

The first audit ([#360](https://github.com/fernandolisboa/arca/issues/360)), on demand, in one pull request with the Czech, Danish, Latvian and Icelandic routes ([Czech record](cz-eu-blue-card.md)).

- **Version audited:** 1
- **Outcome:** new version, version 2 (pull request [#394](https://github.com/fernandolisboa/arca/pull/394)), from 2026-09-01, the day Law No. 1803 of 25 June 2026 reworded art. 18 (the date is the guide's reading of that law). Version 1 keeps the dates from 2026-03-01 to 2026-08-31 and is left uncorrected: it words the refusal grounds as they read from September, has no fees and uses the 28 February reading. A correction would need the law as in force before Law No. 1803, which is not the publication read, and only an evaluation dated in that window selects it; none of it changes an eligibility result, since the grounds are assessments ([OPEN-QUESTIONS](../../OPEN-QUESTIONS.md)).
- **Sources re-read** (all on 2026-11-11 UTC):
  - The Law on the Legal Status of Aliens and Stateless Persons, consolidated publication 23 of 25/06/2026, English PDF saved through the `web-fetch` agent and read whole with `pdftotext`; arts. 2, 14, 15, 16, 18 and 70 are cited, now at `?publication=23`. The publication carries Laws Nos. 863, 865, 1510 and 1803, so the Georgian-only page of Law No. 863, which version 1 cited and no session could re-read, is no longer cited.
  - The Civil Code, publication 140, English PDF read the same way; art. 12(2).
  - New: the Public Service Development Agency's residence permits page (`sda.gov.ge`), with `curl`, whole.
  - No longer cited: the Civil Code's articles on periods (below).
  - Not readable: the Georgian-only texts of the amending laws; their content was read in the consolidated English publication.
- **Amendments looked for**, up to 2026-11-11: the law's list of consolidated publications, of which 23 is the latest. Art. 18(2) and (3) are deleted and art. 18(1) is reworded.
- **Leads:** private pages on the 2026 amendments; none cited.
- **Findings:**
  - Changed in the law: the refusal grounds of art. 18, as Law No. 1803 left them.
  - Missing, now costs: the Agency's service fee, GEL 300 for a decision on the 30th calendar day (GEL 450 on the 20th, GEL 600 on the 10th), for the principal and for each family member; the amounts are in lari and shown converted, since the route's currency is the dollar of the property threshold.
  - Missing, now durations: the decision on the 10th, 20th or 30th calendar day, and the validity, extended a year at a time up to 12 years.
  - Corrected: the leap-day convention. The Civil Code's articles on periods count terms, not ages; `leapDayBirthday` is now `unsettled`. The cases already showed a child born on 29 February as possible on 28 February.
  - Split: `good-conduct` is now security, criminal record, disease, true documents and no expulsion proceedings, each one ground of art. 18.
  - Confirmed, unchanged: the property worth over USD 150,000, the spouse and the children. Whether a child of 18 or more counts stays open ([OPEN-QUESTIONS](../../OPEN-QUESTIONS.md)): art. 15(j) names children with no age, and neither the law nor the Agency's page settles it.
- **Check loop:** runs [43085585954](https://github.com/fernandolisboa/arca/actions/runs/43085585954) (version 1, 5 of 9 items, 1 differs: the old wording of art. 18), [43087381074](https://github.com/fernandolisboa/arca/actions/runs/43087381074) (13 of 16) and [43088296917](https://github.com/fernandolisboa/arca/actions/runs/43088296917) (8 of 16); none differs in version 2's runs, and 13 items matched in at least one. The checker read the English view pages as they are. The law is one long page, and the passage locator does not pick the same passages each run. Fixed on the way: art. 18 as amended; the family fee, reworded to what the Agency's page says; the title of the art. 14 source, now the article's own heading. Left over:
  - `checker-gap`: `assessment:lawful-stay`, whose art. 14 the locator gave in neither run; `cost:family-service-fee`, since the Agency's page repeats one fee table under every permit and states no fee for family members apart.
  - `differs-open`: `dependent:children`, the open question above.
  - Matched in one run only: `requirement:not-georgian-citizen`, `assessment:property-ownership`, `assessment:security`, `cost:service-fee` and `duration:decision`.
- **Watch next:**
  - A consolidated publication after 23.
  - The start date of 2026-09-01 rests on the guide's reading of Law No. 1803, a Georgian-only text no session could read; confirm it from an official text once one is readable.
  - The government ordinance that sets the service fees (art. 70(2)(b)) was not found in English; the Agency's page is the source for the amounts.

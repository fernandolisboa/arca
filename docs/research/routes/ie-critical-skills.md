# ie-critical-skills

Research notes for Ireland's Critical Skills Employment Permit, route `ie-critical-skills` in `packages/knowledge/data/routes`. The seed research is in [other-destinations.md](../other-destinations.md); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-11

The second audit, the first by the full runbook ([#359](https://github.com/fernandolisboa/arca/issues/359)), on demand, in one pull request with the British, Australian and Japanese routes ([British record](gb-skilled-worker.md)). As the issue asked, it covers what the pilot left: the requirements, the family rules of the Family Reunification Policy, and later instruments.

- **Version audited:** 2
- **Outcome:** correction, version 3 (pull request [#387](https://github.com/fernandolisboa/arca/pull/387)), from version 2's date, 2026-06-12, which it replaces entirely. It pins the EU, EEA and Swiss set at version 2.
- **Sources re-read** (all on 2026-11-11 UTC with `curl`):
  - The Employment Permits Act 2024, print form, whole; ss. 7, 8 and 22 are now cited per section (`/eli/2024/act/17/section/<n>/enacted/en/html`), so the check reads the provision instead of the whole act.
  - S.I. No. 444 of 2024 (regs. 7, 25 to 29, Schedule 1), S.I. No. 643 of 2025, S.I. No. 213 of 2026 and S.I. No. 558 of 2026, print forms, whole; with them the amending S.I. Nos. 33, 64, 119 and 127 of 2025, which change regs. 8, 9 and 14 and Schedules 3 and 5; Schedule 3 has since been replaced whole twice, and none of the rest is cited. S.I. No. 558 of 2026, cited in version 2 as a PDF, now has an html form, which version 3 cites.
  - The Immigration Act 1999, s. 1; S.I. No. 97 of 1999, art. 3; the Department's pages on who needs a permit, the Critical Skills Employment Permit and fees.
  - The Family Reunification Policy of 12 June 2026 (PDF, `pdftotext`), paras. 1.5.1, 6.3, 7.5, 7.10, 7.12, 7.13, 7.21 to 7.26, 8.2 and 10.8 to 10.10; the notice of the June 2026 amendments; the Policy Document Archive page, which confirms the June 2026 policy applies to applications made from 12 June 2026. New: the "Join non EEA family member" page (`isd-join-family`), whose Category B paragraph states the immediate reunification as text the check can read.
  - New: S.I. No. 421 of 2025 (`registration-fee`), regs. 3 and 4, found through the registration page of `irishimmigration.ie`.
  - No longer cited: the Age of Majority Act 1985, s. 4 (below).
  - Not readable: none.
- **Amendments looked for**, up to 2026-11-11: the year indexes of statutory instruments for 2025 (to No. 695) and 2026 (to No. 565). The only Employment Permits instruments are S.I. Nos. 33, 64, 119, 127 and 643 of 2025 and 213 and 558 of 2026, all read. S.I. No. 558 of 2026 also changes regs. 6A, 9 and 72D, none of which this permit uses. The archive page lists no policy newer than June 2026.
- **Leads:** none beyond the pages above.
- **Findings:**
  - Missing, now costs: the registration certificate fee, €300 for the principal and each family member aged 18 or over, waived under 18 (S.I. No. 421 of 2025, in force since 5 September 2025).
  - Missing, now durations: the permit, of up to 24 months; then a Stamp 4 permission of 2 years, renewable, without a further permit.
  - Corrected: the leap-day convention. Section 4 of the Age of Majority Act 1985 says an age is attained at the start of the anniversary; no Irish text says when a person born on 29 February has one, and version 2 assumed 28 February. `leapDayBirthday` is now `unsettled`; the case of a child born on 29 February moved from "excluded" to "possible".
  - Split: the `not-eu-eea-swiss-or-british-citizen` and `job-offer` items cite one section each; `pay` cites only the instrument that states the amounts.
  - Confirmed, unchanged: the thresholds, the qualification rules, the 2 years and 20 hours, the 50% rule, the €1,000 fee and its waivers, and the family rules (spouse or civil partner 18, de facto partner 18 with 2 years, unmarried children under 18, stepchildren in the household, adoptions recognised in Ireland).
- **Check loop:** runs [43075817319](https://github.com/fernandolisboa/arca/actions/runs/43075817319) (6 of 16 items match), [43076496175](https://github.com/fernandolisboa/arca/actions/runs/43076496175) (8 of 16) and [43076956976](https://github.com/fernandolisboa/arca/actions/runs/43076956976) (8 of 17, none differs). Fixed on the way: the job offer split from the employer's staff test, and S.I. No. 558 of 2026 cited by its html form after its PDF address began to redirect. Left over:
  - `unreadable`: `dependent:spouse`, `dependent:partner`, `dependent:children` and `dependent:spouse-children`, whose Family Reunification Policy is a PDF the checker does not read (#363).
  - `checker-gap`: `requirement:not-eu-eea-swiss-or-british-citizen`, which joins several acts; `assessment:pay`, `assessment:pay-recent-graduate` and `duration:permit`, which matched in the second run on the same pages (the passage locator's run-to-run variance); the pinned set `eu-free-movement` v2, as in earlier audits.
- **Watch next:**
  - The minimum annual remuneration roadmap's next change, due January 2027: version 4.
  - Schedule 3 is replaced every few months: check the year index for an instrument after S.I. No. 558 of 2026.

### 2026-11-09

The pilot of the rule audit. It started from leads, the two items the catalog check of pull request [#348](https://github.com/fernandolisboa/arca/pull/348) found to differ from their sources, rather than from every step of the runbook, which did not exist yet.

- **Version audited:** 1
- **Outcome:** correction, version 2 (pull request [#350](https://github.com/fernandolisboa/arca/pull/350)). Its `effectiveFrom` is 2026-06-12, the date of version 1, so it replaces version 1 entirely.
- **Sources re-read:** `ep-regs-mar-2026` (S.I. No. 643 of 2025, read whole) and `dete-csep`, both re-dated 2026-11-09. Added and read the same day: `ep-regs-fees` (S.I. No. 444 of 2024, reg. 7 and Schedule 1) and `dete-fees`. The pilot came before this format and did not note how each was read. Not re-read: the rest, with their 2026-11-07 dates.
- **Amendments looked for:** not a separate step in the pilot, which skipped step 2 of the runbook; the next audit does it in full. Version 1, read on 2026-11-07, already cited S.I. No. 558 of 2026 (28 October 2026), the latest replacement of Schedule 3.
- **Leads:** the catalog check's two differences on the job offer and the pay. An official text confirmed both, below.
- **Findings:**
  - The €36,848 threshold needs a degree at level 8 or higher, or its equivalent, obtained in the 12 months before the application, and is not open to nurses, midwives and radiographers (S.I. No. 643 of 2025, Schedule 8, Part 1). Version 1 left out both conditions.
  - A Schedule 3 job bound by a public sector pay agreement, or by a Workplace Relations Commission agreement linked to one, needs that agreement's rate instead of the thresholds (S.I. No. 444 of 2024, reg. 26(b), as substituted by reg. 6 of S.I. No. 643 of 2025). Version 1 left it out.
  - The hourly rates (€20.17, €18.17, €33.98) were missing.
  - The €1,000 application fee was not modeled; it is now a cost. Its title names its two exemptions, a registered charity and the spouse or civil partner of an EEA, Swiss or UK national, as not checked by the rule.
  - The `job-offer` assessment joined four provisions in one title; it is now `job-offer`, `pay`, `pay-recent-graduate` and `pay-public-sector-agreement`, each citing the sources that state it.
- **Watch next:**
  - The minimum annual remuneration roadmap names a next change for January 2027, not yet dated. A rule change then is version 3.
  - Schedule 3 is replaced every few months (S.I. No. 213 of 2026 in May, S.I. No. 558 of 2026 in October): check the year index for a newer one.
  - The open question on stepchildren and a de facto partner's children ([OPEN-QUESTIONS.md](../../OPEN-QUESTIONS.md)).

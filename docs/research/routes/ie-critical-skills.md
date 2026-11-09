# ie-critical-skills

Research notes for Ireland's Critical Skills Employment Permit, route `ie-critical-skills` in `packages/knowledge/data/routes`. The seed research is in [other-destinations.md](../other-destinations.md); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

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

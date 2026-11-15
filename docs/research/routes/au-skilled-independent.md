# au-skilled-independent

Research notes for Australia's Skilled Independent visa (subclass 189), points-tested stream, route `au-skilled-independent` in `packages/knowledge/data/routes`. The seed research is in [other-destinations.md](../other-destinations.md#australia); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-15

An on-demand correction, found while measuring the independent check after pull request [#451](https://github.com/fernandolisboa/arca/pull/451), in one pull request with the Argentine correction, so that both are reviewed and merged together ([Argentine record](ar-mercosur-temporary.md)).

- **Version audited:** 2
- **Outcome:** correction, version 3, from version 2's date, 2026-07-01, which it replaces entirely.
- **Sources re-read** (2026-11-15 UTC, a copy saved with `curl` this day of the volume 2 compilation `https://www.legislation.gov.au/F1996B03551/2026-11-01/2026-11-01/text/original/epub/OEBPS/document_2/document_2.html`, the sources' `machineReadableUrl`): `regs-189-character` and the new `regs-189-character-family`, clause 189.211 read whole. Not re-read: the rest, verified 2026-11-11 and untouched by this version.
- **Amendments looked for:** not again; the 2026-11-11 audit looked up to that date.
- **Leads:** the catalog check's `differs` on `assessment:character` (run [43736647876](https://github.com/fernandolisboa/arca/actions/runs/43736647876)); the clause itself settles it.
- **Findings:**
  - Corrected: the character criteria. Clause 189.211(1) names public interest criteria 4001, 4002, 4003, 4003B, 4004, 4020 and 4021 for the applicant; version 2 named only 4001 to 4004. The catalog check read version 2 as `differs` for that reason (run [43736647876](https://github.com/fernandolisboa/arca/actions/runs/43736647876)).
  - Corrected, now an assessment of its own: each family member applying meets 4001, 4002, 4003, 4003B, 4004, 4010 and 4020 (clause 189.211(3) and (4)), cited to a source of its own with the same addresses. No fact records any of them, so both assessments show the principal's visa refusals, as version 2 did.
- **Check loop:** not run yet. From about 16:40 UTC on 2026-11-15 every model call from CI answered "unavailable" (run [43737104187](https://github.com/fernandolisboa/arca/actions/runs/43737104187): 0 of 38 items answered, both routes), so the pull request stays open until a run with `routes=au-skilled-independent,ar-mercosur-temporary` answers on its head; its runs and what is left go here. Not checked yet: `assessment:character` and the new `assessment:character-family`.
- **Cases:** version 2's file, unchanged: a case states an outcome, dependents and missing facts, not an assessment's wording, so no case tells the corrected criteria apart.
- **Watch next:** as in the 2026-11-11 record.

### 2026-11-11

The first audit by the runbook ([#359](https://github.com/fernandolisboa/arca/issues/359)), on demand, in one pull request with the British, Irish and Japanese routes ([British record](gb-skilled-worker.md)).

- **Version audited:** 1
- **Outcome:** correction, version 2 (pull request [#387](https://github.com/fernandolisboa/arca/pull/387)), from version 1's date, 2026-07-01, which it replaces entirely.
- **Sources re-read** (all on 2026-11-11 UTC with `curl`): the Migration Regulations 1994, compilation of 2026-11-01, documents 1 (regulations and Schedule 1) and 2 (Schedule 2), read whole for regs. 1.05A, 1.12, 1.15C, 2.03A, 2.26AC, Schedule 1 item 1137 and Schedule 2 Subclass 189; the Acts Interpretation Act 1901 (compilation of 2026-03-28), s. 37A and s. 2G; the Legislation Act 2003, s. 13. New: the Home Affairs Legislation Amendment (2026 Measures No. 1) Regulations 2026 (F2026L00874), Schedule 3 item 20, which substituted item 1137(3) from 2026-07-01. Every regulations source now names its compilation document as `machineReadableUrl`, since the cited page is drawn by scripts. Not re-read: the country set `au-pacific-regional` v1, verified 2026-11-07.
- **Amendments looked for**, up to 2026-11-11: the register's versions API for the regulations (compilations 288 to 290 and two amendments not yet compiled, F2026L01449 from 2026-11-12 on training visas and F2026L01466 from 2026-11-03 on the Class DH visa), the Act and the two interpretation acts. F2026L01448 (from 2026-11-01) changes merits review fees and Schedule 1 item 1302. None touches item 1137, Subclass 189 or the regulations the route cites.
- **Leads:** none needed; the regulations are the text itself.
- **Findings:**
  - Missing, now family rules: a dependent child of a child who is a family member is in the family unit (reg. 1.12(2)(c)), through the principal's own child or through the spouse's or partner's child (reg. 1.12(2)(b)). A dependent child has no spouse or partner (reg. 1.03), which the rules check; the rest they cannot, since a rule tests only the person it reaches, so such a grandchild shows as possible. Cases cover each path and a married grandchild.
  - Missing, now an assessment: the character criterion, public interest criterion 4001 with 4002 to 4004, for the principal and each family member applying (clause 189.211). The health criterion (4005, clause 189.225) is not modeled: no fact records health.
  - Missing, now a duration: the permanent visa's travel facility, 5 years from the grant (clause 189.511).
  - Corrected: the leap-day convention. Section 37A of the Acts Interpretation Act says an age is attained at the start of the anniversary, and s. 2G counts months, not ages; no text says when a person born on 29 February has an anniversary, so `leapDayBirthday` is now `unsettled` and those sections are no longer cited. The case of a principal born on 29 February moved from "needs assessment" to "missing information".
  - Confirmed, unchanged: every first-instalment amount (AUD 6,135, 3,070 and 1,540; Pacific-regional 5,030, 2,515 and 1,260), the second instalment of AUD 4,885, the invitation, age 45, the skills assessment, competent English, the points score and the 12 months of a de facto relationship.
  - Not modeled, a particular case: a holder of a subclass 491 or 494 visa must have held it 3 years (clause 189.224A); the case records no Australian visa.
- **Check loop:** runs [43075817319](https://github.com/fernandolisboa/arca/actions/runs/43075817319) (0 of 21 items match), [43076496175](https://github.com/fernandolisboa/arca/actions/runs/43076496175) (0 of 21) and, after review, [43079138346](https://github.com/fernandolisboa/arca/actions/runs/43079138346) (0 of 23) and [43079824478](https://github.com/fernandolisboa/arca/actions/runs/43079824478) (5 of 23, none differs). The first runs read only the register's table of contents: the Schedule 1 and Schedule 2 sources shared one page address with two machine-readable addresses, and the check uses one only when every source on a page names the same. The Schedule 2 sources now cite the volume 2 page. Left over:
  - `unreadable`: the items on volume 1 (regs. 1.03, 1.12, 1.15C and 2.03A, Schedule 1 item 1137 and Schedule 6D): its machine-readable document is 4.1 MB, over the checker's 3 MB limit, and no smaller address on `legislation.gov.au` holds one regulation.
  - `checker-gap`: `assessment:skills-assessment`, `assessment:competent-english`, `assessment:points-score` and `assessment:character`, whose clauses of Part 189 (2.6 MB of text) the passage locator did not pick; the fee items, whose amounts the instrument writes with a space as the thousands separator ("$6 135").
- **Watch next:** the visa application charges are indexed each 1 July; a new amount is a new version. The guide `au` version 1 already lists every law this version cites.

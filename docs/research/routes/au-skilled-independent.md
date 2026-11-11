# au-skilled-independent

Research notes for Australia's Skilled Independent visa (subclass 189), points-tested stream, route `au-skilled-independent` in `packages/knowledge/data/routes`. The seed research is in [other-destinations.md](../other-destinations.md#australia); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

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
- **Check loop:** runs [43075817319](https://github.com/fernandolisboa/arca/actions/runs/43075817319) (0 of 21 items match) and [43076496175](https://github.com/fernandolisboa/arca/actions/runs/43076496175) (0 of 21, none differs). Left over, every item:
  - `unreadable`: the Migration Regulations compilation's machine-readable documents are 4.1 MB (document 1, over the checker's 3 MB limit) and 2.6 MB (document 2), and the passage locator sent the model only a table of contents. No smaller address on `legislation.gov.au` was found: the compilation's documents are the smallest parts the register serves, with no address for one regulation or Schedule clause, so per-provision sources cannot help.
  - `checker-gap`: the fee items, whose amounts the instrument writes with a space as the thousands separator ("$6 135"), so the quoted value does not match the item's.
- **Watch next:** the visa application charges are indexed each 1 July; a new amount is a new version; a guide `au` version 2 that adds the 2026 charges instrument (F2026L00874), in a pull request of its own.

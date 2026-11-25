# au-skilled-independent

Research notes for Australia's Skilled Independent visa (subclass 189), points-tested stream, route `au-skilled-independent` in `packages/knowledge/data/routes`. The seed research is in [other-destinations.md](../other-destinations.md#australia); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-25, session review of the documents

The [session rule review](../../runbooks/session-rule-review.md#documents) of the route's documents ([#527](https://github.com/fernandolisboa/arca/issues/527)).

- **Version audited:** 3
- **Outcome:** correction, version 4, from version 3's date, 2026-07-01, which keeps every item of version 3 and adds the official document list: the Migration Regulations 1994 (regs. 1.15C, 2.03AA and 2.07, Schedule 2 Part 189, Schedule 4 criteria 4005, 4017, 4019 and 4021 and Part 3), LIN 20/162 (form 1393, an internet application) and the language tests and passports instrument of 2025. Brazil's document guide needs no new version. The items, the rounds and the leftover list are in [the review's record](../../../packages/knowledge/reviews/2026-11-au-documents/README.md).
- **Amendments looked for:** on 2026-11-25 the register's versions API lists, after the regulations' compilation of 2026-11-03, the amending instruments F2026L01449 (from 2026-11-12, training visas), F2026L01500 (2026-11-13) and F2026L01503 (2026-11-28), which the review of 2026-11-20 found touch none of the provisions cited; LIN 20/162's latest compilation is still that of 2024-07-01, and the 2025 language instrument has none since it was made.
- **Watch next:** the Home Affairs page of the visa lists more documents (identity, relationship, points claims), but it draws its text with scripts the app's reader cannot see; those stay out until an official page the app can read states them.

### 2026-11-20, session review

A session review the owner asked for ([ADR-0032](../../adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../runbooks/session-rule-review.md)). The record, with what changed, the rounds and the leftover list, is [packages/knowledge/reviews/2026-11-au/README.md](../../../packages/knowledge/reviews/2026-11-au/README.md).

- **Version audited:** 2 (effective 2026-07-01), the newest stored.
- **Outcome:** correction, version 3, of version 2 from its own date, stored already active by the review's pull request. Every requirement, amount and duration of version 2 matched its text and stays. New: the public interest and special return criteria as the law lists them for each person (version 2 named only criteria 4001 to 4004), the health criterion, the 491 and 494 rule, where to apply and the section 48 bar, first entry; exact titles; the children of a spouse or partner aged 23 or more need recorded dependence.
- **Sources re-read** on 2026-11-20, through the app's reader: the Migration Regulations 1994, compilation of 2026-11-03, documents 1 to 3; the Migration Act 1958, compilation of 2026-10-08, ss. 5F, 12 and 48; F2026L00874, read through its PDF, since the register's HTML splits "$6 135" into two numbers.
- **Amendments looked for**, up to 2026-11-20: the register's versions of the regulations (F2026L01449, F2026L01500 and F2026L01503, not yet compiled, touch other visas) and of the Act (none waiting).

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

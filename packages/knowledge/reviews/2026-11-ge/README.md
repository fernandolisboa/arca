# Session review 2026-11-ge

Georgia has one stored route, `ge-property-short-term`: the short-term residence permit for an owner of real estate worth more than USD 150,000 (Law on the Legal Status of Aliens and Stateless Persons, art. 15(j)). Its newest version, 2, effective 2026-09-01, the audit's correction of 2026-11-11, was read on 2026-11-20 against the law's consolidated English publication 23 (still the latest in English and Georgian), the Georgian text of Law No. 1803 of 25 June 2026, the Public Service Development Agency's residence-permits page and the amendments to Government Ordinance No. 520 of 2014 on the residence-permit procedure ([ADR-0032](../../../../docs/adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../../../docs/runbooks/session-rule-review.md)). Version 3 corrects version 2 from the same date.

Version 2 matched the law on the threshold (more than USD 150,000 in GEL, non-agricultural land, valued by an accredited assessor), the citizenship requirement, the lawful-stay conditions, the refusal grounds, the Agency's fees (GEL 300, 450 or 600 for a decision on the 30th, 20th or 10th day) and the validity (a year at a time, up to 12 years). The start date is now confirmed from an official text: Law No. 1803, art. 3(2), puts its art. 1 in force on 2026-09-01, except points 25 and 30(a.g), which amend arts. 57 and 64; point 9 rewords art. 18. No act amending the law after Law No. 1803 is listed, and nothing announces a change for 2027.

## Version 3, correcting version 2 from 2026-09-01

- **Children of any age.** Art. 15(j) and the Agency's page name the owner's "child/children" with no age, where arts. 15(h) and (k) define their own family members as a minor child; the law's general family member (art. 2(h)) is not the term art. 15(j) uses. Version 2 showed a child of 18 or more as possible; version 3 shows every child of the owner as a dependent, which settles the age half of the question left open in [OPEN-QUESTIONS](../../../../docs/OPEN-QUESTIONS.md). The Civil Code's majority and art. 2(h) are no longer cited.
- **New assessments:** `stay-grounds` (art. 18(1)(b)), `documents-in-georgian` (art. 17(6): documents in Georgian; a passport with Latin data needs no translation) and `family-after-owner` (the spouse and children apply for the same permit once the owner holds it, with a copy of it and proof of the relationship, per the Agency's page; art. 3(4) of the rules approved by Ordinance No. 520, as Ordinance No. 389 of 27 August 2025 worded it: the holder's permit must have more than 6 months left).
- **Titles:** `lawful-stay` now covers each family member applying (the Agency asks each for proof of lawful stay); `criminal-record` now says a serious offence counts even if expunged; the law's sources carry its full name and art. 70 its own heading.
- **Sources** all read again on 2026-11-20 and dated so; every item cites its passages in `ge-property-short-term.3.evidence.json`.

## Rounds

Two reviewers in round 1, one checking each item against its provision, the other looking for anything official that makes the route out of date; the first again in round 2, on the changes.

- **Round 1.** No amount, threshold, fee, date or case expectation wrong. Proven and fixed: the children's age limit had no source; the criminal-record title said less than art. 18(1)(e); art. 18(1)(b), art. 17(6), the family members' sequence and documents, and the 6-month rule of Ordinance No. 520 were missing; the source titles shortened the law's name. The second reviewer found no act after Law No. 1803 amending the law and no change to the fee ordinance's item for this permit.
- **Round 2**, on the changes. Proven and fixed: the criminal-record title had lost "final" and "exceptionally serious"; `documents-in-georgian` left out that the law may let the Agency accept another language; the ordinance's source now names the amending act, Ordinance No. 389 of 27 August 2025, and the rules it amends; the Agency page's source title now names the family documents it is cited for. No third round was needed.

The proposal check and the quote check (`ARCA_REVIEW_QUOTES=2026-11-ge`) pass on the final files.

## Leftover

1. **Property already owned.** The requirement reads the unit's liquid funds against USD 150,000, since no case fact records an asset's country or whether land is agricultural, and a requirement must be able to be false. An owner who already holds a qualifying Georgian property and has no cash reads not eligible ([OPEN-QUESTIONS](../../../../docs/OPEN-QUESTIONS.md)).
2. **The spouse's children.** Version 3, like version 2, reads art. 15(j)'s "his/her … child/children" as the owner's own children; a child of the spouse alone stays out, since neither the law nor the Agency's page names one ([OPEN-QUESTIONS](../../../../docs/OPEN-QUESTIONS.md)). Whether Georgia recognizes a given marriage is not checked either.
3. **Faster service may be refused.** The fee ordinance's amendment of 31 August 2026 lets the Agency refuse the 10- or 20-day service when objective circumstances make it impossible; the `decision` duration does not say so.
4. **Ordinance No. 416 of 26 August 2026** (in force 2026-09-01) caps the review at 30 days from a full file (art. 13(3) of the Ordinance No. 520 rules) and exempts an extension from a new valuation while the owner keeps the property (art. 14(3)); the version's 30-day decision and art. 16(3) say the same, and the ordinance is not cited. The Agency's on-site check (art. 17(3¹)) and art. 18(1)(g1), which concerns a citizen's spouse, are not modeled.
5. **Residence card.** Art. 20(2): the card must be obtained within one month of the permit; not modeled, since it follows the grant.
6. **"Public order".** The Georgian text of art. 18(1)(c) as Law No. 1803 left it says public order where the English publication cited says public safety; `security` follows the cited English text.
7. **Version 1** (2026-03-01 to 2026-08-31) stays as the audit left it.
8. **Other Georgian routes** (investment permit, art. 15(h); unlimited permit, art. 15(k); work and IT permits) are new routes, which go through the app.
9. **Production rows were not read.** This session has no database credentials; the proof of publishing is the production build, which runs the migration.

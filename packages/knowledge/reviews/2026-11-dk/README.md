# Session review 2026-11-dk

Denmark has one stored route, `dk-pay-limit`: the residence and work permit under the Pay Limit Scheme (Aliens Act, § 9 a(2)(3)). Its newest version, 2, effective 2026-01-01, the audit's correction of 2026-11-11, was read on 2026-11-20 against the consolidated Aliens Act (Act No. 953 of 2026, LexDania XML), the fee order (Order No. 1612 of 2025), the EU Residence Order (No. 1457 of 2020), the Guardianship Act (No. 1122 of 2021) and SIRI's pages on the scheme and on accompanying family of employees ([ADR-0032](../../../../docs/adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../../../docs/runbooks/session-rule-review.md)). Version 3 corrects version 2 from the same date.

Version 2 matched the law on the pay limit (DKK 400,000 in the act, adjusted yearly; DKK 552,000 for 2026 on SIRI), the 30 hours, the Danish bank account, usual pay and terms, the labour-dispute and genuine-offer bars, social assistance, the shared home, the citizenship requirement, the spouse, partner and children rules and the 2026 fees (DKK 6,810 and 3,080). Nothing published since 2026-11-04, the consolidation's date, changes the rules for 2026.

## Version 3, correcting version 2 from 2026-01-01

- **Family members** (SIRI's "other family"): a parent, or a child of 18 or more, who depends on the principal now reads as possible, since SIRI grants other family a permit only where extraordinary circumstances and weighty considerations apply, such as having always been supported by the sponsor. Version 2 left them out. One whose dependence is unknown reads as possible; one recorded as depending on no one stays out.
- **New assessments:** `danish-authorisation` (a Danish authorisation, or a temporary one, for a regulated job such as a doctor's), `family-permits-not-revoked` (Aliens Act, § 9 a(4), second sentence: no family member's permit revoked more than once under § 19(1)(19)), `recognised-union` (a marriage or registered partnership Danish law recognises, both 18 or more at the wedding, which also states the principal's age that no fact reads), `danish-employer` (as a rule, a company registered in Denmark) and `custody-consent` (the other parent's consent for a child who comes with one of two custody holders).
- **Durations:** `family-processing`, 2 months, up to 3, from SIRI's family page; the permit's title adds that it ends no later than 3 months before the passport expires.
- **Titles:** `danish-bank-account` (an account in the principal's own name) and `genuine-offer` (the actual employment presumed not to meet the conditions) now say all their provision says.
- **Sources** all read again on 2026-11-20 and dated so; every item now cites its passages in `dk-pay-limit.3.evidence.json`.

## Rounds

Two reviewers in round 1, one checking each item against its provision, the other looking for anything official that makes the route out of date; the first again in round 2, on the changes.

- **Round 1.** No amount, age, date or citation wrong. Proven and fixed: the fourth criterion of a recognised marriage (fundamental legal principles) missing; `family-permits-not-revoked` worded as past history where the act sets a condition of the permit; two titles shorter than their provisions; the family processing time, custody consent, the Danish employer and the passport limit missing. The second reviewer read every act and order on retsinformation numbered 766 to 1014 of 2026 and SIRI's news to 2026-11-20: nothing amends §§ 1, 2, 9 a, 9 h, 9 m or 19 for 2026; no 2027 pay limit or fee order is out.
- **Round 2**, on the changes: no defect. No third round was needed.
- **After round 2**, from the repository's reviewers: the spouse rule's title now says why a younger marriage reads as possible, the 28 February leap-day case records the child as depending on no one so it still tests the leap day, and a case shows an adult child whose dependence is unknown as possible.

The proposal check and the quote check (`ARCA_REVIEW_QUOTES=2026-11-dk`) pass on the final files.

## Leftover

1. **Version 4, from 2027-01-01, is owed.** Act No. 765 of 2026 renumbers § 9 a and its cross-references (§ 9 h(1)(4), § 9 m(1), § 19(1)(20)) from that day and adds the collective-agreement scheme (another route); SIRI's 2027 pay limit and the 2027 fee order were not published on 2026-11-20. Writing 2027 now would show 2026's amounts as 2027's.
2. **The principal's age at the wedding.** SIRI wants both spouses 18 or more at the wedding; `edge.ageAtStart` reads only the spouse's age, so a principal who married at 16 a spouse of 18 still shows the spouse as a dependent. `recognised-union` states the rule ([OPEN-QUESTIONS](../../../../docs/OPEN-QUESTIONS.md)).
3. **A registered partnership** is not recorded by the case, so a registered partner reads as possible through the partner rule, where SIRI lists one in its own right.
4. **Other family** beyond parents and own children (siblings, grandparents, the spouse's children) stays out, and the parent and adult-child rules read dependence from financial dependence only, where SIRI weighs several circumstances (care because of age or disability, no other family at home, living together while posted abroad).
5. **Not modeled:** applying from within Denmark needs lawful stay (§ 9 a(5)); a family member needs a separate work permit to work at the sponsor's company (§ 9 m(3)); the 6-month job-seeking permit after an employment under 4 years; SIRI's practice note of 2026-10-05 on the rule of presumption is not cited.
6. **Production rows were not read.** This session has no database credentials; the proof of publishing is the production build, which runs the migration.

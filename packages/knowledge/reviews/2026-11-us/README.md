# Session review 2026-11-us

The United States has one stored route, `us-eb5`. Its newest version, 8 (effective 2026-11-30), was read against the U.S. Code (govinfo), the eCFR and the Federal Register on 2026-11-19, São Paulo date. Version 9 corrects it ([ADR-0032](../../../../docs/adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../../../docs/runbooks/session-rule-review.md)).

## What version 9 changes

- **Adopted children, logic.** Version 8 let a natural sibling adopted under 18 through with no test of custody. The two years in the adopter's legal custody and home now apply to both ages, and a shorter custody reads as possible, not as excluded, since 8 U.S.C. 1101(b)(1)(E) also admits a child battered by the adopter or the adopter's household, which the app does not record.
- **Children's age.** The three child rules say that the age is the one 8 U.S.C. 1153(h) counts, and cite it.
- **Children born out of wedlock.** The title names the father's side: legitimation or a bona fide relationship.
- **Spouse.** A marriage celebrated without both parties present counts only once consummated (8 U.S.C. 1101(a)(35)).
- **Capital.** The title says the amounts hold for petitions filed before 2027-01-01, that the app compares liquid assets, and that the law counts cash and tangible assets; a gift or loan counts only in good faith and not to evade the limits on sources.
- **Petition fee.** The title gives the standalone Form I-526 fee and the regional center program's end, 2027-09-30.
- **Conditional residence, evidence.** The item's three years now rest on the statute's own words, the third anniversary (8 U.S.C. 1186b(c)(3)(B) and (d)(1)); version 8's quotes gave only the second anniversary and the one-year extension.
- **Sources.** Four provisions added, every title checked against its provision, and every `verifiedAt` set to 2026-11-19.

Amounts, fees, durations and the other conditions of version 8 matched their sources.

## Rounds

Three adversarial rounds, the limit. Round 1: one wrong condition (the sibling's custody) and five omissions. Round 2: no wrong item, four titles reworded. Round 3: one wrong condition (the battered child's alternative) and one title that left out half a test (gifts and loans); both are fixed in this version and no reviewer saw the fixes (leftover 9). The quote check, the app's own (`ARCA_REVIEW_QUOTES=2026-11-us`, in `apps/api`), passed in the session on 2026-11-20 UTC: every item matches on the pages it cites and its quotes state its values. The `review-quotes` job runs it again on the pull request.

## Leftover

1. **Capital is compared with liquid assets only, and with the lower amount.** The law also counts tangible assets at fair market value. The engine has no fact for them, and a requirement must be able to be false, so the title discloses it: a family with capital in property reads as not eligible here. And the requirement passes at USD 800,000 whatever the project: the engine does not know whether it is in a targeted employment area, outside of which the law asks USD 1,050,000.
2. **The amounts from 2027-01-01.** 8 U.S.C. 1153(b)(5)(C)(iii) adjusts them for inflation on that date, and no adjusted amount was found published as of 2026-11-19. Version 10 is due when one is ([#219](https://github.com/fernandolisboa/arca/issues/219)).
3. **The 2026 pause on immigrant visas.** A January 2026 State Department pause on issuing immigrant visas to nationals of 75 countries, Brazil among them, was read only in a court opinion that quotes the Department saying a court order ended it on 2026-08-21. `travel.state.gov` refuses this session's requests, so its state today, and any appeal, could not be confirmed. The route does not mention it.
4. **Inadmissibility is not modeled.** No route states the grounds that can refuse a visa to someone who meets the route, such as the public charge rule (91 FR 45324, effective 2026-09-18).
5. **Visa availability.** Whether the Visa Bulletin holds back EB-5 numbers for the applicant's country was not checked, for the same refused site.
6. **Facts the schema cannot hold.** Legitimation, the bona fide relationship, the age 8 U.S.C. 1153(h) counts, a proxy marriage and the battered child's alternative are in titles only; the engine cannot test them. The child rules test the age in years, so a child of 21 or more whom 1153(h) would still count as under 21 reads as excluded.
7. **Versions 1 to 7** were not reviewed: none is in effect on or after 2026-11-30. The route as it reads until then was not reviewed either.
8. **Production rows were not read.** This session has no database credentials; the proof of publishing is the production build, which runs the migration and fails if the database already holds a version 9.
9. **Two corrections no reviewer saw.** Round 3 was the last round, so its two fixes (the custody condition that now admits the battered child's alternative as possible, and the wording on gifts and loans) were checked only by the session, the proposal check and the quote check.

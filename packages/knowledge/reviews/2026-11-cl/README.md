# Session review 2026-11-cl

Chile has one stored route, `cl-mercosur-temporary`: temporary residence, subcategory 15 ("Mercosur: principio de reciprocidad internacional"), for nationals of Argentina, Bolivia, Brazil, Paraguay and Uruguay, which the service's page places under Ley N.º 21.325, article 70 N.º 13 (a reading of 2026-11-07 found N.º 9, treaties, a better fit; [OPEN-QUESTIONS](../../../../docs/OPEN-QUESTIONS.md)). Its newest version, 4, effective 2022-05-14, was read on 2026-11-20 against the migration service's pages (subcategory 15, dependents, fees), the fee table it links (Resolución Exenta N.º 129194 of 2020), Ley N.º 21.325 (articles 40, 70 and 74), Decreto N.º 177/2022 (articles 46 and 72 to 74), Decreto exento N.º 4.236/2022, Decreto N.º 296/1995, the Civil Code (articles 26 and 48) and the Residence Agreement as Paraguay's Ley N.º 3578/2008 prints it ([ADR-0032](../../../../docs/adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../../../docs/runbooks/session-rule-review.md)).

`www.bcn.cl`, the `cl` list's host for Ley Chile, answers the session with 401 most of the time and 200 now and then. The texts were first read through BCN's JSON service (`nuevo.leychile.cl`, not on the list, used only to find the passages); the live quote check then read each cited norm's XML export on `www.bcn.cl` on 2026-11-20, with at least one quote from every `www.bcn.cl` source, and every quote matched, so those sources now carry that date.

Version 4 matched the law on who qualifies, the five-year rule for a naturalized national (shown as possible), the spouse and partner, children under 18, older children with a disability or studying (possible), majority at 18 and the leap-day reading, and the two years. Version 5 corrects and completes it.

## Version 5, correcting version 4 from 2022-05-14

- **Fees**, from the table the service's fee page links for temporary residence: `residence-fee` states the principal's fee by nationality in US dollars, paid in pesos (Argentina 250, Brazil 100, Paraguay 288, Uruguay 65; Bolivians none since the Chile–Bolivia agreement the service announced on 2023-09-20, before it the table's 149 or the USD 90 the service says it charged), and that minors are exempt (point 6). `dependent-fee` charges USD 15 for each dependent of 18 or over (point 7, Decreto N.º 296/1995, article 2, d)), converted to pesos; minors are exempt.
- **New assessments** from the service's pages: `apply-from-abroad` (online, from abroad only, dependents too), `documents` (passport valid a year from the application, a Bolivian's identity card, photo, apostille or legalization, translation unless Spanish or English) and `family-papers` (proof of the tie, a parent's notarized care statement for a child under 18, and the couple's marriage or cohabitation proof for a stepchild).
- **`means-for-dependents`** adds the principal's notarized sworn statement to bear the dependents' costs (Decreto N.º 177, article 74, a)).
- **Children:** "between 18 and 24" becomes "18 or older and under 24", as article 74, N.º 2, says ("mayores de 18 años, pero menores de 24").
- **Sources:** `decreto-177-treaty-permits` is dropped: article 46 is the decree's permit for persons under international agreements (the service's subcategory 8), which may be applied for in Chile and takes the treaty's own requirements, while the service runs subcategory 15 apart, under N.º 13, from abroad only. The five years of a naturalized national rest on the agreement's article 2 and the service's page. New: `sermig-fees`, `fee-table-by-nationality`, `sermig-bolivia-agreement`, `decreto-296-fees`.

## Rounds

Two reviewers in round 1, one checking each item against its provision, the other looking for anything official that makes the route out of date; the first again in rounds 2 and 3, on the changes.

- **Round 1.** Proven and fixed: Bolivians shown as exempt from 2022, when the exemption came with the agreement of September 2023; the care statement read as if only a stepchild needed it; `decreto-177-treaty-permits` cited for a permit it does not govern. The second reviewer found no amendment of articles 70 or 74 of Ley N.º 21.325 (Leyes 21.589, 21.590, 21.610, 21.655, 21.730 and 21.816 touch other articles) and no change to the five countries.
- **Round 2**, on the changes: the Bolivian line claimed USD 149 up to 2023 and gave a year no cited page stated; it now cites the service's news of 2023-09-20 and names both amounts.
- **Round 3**, on that change: no defect. Left open: the news dates the agreement (signed the week before 2023-09-20), not the day the waiver started (leftover 2).

The proposal check and the quote check (`ARCA_REVIEW_QUOTES=2026-11-cl`) pass on the final files.

## Leftover

1. **The principal's fee is not a cost.** The fee table prints each country's three columns as "ARGENTINA 250 250 250", which the quote check reads as one grouped number (250,250,250), so a cost of USD 250, 100 or 288 cannot be evidenced; the amounts are in `residence-fee`'s title. Uruguay's 65 reads alone but is kept with the others. Fixing this means teaching the PDF reader or the quote check table columns, code work.
2. **Bolivia before the 2023 agreement:** the table says USD 149, the service's news of 2023-09-20 says USD 90 was charged, and the agreement's date in force was not found, so the title gives both and the month of the news. Whether the waiver covers Bolivian dependents' USD 15 is not stated.
3. **New regulations announced, not published.** The service's news of 2026-11-10 says it finished revising five regulations, Decreto N.º 177 among them, and a new fee regulation replacing the 1995 one. No publication in the Diario Oficial or on Ley Chile was found; once published, the fees and possibly the dependents' papers need a new version.
4. **Sworn statement of no international records** (agreement, article 4.1, d)): the service's page does not ask for it and no Chilean text settles it.
5. **Naturalized nationals** read as possible (five years held, which no fact reads), as in version 4.
6. **After the grant** (a lead from the service's guide of 2023, not re-read here): the permit's stamp must be downloaded within 120 business days and the holder enters Chile within 90 days; not modeled.
7. **Facts no route records:** each family member's criminal record, passport, disability or studies; the assessments show principal-level facts as evidence.
8. **Back to 2022-05-14:** the document details come from pages updated in December 2025; no earlier text was found, so version 5 applies them from the route's start.
9. **`www.bcn.cl` is unreliable from here.** On 2026-11-20 `curl` got 401 and the quote check got 200 on most runs but 401 on some; if GitHub's `review-quotes` job or a later session cannot read it, the Ley Chile sources cannot be re-verified. A readable host for Ley Chile would need its own official-domain list version, through the app.
10. **After round 3, seen by the repository's reviewers only:** the wording of `residence-fee` ("before: 149 in the table, 90 charged") and `family-papers` ("also needs"), and three added evidence quotes, on Ley N.º 21.325 article 70 N.º 13, Decreto N.º 177 article 74, a), and Decreto N.º 296 article 2, d), which the live quote check matched.
11. **Production rows were not read.** This session has no database credentials; the proof of publishing is the production build, which runs the migration.

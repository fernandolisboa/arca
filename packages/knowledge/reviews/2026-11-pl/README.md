# Session review 2026-11-pl

Poland has one stored route, `pl-descent` (confirmation of Polish citizenship held from birth through a line of Polish parents). Its newest version, 2, effective 2026-01-01, was read against the official texts on 2026-11-20. Version 3 corrects version 2 from the same date ([ADR-0032](../../../../docs/adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../../../docs/runbooks/session-rule-review.md)).

## What version 3 changes

Version 2 matched its texts where it spoke: the rule of art. 14 of the 2009 act for births since 15 August 2012, the stamp duty of PLN 277, the consular fee of EUR 100 since 1 January 2026 and the six-month term. Version 3 keeps the requirement's expression, the two amounts and the term, and changes what version 2 could not be read on, left out or said loosely.

- **A source the app could not read.** The 1962 act was cited at its Journal of Laws scan, which has no text layer: the app's reader answers "no text" and a check of the route stops there. It is now cited at its consolidated text of 2000 (Dz.U. 2000 nr 28 poz. 353), whose arts. 4 and 6 read as the text published in 1962 does.
- **The date the 2009 act took effect.** The act says only "six months after publication". The requirement now cites the Sejm's ELI record of the act, which states 15 August 2012.
- **The requirement's title** says that the law sets no limit of generations and that four are read (leftover 1).
- **Eleven assessments**, for what bears on the result or on the application and no fact records:
  - `no-own-loss`: the person's own loss (2009 act, arts. 46, 7 and 8; the 1920 act, art. 11, for earlier ways).
  - `parentage-settled-within-a-year`: a change in who is found to be a parent counts only within a year of the birth (art. 6).
  - `full-adoption-before-16`: full adoption by a Polish citizen before 16 (art. 16), which the requirement does not read.
  - `application-and-proof`: what the application holds and the documents with it (art. 56; the form regulation).
  - `documents-in-polish`: the application in Polish, documents with a translation by a sworn translator or a consul, who charges for it (art. 12; the form; consular tariff items 6.08 to 6.11).
  - `documents-at-a-consul` and `documents-at-the-voivode`: what the Polish posts in Brazil and the Pomeranian voivode's office ask for (leftover 7).
  - `attorney-for-service`: who must name someone in Poland to receive letters (administrative procedure code, art. 40 § 4).
  - `deciding-voivode` (art. 55), `appeal-within-14-days` (the ministry's page; art. 10 ust. 4) and `own-application-for-each-minor` (the ministry's page).
- **Stamp duty.** The title now says the duty is for the decision either way, and names the three cases with no duty: an application a consul passes on, a decision a consul delivers against a fee (Stamp Duty Act, art. 3a ust. 1, both limbs; tariff item 5.01, EUR 40) and a certificate of social assistance for poverty (art. 7 pkt 5).
- **A new possible cost**, `power-of-attorney-duty`: PLN 17 for a power of attorney filed in the case, none when it is given to a spouse, an ascendant, a descendant or a sibling (annex, part IV).
- **The term.** The title of `confirmation-decision` now says what the six months leave out and that they can be extended in justified cases, as the ministry's page says.
- **Source titles** made exact: the 1962 act's art. 4, the 2009 act's art. 6, the 1920 act's arts. 11 and 13, the stamp duty's item 27 and art. 3a. Every `verifiedAt` is 2026-11-20.
- **Results.** A family that read "eligible" now reads "needs assessment", since the version has assessments. No other result changes.

Nothing published up to 2026-11-20 changes a provision the route cites. The 2009 act's newest amendment is Dz.U. 2025 poz. 921, in the consolidated text. The six acts that amended the Stamp Duty Act after Dz.U. 2025 poz. 1154 are in Dz.U. 2026 poz. 1395 and none touches arts. 3a, 6 or 7, item 27 or part IV; two more take effect in 2027 (Dz.U. 2026 poz. 875, art. 1 ust. 3; poz. 1206, part III). The consular fees regulation was last amended by Dz.U. 2025 poz. 1523, the form regulation never, and the administrative procedure code by Dz.U. 2025 poz. 769. The Journal of Laws of 2026 was read up to poz. 1530. Three citizenship bills are in the Sejm (prints 1273, 1759 and 1888, the last rejected at first reading); none is law.

## Rounds

Three adversarial rounds, the limit, by two reviewers: one read each item, title, case and quote against its provision, and ran the cases and families of its own through the engine; the other looked for anything official that makes the route out of date or incomplete (each act's amendments in the Sejm's ELI records, the Journal of Laws of 2026, bills, and the pages of the ministry, voivode offices and consulates on `www.gov.pl`).

- **Round 1**, on the first files. Nothing out of date; every amount, date and case correct. Proven: a Polish ancestor beyond the fourth generation reads "not eligible" (leftover 1); the 1962 act's art. 4 title had lost "undetermined citizenship"; missing were the attorney for service, the consul's translation fees, the second limb of art. 3a, what the term leaves out, Polish as the application's language, the documents consulates ask for and the appeal. Several titles were loose (art. 6 read as a change of citizenship, not of what is established; the duty as owed only on a confirming decision).
- **Round 2**, on the corrected files. Every quote on its page. Proven: `attorney-for-service` followed the form's instruction of 2012, wider than art. 40 § 4 of the code as it now reads; the translation fee is not always by the page; the birth record is asked only of someone born abroad; one condition of art. 6 ust. 2 had dropped out.
- **Round 3**, on that delta. Every changed item correct and no regression. One point, fixed after the round (leftover 12): the voivode's page also asks for a copy of the identity document and accepts copies certified by the lawyer who acts in the case.

The proposal check and the quote check, which reads the official pages through the app's reader (`ARCA_REVIEW_QUOTES=2026-11-pl`), pass on the final files.

## Leftover

1. **Four generations.** The law has no limit of generations; the schema reads four at most. A family whose only recorded Polish ancestor is further up reads "not eligible". An expression cannot answer "missing information" at the fourth generation without a number that no official text states, which the quote check rightly refuses. The title says so; the fix is a wider reach in the engine, with the work on earlier births ([#270](https://github.com/fernandolisboa/arca/issues/270)).
2. **Births before 15 August 2012 are not settled** ([#270](https://github.com/fernandolisboa/arca/issues/270)): every such link reads "missing information". Under the 1962 act a child of one Polish parent was Polish unless the parents chose the other citizenship within three months (art. 6), under the 1951 act it turned on the place of birth and reciprocity (arts. 8 and 9), under the 1920 act on the father, on marriage and on losses that reached the wife and children (arts. 5, 11 and 13). No fact records any of these.
3. **Costs of which one is paid are added up.** Abroad, the stamp duty and the consular fee are both possible and the engine adds them; they are in two currencies, so they cannot be one cost. The API gives no exchange rates, so the consular fee shows a missing rate. The third way, a decision delivered by a consul for EUR 40 (tariff item 5.01), is a source of the stamp duty and not a cost: no voivode page read in this review describes it, and the Pomeranian office's page shows PLN 277 for everyone.
4. **The poverty exemption is not read.** A principal who lives in Poland reads the stamp duty as certain; someone with a certificate of social assistance for poverty owes none (art. 7 pkt 5). The title says so.
5. **A minor covered by a parent's grant or recognition** (2009 act, art. 7) is Polish from that day, not from birth. The route reads births only, so a child whose parent became Polish after the birth reads "not eligible" here, with nothing pointing to art. 7.
6. **Readings that err on the open side.** An adoptive link reads "missing information" even when no adopter is Polish, since art. 16 asks for citizenship at the adoption, not at the birth, and whether an adoption was full is not recorded. A loss recorded on a person in the middle of the line reads "missing information", while the same loss on the top ancestor closes the line.
7. **Two pages speak for one office each.** `documents-at-a-consul` is what the Polish posts in Brazil ask, and `documents-at-the-voivode` what the Pomeranian office asks; their titles say so, and every person sees both. Other voivode offices did not answer the session's requests or sit on hosts outside the `pl` list (the Mazovian voivode's citizenship pages among them).
8. **Quotes from the old acts are not possible.** The 1920 and 1951 scans have a poor text layer and the consolidated 1962 text reads with broken letters, so the requirement's quotes come from the 2009 act and the ELI record, whose values come without their labels (the date in force reads `2012-08-15 IN_FORCE`). The old acts were read in the session as page images.
9. **Not in the version:** the consul may lower or waive a fee and does not refund it (Prawo konsularne, Dz.U. 2026 poz. 711, arts. 108 and 109, not cited); whether PLN 17 is owed for naming an attorney for service only; that letters stay in the file as delivered when no attorney for service is named (art. 40 § 5, in the source's title and quotes).
10. **The assessments show a stand-in fact.** The case records neither where a person files nor the facts each assessment turns on, so each shows the principal's country of residence or citizenships, and every person sees every assessment.
11. **Other ways to Polish citizenship are other routes:** recognition for a person of Polish origin living in Poland, restoration (art. 38) and the grant by the President. A review cannot add a route; each is a new-route request in the app.
12. **A correction no adversarial reviewer saw.** After round 3 the title of `documents-at-the-voivode` gained the copy of the identity document and the lawyer who may certify copies, with one more quote; the session, the proposal check and the quote check read it.
13. **Version 1** still holds 2012-08-15 to 2025-12-31, a past period that an evaluation made today does not select; it was not reviewed.
14. **Production rows were not read.** This session has no database credentials; the proof of publishing is the production build, which runs the migration and fails if the database already holds a version 3.

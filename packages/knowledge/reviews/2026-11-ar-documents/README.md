# Session review 2026-11-ar-documents

The documents of Argentina's one stored route, `ar-mercosur-temporary` ([#527](https://github.com/fernandolisboa/arca/issues/527), spec [#519](https://github.com/fernandolisboa/arca/issues/519)). Version 6 corrects version 4 from its date, 2025-05-29, and version 7 corrects version 5 from its date, 2026-07-31: each keeps every item of the version it corrects and adds the route's official document list, `documents` ([ADR-0032](../../../../docs/adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../../../docs/runbooks/session-rule-review.md#documents)). Every source the documents cite was read on 2026-11-25, São Paulo date, and its `verifiedAt` says so.

## Where the list comes from

All on www.argentina.gob.ar, Argentina's official-domain list:

- Disposición DNM 1637/2022, annex: art. 4, a) (what an applicant under art. 23, l), shows and signs), art. 4, b) (the other categories of art. 23, family reunification among them, add the papers proving the ground), art. 6 (an applicant under 18) and art. 7 (each paper in detail: identity, lawful entry, the criminal record certificates and their 90 days, family records, legalization, translation, disability);
- the migration directorate's service page for this residence;
- Decreto 616/2010, art. 23, for an adult child with a disability.

## What versions 6 and 7 add

The same 20 items in both, ten for the principal and ten for each family member.

- **Everyone:** proof of the fee paid or of an exemption (paid in RaDEX, the online system); a valid identity document (a passport, another document in annex I of the Mercosur travel documents agreement, or a consulate's nationality certificate with a photo); proof of lawful entry; proof of an address in the area of the office handling the application; the sworn statement of no international criminal record.
- **From age 16:** Argentina's criminal record certificate (included in RaDEX; got outside it, valid 90 days); and, possible, a certificate from each country lived in for over a year in the last three years, showing no convictions or pending criminal proceedings.
- **Under 18:** the authorization of one parent or the guardian, signed before a migration officer; for the principal, also a legalized birth certificate and, possible, the instrument appointing a guardian when the parents are not in Argentina. A family member under 18 joins a resident parent, so neither the guardian nor a second birth certificate is listed for them: the family link item already asks for it.
- **Each family member** also hands in the birth or marriage certificate, or the registered cohabiting union record, proving the link with the resident, and, possible, an adult child with a disability the Single Disability Certificate (CUD) or a court ruling.
- Legalization and translation depend on the paper and the country that issued it: an apostille, an Argentine consulate's legalization, or, for a Mercosur paper only, the issuing country's consulate in Argentina; a national public translator's translation unless the paper is in Spanish, and Brazilian passports, identity cards, birth and marriage records and criminal record certificates in Portuguese are exempt (Ley 25.901). So they are notes, not the `apostille` and `translation` fields.

**Brazil's document guide** needs no new version: `birth_certificate`, `marriage_certificate` and `police_certificate` are in it already; the new kinds (`entry_proof`, `argentine_police_certificate`) and the others have no Brazilian issuer.

## Rounds

One adversarial round, one reviewer checking every item, its quotes and its pt-BR text against the sources and looking for anything missing or out of date. No high point. Fixed: the foreign certificate's "no convictions or pending proceedings" and the passport now quote the service page, which says them; the family link's translation is quoted; the minor's birth certificate proves the family link, not a guardianship; the authorization is quoted as one parent's; the foreign certificate's 90 days left the note, since art. 7, f), also accepts one valid at entry (leftover 1); the guardian and the second birth certificate were dropped for family members. The fixes were not read by a second adversarial round; the repository's reviewers, the proposal check and the quote check read them.

The proposal check and the quote check, the app's own (`ARCA_REVIEW_QUOTES=2026-11-ar-documents`, in `apps/api`), pass on the final files. www.argentina.gob.ar answered 500 once for a page an earlier review cites; the next run read it.

## Leftover

1. **Not in the items, for lack of room:** a foreign certificate is valid 90 days unless it states its own validity, and one expired at the start still counts if it was valid at entry and the person has not gone back to that country; the certificate from a country lived in before a last entry into Argentina under age 15 is not asked; the directorate may set 18 instead of 16 for some countries; when names differ between papers, a consular note or a corrected record; the vulnerability certificate (valid 90 days) for a fee exemption; the special electronic address every application sets up; all papers must be originals; a paper from a consulate in Argentina needs the foreign ministry's legalization, save Mercosur; the authorizing parent comes in person with a valid DNI (service page).
2. **Apostille and translation are notes,** so the checklist shows both fields as not known.
3. **Residence abroad over a year** is a possible condition, not computed from the person's recorded residence periods.
4. **The consular path** from abroad (annex, chapter IV) is not listed, as the versions model applying in Argentina.
5. **The directorate may ask for more papers** (service page); none is listed.
6. **Production rows were not read.** This session has no database credentials; the proof of publishing is the production build, which runs the migration.

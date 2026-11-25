# Session review 2026-11-uy-documents

The documents of Uruguay's one stored route, `uy-mercosur-permanent` ([#527](https://github.com/fernandolisboa/arca/issues/527), spec [#519](https://github.com/fernandolisboa/arca/issues/519)). Version 7 corrects version 6 from its date, 2024-12-06: it keeps every item of version 6 and adds the route's official document list, `documents` ([ADR-0032](../../../../docs/adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../../../docs/runbooks/session-rule-review.md#documents)). Every source the documents cite was read on 2026-11-25, São Paulo date, and its `verifiedAt` says so; the sources only version 6's other items cite keep their dates.

## Where the list comes from

- The migration directorate's Residencia Legal Permanente Mercosur page on www.gub.uy (last updated 2026-10-20): its requirements, its minors' requirements and its general notes on originals, marriage certificates, apostille or legalization and translation.
- Decreto N.º 45/023, article 2, a) to d), on impo.com.uy: the identity document, the sworn statement, the criminal record certificates and the vaccination certificate.
- Civil Code, article 280: majority at 18, for the minors' items and the criminal record exemption.

## What version 7 adds

The same 10 items for the principal and for each family member, 20 in all, since everyone applies with the same general requirements.

- **Everyone:** a passport-style photo; a valid passport or identity document in good condition (the one used to book the appointment); the vaccination certificate issued by a vaccination centre in Uruguay (new kind `uruguayan_vaccination_certificate`).
- **From age 18:** criminal record certificates of each country lived in for over six months in the last five years; the sworn statement of no international record (Decreto N.º 45/023, art. 2, b).
- **Married couples:** the marriage certificate, under a year old (`validity` P1Y), shown as possible: the page asks for it where a marriage link is to be proven, and no fact says whether the link is relied on.
- **Under 18:** the birth certificate; and, as possible, the parents' express authorization when they do not consent in person (a power from abroad protocolized by a Uruguayan notary; from abroad or a consulate, valid 180 days), a dead parent's death certificate, and the ruling appointing a guardian.
- **Apostille and translation** are notes, not fields: foreign papers are apostilled or legalized unless issued electronically and verifiable, and translated by a Uruguayan public translator where needed, save Brazil's.

**Brazil's document guide** needs no new version: `police_certificate`, `birth_certificate` and `marriage_certificate` are in it; the vaccination certificate is issued in Uruguay; the rest have no entry yet (leftover 4).

## Rounds

One adversarial round, one reviewer checking every item, its quotes and its pt-BR text against the sources and looking for anything missing. Fixed: the Uruguayan notary applies only to a power from abroad, and the 180 days moved from the `validity` field to the note, since the page dates only authorizations from abroad or made at a consulate; the apostille sentence is now quoted wherever a note claims it; the marriage certificate became possible instead of certain for every married person; the age of 18 is quoted from the Civil Code; "testimonio" reads as a certified copy, not a testimony; the photo no longer claims a 3x4 size; the sworn statement's wording follows the decree; the birth certificate's note carries the electronic exemption; the identity note says an expired booking document is shown with the valid one. The fixes were not read by a second adversarial round; the repository's reviewers, the proposal check and the quote check read them.

The proposal check and the quote check, the app's own (`ARCA_REVIEW_QUOTES=2026-11-uy-documents`, in `apps/api`), pass on the final files.

## Leftover

1. **Apostille and translation are notes,** so the checklist shows both fields as not known: the rule is "apostille or legalization, unless electronic", which the fields cannot hold.
2. **No proof of family link for adults.** The page asks only for the marriage certificate and a minor's birth certificate; a partner's registered recognition (version 6's dependent rules) and an adult child's or parent's link have no paper named.
3. **Versions 4 and 5** (2023-02-17 to 2024-12-06) get no document list: the page read is the current one, and no text read dates its list earlier.
4. **Brazil's guide** has no entry for `photograph`, `identity_document`, `criminal_record_statement`, `parental_authorization`, `death_certificate` or `guardianship_ruling`; a later guide version can add them.
5. **Consular path:** a consulate's certificate and the 30 business days to complete the papers (Decreto N.º 45/023, art. 4) are steps, not papers, and stay in version 6's `where-to-apply`.
6. **Production rows were not read.** This session has no database credentials; the proof of publishing is the production build, which runs the migration.

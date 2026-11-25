# Session review 2026-11-py-documents

The documents of Paraguay's one stored route, `py-mercosur-temporary` ([#527](https://github.com/fernandolisboa/arca/issues/527), spec [#519](https://github.com/fernandolisboa/arca/issues/519)). Version 5 corrects version 4 from its date, 2026-07-01: it keeps every item of version 4 and adds the route's official document list, `documents` ([ADR-0032](../../../../docs/adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../../../docs/runbooks/session-rule-review.md#documents)). Every source the documents cite was read on 2026-11-25, São Paulo date, and its `verifiedAt` says so; the sources only version 4's other items cite keep their dates.

## Where the list comes from

- The migration directorate's Mercosur temporary residence page on migraciones.gov.py: its general requirements 1 to 7, its additional requirements for applicants aged 0 to 17, and its observations on legalization, translation and notarized copies. Its requirements PDF, dated 2026-07-01 and linked from the page, says the same; the versions cite the page, which the app's reader reads.
- Ley N.º 3578/2008 (the Mercosur Residence Agreement), art. 4.1, b) to d), on www.bacn.gov.py: the naturalization certificate and the sworn statement.

## What version 5 adds

The same 12 items for the principal and for each family member, 24 in all, since the directorate asks every applicant, family members included, for the general requirements.

- **Everyone:** a valid identity document of the country of origin (identity card, national identity document or passport), with a copy authenticated by a notary; the birth certificate; the sworn statement of no international records, which the directorate provides; proof of entry or presence in Paraguay.
- **From age 14:** a police or criminal record certificate with national coverage from the issuing country or its consulate in Paraguay, and Paraguay's police certificate for foreigners. Resolución DNM N.º 858/2024 exempts adolescents aged 15 to 18, as each country's law requires, who are nationals of Argentina, Canada, Colombia, Cuba, Spain, Mexico, Nicaragua or Venezuela: for those aged 15 to 17 with any of these nationalities (a family member or a dual national may hold one off the route's list) the foreign certificate shows as possible.
- **Civil status, where it applies:** the marriage certificate for someone married (`person.hasSpouse`); the divorce ruling or the spouse's death certificate for someone not married, shown as possible, since no fact records divorce or widowhood.
- **Naturalization:** the naturalization certificate, for someone who holds a nationality of the eight listed states but none of them from birth.
- **Under 18:** both parents' identity documents; and, as possible, since no fact records who accompanies a minor or whether a parent died, the absent parent's notarized authorization, both parents' notarized authorization for a third person, or a court ruling, and a dead parent's death certificate.
- **Legalization and translation** are notes, not the `apostille` and `translation` fields: a paper issued abroad is legalized or apostilled, and one in a foreign language is translated into Spanish by a public translator, save Brazil's papers in Portuguese.

New kinds: `paraguayan_police_certificate`, `naturalization_certificate`, `parents_identity_copies` and `death_certificate`. **Brazil's document guide** needs no new version: `birth_certificate`, `police_certificate` and `marriage_certificate` are in it; `paraguayan_police_certificate`, `entry_proof` and `criminal_record_statement` are issued in Paraguay; the rest are papers Brazil's guide has no entry for yet (leftover 6).

## Rounds

One adversarial round, one reviewer checking every item, its quotes and its pt-BR text against the sources and looking for anything missing or out of date. No high point. Fixed: the naturalization certificate is now exact (a listed nationality, none from birth) instead of possible for everyone not native; the foreign certificate shows as possible for nationals aged 15 to 17 of the eight exempted countries (Resolución DNM N.º 858/2024); the identity document quotes all three options; the both-parents notarized authorization is quoted, and the title no longer says it is homologated by a court (the page says so, but there was no room for a sixth quote); the parents' residence cards left the minors' identity item, as the page asks for them only when both parents are present; pt-BR wording. Not changed: the divorce or death record's legalization is stated by its own quote ("visado y legalizado o apostillado"). The fixes were not read by a second adversarial round; the repository's reviewers, the proposal check and the quote check read them.

The proposal check and the quote check, the app's own (`ARCA_REVIEW_QUOTES=2026-11-py-documents`, in `apps/api`), pass on the final files.

## Leftover

1. **Not in the items, for lack of room:** the exemption from the foreign certificate for adolescents from any country that issues none at that age (Resolución DNM N.º 858/2024); a court's homologation of both parents' authorization for a third person; the parents' residence or Paraguayan cards when both are present; Mexico's federal and state certificates (Resolución DNM N.º 1272/2024); the agreement's art. 4.1, c), names the country of origin or any country lived in during the 5 years before arrival, where the directorate's page names the issuing country; the directorate may ask for any other paper; minors are exempt from proving solvency.
2. **Apostille and translation are notes,** so the checklist shows both fields as not known.
3. **No separate family-link paper.** The directorate's page asks family members for the same general requirements; the birth and marriage certificates prove the link, and no text read asks for more.
4. **Medical certificate.** The agreement's art. 4.1, e), allows one where national law asks for it; the directorate's page does not, so it is not listed.
5. **The consular path** before entry (agreement, art. 3.1 and 9.2) is not listed, as version 4 models applying in Paraguay.
6. **Brazil's guide** has no entry for `identity_document`, `divorce_or_death_record`, `naturalization_certificate`, `parents_identity_copies` or `death_certificate`; a later guide version can add them.
7. **Version 2's period** (2022-10-19 to 2026-07-01) gets no document list: no text read dates the directorate's list before 2026-07-01.
8. **Family members without a listed nationality** (agreement, art. 9.2) get the same list; the directorate's page is written for nationals of the listed states and no text read gives such family members a different one.
9. **Production rows were not read.** This session has no database credentials; the proof of publishing is the production build, which runs the migration.

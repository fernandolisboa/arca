# Session review 2026-11-pl-documents

The documents of Poland's one stored route, `pl-descent` ([#527](https://github.com/fernandolisboa/arca/issues/527), spec [#519](https://github.com/fernandolisboa/arca/issues/519)). Version 4 corrects version 3 from its date, 2026-01-01: it keeps every item of version 3 and adds the route's official document list, `documents` ([ADR-0032](../../../../docs/adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../../../docs/runbooks/session-rule-review.md#documents)). Every source the documents cite was read on 2026-11-25, São Paulo date, and its `verifiedAt` says so.

## Where the list comes from

All on Poland's official-domain list:

- the citizenship act, Dz.U. 2025 poz. 1611: art. 56 (the application gives the data of the person, the parents and the grandparents, with documents that prove it) and art. 12 (foreign-language documents with a Polish translation by a sworn translator or a consul);
- the form regulation, Dz.U. 2012 poz. 925, and the form's instructions (point 11: civil records, above all birth and marriage records; point 12: the attorney for service);
- the Code of Administrative Procedure, Dz.U. 2025 poz. 1691, art. 40 § 4;
- the stamp duty act, Dz.U. 2026 poz. 1395, arts. 6 and 7 and annex part IV;
- the pages of the Polish consulates in Brazil, the Interior Ministry and the Pomeranian voivode on www.gov.pl.

## What version 4 adds

Every item is the principal's: the route has no dependents, and each person, a minor too, files an application of their own.

- **Everyone:** the application on the official form, filled in only in Polish (with how copies are certified); a current identity document; a birth record, the full record naming the parents for someone born outside Poland; and the documents proving the Polish origin of the parents or grandparents.
- **May apply:** a civil status record (marriage, divorce or the spouse's death), for someone married or once married; the documents of a surname change; information on the attorney for service, for someone living outside Poland and the EU, Switzerland and the EEA's EFTA states with no representative in Poland and not filing through a consul; a power of attorney, when a representative acts; and proof of the stamp duty paid when filing with the voivode.
- The foreign-language and non-EU records (birth, civil status, ancestry, name change) carry one note: a Polish translation by a sworn translator or a consul, and an apostille, or a Polish consul's legalization where the Hague Convention does not apply. These are notes, not the `apostille` and `translation` fields, since both depend on the record: a Polish record needs neither.

**Brazil's document guide** needs no new version. `birth_certificate` is in it already; the new kinds (`citizenship_application_form`, `identity_document`, `civil_status_record`, `ancestry_records`, `name_change_records`, `attorney_for_service_form`, `power_of_attorney`) and `fee_payment_proof` have no Brazilian issuer as such, or no official page read says where (leftover 3).

## Rounds

Three adversarial rounds: one reviewer checked every item, its quotes and its pt-BR text against the sources; one looked for anything official that makes the list out of date or incomplete.

- Round 1. The gap reviewer found the power of attorney and the attorney for service missing, and the birth record wrongly limited to people born abroad. The item reviewer found the same birth record point, the Pomeranian office's practice stated as the general rule, and the apostille and translation flags set where the sources make them depend on the record. It also found the civil status kind too narrow and two pt-BR wordings. All fixed.
- Round 2. Both reviewers found no medium or high point. Low points: the power of attorney's title left out the proof of a legal interest; "name" should be "surname"; and the stamp duty proof ignored the poverty exemption. All fixed.
- Round 3 read those fixes and found two low points, fixed after it (leftover 7): the power of attorney still cited the Pomeranian page, which no longer backs it, and the stamp duty note read as if no duty were due rather than no proof.

Nothing in the citizenship act or the form regulation changed since: the ELI record of the act lists Dz.U. 2025 poz. 921 as its last amending act, and the form regulation is in force.

The quote check, the app's own (`ARCA_REVIEW_QUOTES=2026-11-pl-documents`, in `apps/api`), passed in the session on 2026-11-25 UTC.

## Leftover

1. **The Mazovian voivode's own list is not read.** It decides for someone who never lived in Poland, which is the usual case from Brazil; its pages under www.gov.pl redirect to the home page and its own host refuses the session. The Pomeranian office's practice is named as such.
2. **Apostille and translation are notes,** so the checklist shows both fields as not known.
3. **Brazil's guide does not cover** the new kinds: no Brazilian office issues them as such, or no official page read says where. Brazil's marriage, divorce and death records are issued by the civil registry, but the guide has no entry for `civil_status_record`.
4. **Nothing is listed for a parent filing for a minor.** No official page read names a document the legal representative adds.
5. **The legal-interest path** (someone filing for another person with a court order) is out of the route's scope and not listed.
6. **Production rows were not read.** This session has no database credentials; the proof of publishing is the production build, which runs the migration.
7. **One correction no adversarial round saw:** the two fixes after round 3; only the session, the proposal check and the quote check read the result.

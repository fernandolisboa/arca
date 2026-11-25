# Session review 2026-11-es-documents

The documents of Spain's one stored route, `es-non-lucrative` ([#526](https://github.com/fernandolisboa/arca/issues/526), spec [#519](https://github.com/fernandolisboa/arca/issues/519)). Version 5 corrects version 4 from its date, 2025-06-16: it keeps every item of version 4 and adds the route's official document list, `documents` ([ADR-0032](../../../../docs/adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../../../docs/runbooks/session-rule-review.md#documents)). Every source the documents cite was read on 2026-11-25, São Paulo date.

## Where the list comes from

Spain's official-domain list holds one host, `boe.es`. The list comes from the regulation itself, Real Decreto 1155/2024, in its consolidated text (last update published 2026-09-22): article 38 sets what every residence visa asks for, article 39.1 says the non-lucrative visa application comes with the documents that prove article 38 and the permit's own requirements, and articles 61 to 63 set those requirements. The consulates' own pages (`exteriores.gob.es`) are not on the list.

## What version 5 adds

**Every applicant** (the principal and each family member: article 61.1 speaks of the foreigner "así como sus familiares, que hayan sido autorizados", and under article 63.1 the visa application carries the application for the permit): the application form, filled in and signed (38 a)); a passport or travel document in force, recognized in Spain, valid for at least a year (38 d)); from age 18, proof of no criminal record for offences under Spanish law in the countries lived in during the last five years (38 e), with Código Penal article 19 for the age); a medical certificate under the International Health Regulations of 2005 (38 i)); proof that the visa fee and the permit fee were paid (38 h) and 61.2 e)); and health insurance (61.2 b)).

**Each family member:** proof of the family bond, with the note that at least a year of cohabitation always proves a stable partnership (61.3 a) and b)); and, for an adult, proof of a disability that needs support or of being unable to provide for their own needs for health reasons (61.3 c)), shown as possible for every adult family member, since a document condition cannot tell a child from a spouse.

**The family once:** proof of sufficient means for the permit's period, or of a periodic income, by any proof admitted in law, with what information on accounts abroad must give (62.1 and 62.3); where means are shown with a credit card, the bank's certificate of the credit available (62.3), shown as possible.

**The principal:** where means come from shares in companies based in Spain, their certificate that the applicant does no work in them and a declaración responsable (62.3, last paragraph), shown as possible.

No item sets an apostille, a translation or a validity: no text read states one for this visa.

**Brazil's document guide** needs no new version. The kinds already covered are `passport` and `police_certificate`; the new kinds (`medical_certificate`, `health_insurance`, `fee_payment_proof`, `disability_or_health_proof`, `bank_credit_certificate`, `shareholding_no_work_certificate`) and the ones Portugal added without a guide entry (`visa_application_form`, `family_relationship_proof`, `means_of_subsistence_proof`) have no Brazilian office that issues them as such, or no official page read says where (leftover 3).

## Rounds

Three adversarial rounds: one reviewer checked every item, its quotes and its pt-BR text against the regulation; one looked for anything official that makes the list out of date or incomplete.

- Round 1: the gap reviewer found the family bond missing (high), the adult children's proof missing and the fee payment missing; the item reviewer found the fee payment and the partner's proof missing, that no quote backed the family members' own applications, a "signed" declaration no quote states, a narrowed note on accounts abroad and one pt-BR wording. All fixed: the items `fee-payment`, `family-ties` and `adult-child-condition` were added, and every family member's item now cites articles 61.1 and 63.1.
- Round 2: the gap reviewer found the three new items closed its findings and nothing else missing (articles 26 to 28, 38, 39 and 61 to 63 read again; the BOE's daily summaries of 2026-09-22 to 2026-11-25 hold no amendment and no order setting a visa form or document list). The item reviewer found five low points: the fee quote also matches the renewal's article 64.2 e), the family-ties note read a sufficient proof as the only one, two family items lacked the new citations, and two pt-BR wordings. All fixed.
- Round 3 read those fixes and found one low point: the fee items no longer quoted article 39.1, the passage that asks for the document. It was put back after the round (leftover 9): the principal's item quotes 38 h), the lead-in of 61.2, 61.2 e) and 39.1; the family member's item, at the limit of five quotes, drops the lead-in of 61.2 and keeps 61.1 and 63.1.

The quote check, the app's own (`ARCA_REVIEW_QUOTES=2026-11-es-documents`, in `apps/api`), passed in the session on 2026-11-25 UTC.

## Leftover

1. **The consulates' own list is not read.** `exteriores.gob.es` is not on Spain's official-domain list, which only the app can extend. What a consulate asks beyond the regulation (such as photographs, copies of every passport page or a specific insurance cover) is not listed.
2. **No apostille, translation or validity.** No BOE text applicable to this visa says whether a Brazilian document needs an apostille or a sworn translation into Spanish, or how recent a criminal record or medical certificate must be. The Apostille Convention (BOE-A-1978-24413, article 3) makes the apostille the most a state may ask for, not a duty. The checklist shows each as not known.
3. **Brazil's guide does not cover** the visa form, the medical certificate, the health insurance, the fee payment, the family bond, the adult child's proof, the proof of means, the credit card certificate or the shareholding certificate: no Brazilian office issues them as such, or no official page read says where. A medical certificate comes from any doctor; Brazil's marriage and birth certificates are in the guide under their own kinds, which no Spanish item names, since article 61.3 asks for the bond without naming a document.
4. **The family bond is one item for every family member.** A document condition cannot tell a spouse from a child, so the partner's cohabitation proof is a note, and the adult child's proof shows as possible for an adult spouse too.
5. **Criminal records from Spain are not listed:** the immigration office requests them itself (article 63.3).
6. **Renewal documents** (article 64.3: a copy of the whole passport and a schooling report for minors) are not listed: the route models the initial visa.
7. **The 2027 IPREM or fee version** is now version 6, from its date, and must keep version 5's documents.
8. **Production rows were not read.** This session has no database credentials; the proof of publishing is the production build, which runs the migration.
9. **One correction no adversarial round saw.** The fee items' quotes changed after round 3, as round 3 asked; only the session, the proposal check and the quote check read the result.

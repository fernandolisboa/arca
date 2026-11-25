# Session review 2026-11-dk-documents

The documents of Denmark's one stored route, `dk-pay-limit` ([#527](https://github.com/fernandolisboa/arca/issues/527), spec [#519](https://github.com/fernandolisboa/arca/issues/519)). Version 4 corrects version 3 from its date, 2026-01-01: it keeps every item of version 3 and adds the route's official document list, `documents` ([ADR-0032](../../../../docs/adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../../../docs/runbooks/session-rule-review.md#documents)). Three SIRI pages were read on 2026-11-25, São Paulo date, and their new sources say so; the other sources keep their dates.

## Where the list comes from

- SIRI's Pay Limit Scheme page, "How to apply", step 3: the checklist the applicant submits with the AR1 application, and the sworn declaration for an applicant without MitID.
- SIRI's page on accompanying family of an employee: each family member's own application (MF1), with the papers by tie (spouse or registered partner, cohabiting partner, child), the custody papers and other family's proof of dependence.
- SIRI's documentation requirements: marriage certificates, educational documents and documents on parental custody are always translated by an authorised translator, the original attached with the translation.

## What version 4 adds

23 items: 11 for the principal, 12 for each family member, shown by the member's own facts.

- **Principal:** the fee receipt, a copy of every passport page, the employment contract or job offer; possible, since no fact records them: relevant work experience, relevant education (translated), the Danish authorisation, legal stay when applying from Denmark, salary components the contract omits, a CV, SIRI's sworn declaration without MitID, and one passport photo when applying at a Norwegian mission.
- **Each family member:** the fee receipt of their own application and a copy of every passport page; a spouse the marriage certificate with its translation (possible for a partner, who may be registered); a cohabiting partner the cohabitation proof; a child under 18 the birth certificate, possible since the birthplace is not recorded; with shared custody, possible, the other custody holder's consent and ID copy; with the principal's full custody, the sole-custody proof (translated); other family of 18 or more, the proof of dependence; possible, the sworn declaration without MitID, a passport photo at a Norwegian mission and a power of attorney when a third party represents them.
- **Apostille and validity** are left out: no page states either. Translation is `certified` only for the three kinds SIRI always wants translated by an authorised translator.

Reused kinds: `fee_payment_proof`, `passport`, `photograph`, `employment_contract`, `employment_reference_letter` (work experience), `qualification_proof` (education), `marriage_certificate`, `family_relationship_proof`, `birth_certificate`, `parental_authorization`, `parents_identity_copies` and `power_of_attorney`. New kinds, since no route had them: `professional_authorization` (a Danish authorisation for a regulated job), `legal_stay_proof` (lawful stay in Denmark when applying there), `salary_components_proof` (pay the contract does not state), `curriculum_vitae`, `signed_declaration` (SIRI's own sworn declaration, signed by hand), `custody_proof` (that one parent has full custody, not a guardian's appointment like `guardianship_ruling`) and `dependence_proof` (other family's particular dependence). Translation is `certified`, shown as "certificada": SIRI asks for an authorised translator, not a sworn one, so the notes say "tradutor autorizado". **Brazil's document guide** gets no new version here: entries for the new and reused kinds it lacks, such as diplomas, are left to a later guide version (leftover 5).

## Rounds

One adversarial round, one reviewer checking every item, quote and pt-BR text against the three pages and looking for anything missing. Every quote was found verbatim; no item asked the wrong paper of the wrong person. Fixed: the partnership certificate is now possible for a partner, who may be registered; other family's title follows the page's definition instead of naming a parent; six pt-BR wordings. The repository's reviewers then asked for: the birth certificate as possible (birthplace), existing kinds reused, other family's dependence proof kept, as possible, for a married dependent older than the principal, such as a parent (`person.hasSpouse` reads any spouse, not only the principal's), the passport photo at a Norwegian mission and the family member's power of attorney listed, and the 2027 version named as version 5; done. The fixes were read by the repository's reviewers, the proposal check and the quote check, not by a second adversarial round.

The proposal check and the quote check (`ARCA_REVIEW_QUOTES=2026-11-dk-documents`, in `apps/api`) pass on the final files. `test/dk-pay-limit-documents.test.ts` checks the conditions by tie, age and custody on the review's cases.

## Leftover

1. **Birthplace is not recorded,** so the birth certificate reads as possible for every child under 18; the title states the exception. The page's alternatives (a Certificate of Personal Data, adoption papers) are not items.
2. **Whether the other custody holder comes to Denmark is not recorded,** so the consent and ID copy read as possible with shared custody.
3. **Not listed:** the hotel and restaurant checklist (employment contract only, the company's accounts and staff overview, mostly the employer's papers; no fact gives the job's industry closely enough), the documents a company setting up in Denmark may attach (the employer's), and the principal's power of attorney for the AR6 application, which the page asks of the employer only within the hotel and restaurant checklist.
4. **The 2027 version,** which version 3's leftover 1 owes, is now version 5 and must keep version 4's documents.
5. **Brazil's guide** has no entry for the new kinds; a later guide version can add them.
6. **A dependent's tie to the principal is not a fact:** a married parent or adult child also reads the marriage certificate as possible, and a spouse older than the principal who depends on them reads the dependence proof as possible; a married dependent child younger than the principal gets no dependence proof.
7. **Production rows were not read.** This session has no database credentials; the proof of publishing is the production build, which runs the migration.

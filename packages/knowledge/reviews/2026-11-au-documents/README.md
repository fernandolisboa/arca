# Session review 2026-11-au-documents

The documents of Australia's one stored route, `au-skilled-independent`: the Skilled Independent visa (subclass 189), points-tested stream ([#527](https://github.com/fernandolisboa/arca/issues/527), spec [#519](https://github.com/fernandolisboa/arca/issues/519)). Version 4 corrects version 3 from its date, 2026-07-01: it keeps every item of version 3 and adds the route's official document list, `documents` ([ADR-0032](../../../../docs/adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../../../docs/runbooks/session-rule-review.md#documents)). Every source the documents cite was read on 2026-11-25, São Paulo date, and its `verifiedAt` says so.

## Where the list comes from

All on the Federal Register of Legislation, `legislation.gov.au`, on Australia's official-domain list:

- the Migration Regulations 1994, compilation of 2026-11-03: reg. 1.15C (competent English), reg. 2.03AA (the police statement and form 80, when the Minister asks), reg. 2.07(3) and (4) (the approved form and the residential address), Schedule 1 item 1137(2) (a family member's combined application), Schedule 2 clauses 189.211, 189.221 to 189.225 and 189.312, and Schedule 4 criteria 4005, 4017, 4019 and 4021 and Part 3 (the values statement);
- the Migration (Arrangements for Certain Skilled and Temporary Graduate Visa Applications) Instrument (LIN 20/162) 2020, compilation of 2024-07-01, section 9: an item 1137 application is made on form 1393 (internet), as an internet application;
- the Migration (Specification of Language Tests, Test Scores and Passports) Instrument 2025, section 7 and Schedule 3: the tests and scores for competent English, and the passports of Canada, New Zealand, Ireland, the United Kingdom and the United States.

The visa's page on `immi.homeaffairs.gov.au` writes its steps and document list inside scripts, which the app's reader drops: read through the reader, the page holds only its menus (leftover 1).

## What version 4 adds

Sixteen items, for the principal and for each family member applying:

- **Everyone:** the application on form 1393 over the internet, with the residential address (a family member's is combined with the principal's, before the principal's is decided); a valid passport, unless it would be unreasonable to require one.
- **Principal only:** the Minister's written invitation; the skills assessment, suitable for the nominated occupation, not one made for a subclass 485 visa, within its validity at the invitation; competent English, by a specified test taken in the 3 years before the invitation or by a passport of one of the five countries.
- **When the Minister asks** (`unmodeled`): a statement from an authority such as a police force of a country where the person lives or has lived, which the Minister may waive; form 80; any medical assessment a Medical Officer of the Commonwealth asks for or an instrument specifies.
- **By age:** the values statement, for someone 18 or older; for a child under 18, the consent of each person who can lawfully decide where the child lives, unless home-country law permits the removal or an Australian child order allows the grant (`unmodeled`, since those exceptions are not recorded).

No apostille, translation or validity field is set: no cited source states one.

**Brazil's document guide** needs no new version. `passport` and `police_certificate` are in it already; the new kinds (`invitation_to_apply`, `skills_assessment`, `language_test_result`, `character_form`, `values_statement`) have no Brazilian issuer, and `medical_examination` and `parental_authorization` are not in it, as before.

## Rounds

Two adversarial rounds, one reviewer each, reading every item, its quotes and its pt-BR text against the downloaded provisions and looking within them for a document the list leaves out.

- Round 1. No high finding. Proven and fixed: competent English by passport needs citizenship too, and the test score is a minimum in each component (LIN 25 s. 7(3) and (4)); the passport title left out the excluded class of criterion 4021(a)(iii); the values statement's waiver (4019(2)) and the age at the application were missing; the health title left out "unless a Medical Officer of the Commonwealth decides otherwise" and the follow-up undertaking (4005(1)(aa) and (d)); the principal's application carried the family member's note. Also found: family members not applying must meet the character and health criteria (leftover 4).
- Round 2, on those fixes. All correct. Left: the values statement's condition reads the age on the evaluation date (leftover 3); a pt-BR wording, fixed after the round (leftover 7).

The proposal check and the quote check, the app's own (`ARCA_REVIEW_QUOTES=2026-11-au-documents`, in `apps/api`), passed in the session on 2026-11-25 UTC.

## Leftover

1. **The Home Affairs page is not read.** Its list (identity documents, birth and relationship records, evidence for each points claim, the documents of a de facto relationship, translations into English) is drawn by scripts the app's reader cannot see, so none of it is in the version until an official page the app can read states it.
2. **Personal identifiers** (biometrics, Act s. 257A and reg. 2.04(b)) are not a document and are not listed.
3. **Age at the application.** The values statement asks for 18 at the time of application; the condition reads the age on the evaluation date, as the route's age limit does, so someone who turns 18 before applying does not see it (its note says the age counts at the application) ([OPEN-QUESTIONS](../../../../docs/OPEN-QUESTIONS.md)).
4. **Family members not applying** must also meet the character and health criteria (clauses 189.211(9) and 189.225(3)); the checklist lists only people applying.
5. **An adult family member's functional English**, or the second instalment in its place, is a cost of version 3, not a document.
6. **Production rows were not read.** This session has no database credentials; the proof of publishing is the production build, which runs the migration.
7. **Corrections no adversarial round saw:** the pt-BR of the values statement's note ("motivos relevantes" for "compelling circumstances") and the repository reviewers' fixes, if any; the session, the proposal check and the quote check read the result.

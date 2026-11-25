# Session review 2026-11-cl-documents

The documents of Chile's one stored route, `cl-mercosur-temporary` ([#527](https://github.com/fernandolisboa/arca/issues/527), spec [#519](https://github.com/fernandolisboa/arca/issues/519)). Version 6 corrects version 5 from its date, 2022-05-14: it keeps every item of version 5 and adds the route's official document list, `documents` ([ADR-0032](../../../../docs/adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../../../docs/runbooks/session-rule-review.md#documents)). The migration service's two pages and the Civil Code were read on 2026-11-25, São Paulo date, and their `verifiedAt` says so; the other sources keep their dates.

## Where the list comes from

- The migration service's subcategory 15 page ("Mercosur: Principio de reciprocidad internacional", updated 2025-12-18): the principal's required documents, the passport's year of validity, the 60 days of the criminal record certificate and the general criteria for documents (official translation unless in Spanish or English, apostille or legalization, PDF, 60 days for public bodies' papers).
- The service's dependents page (updated 2025-12-16): each dependent's papers, by tie (spouse or partner; child under 18; child with a disability; child between 18 and 24 studying), and the same general criteria.
- Civil Code, article 26: majority at 18, for "mayores de edad".

## What version 6 adds

15 items: 3 for the principal, 12 for each dependent, shown by the dependent's own facts.

- **Everyone:** a passport valid for a year from the application (a Bolivian may use a valid DNI); a recent photograph to the page's specification.
- **Principal from 18; a spouse, partner or dependent of 18 or over:** the criminal record certificate (`validity` P60D).
- **Spouse:** the marriage certificate. **Partner:** a document proving the cohabitation.
- **Children** (dependents with no spouse or partner): the birth certificate; under 18, the parent's notarized care statement; possible for every child, the couple's marriage or cohabitation proof (only a stepchild needs it) and the disability certificate (no fact records a disability); between 18 and 24 and studying, the enrollment certificate.
- **Spouse, partner, child with a disability or of 18 or over:** the principal's notarized sworn statement to bear the costs and proof of the principal's means by the Social Development Ministry's indicators; possible for minors, since a disability is not recorded.
- **Apostille and translation** are notes, not fields: the pages say "apostille or legalization" and an official translation unless in Spanish or English, which the fields cannot hold.

Version 6 is the route's first document list. It reuses `passport`, `photograph`, `police_certificate`, `marriage_certificate`, `birth_certificate`, `family_relationship_proof`, `means_of_subsistence_proof` and `disability_or_health_proof`, and adds three kinds no route had: `parental_care_statement` (a parent's statement that they care for the child, not a travel authorization like `parental_authorization`), `support_undertaking` (the principal's own statement to bear the costs, not a third party's guarantee like `letter_of_guarantee`) and `enrollment_certificate`. **Brazil's document guide** needs no new version: `passport`, `police_certificate`, `birth_certificate` and `marriage_certificate` are in it; the rest have no entry yet (leftover 4).

## Rounds

One adversarial round, one reviewer checking every item, its quotes and its pt-BR text against the two pages and looking for anything missing. No item asked the wrong paper of the wrong person. Fixed: the enrollment certificate now stops at 24, as the page's heading says; the spouse's and partner's own sentences for the cost statement and the means proof are quoted; every foreign paper's note now carries the general criteria in full (PDF, 60 days for a public body's paper, 30 for a private one), quoted as one passage; the principal's criminal record reads "a country lived in", not "each"; pt-BR wording ("declaração juramentada", gender-neutral notes). The fixes were not read by a second adversarial round; the repository's reviewers, the proposal check and the quote check read them. The reviewers then asked for: a test of the conditions, the principal's certificate no longer citing the agreement (no quote of it), the kinds explained, and pt-BR wording; done.

The proposal check and the quote check, the app's own (`ARCA_REVIEW_QUOTES=2026-11-cl-documents`, in `apps/api`), pass on the final files. `test/cl-mercosur-temporary-documents.test.ts` checks the conditions by tie and age on the review's cases.

## Leftover

1. **Apostille and translation are notes,** so the checklist shows both fields as not known.
2. **Who is a stepchild or has a disability is not recorded,** so the couple's proof for a stepchild and the disability certificate show as possible for every child, and the cost statement and means proof as possible for every minor child.
3. **A child is read as a dependent with no spouse or partner:** no fact gives a dependent's tie to the principal, so a married child would get the spouse's papers.
4. **Brazil's guide** has no entry for `photograph`, `family_relationship_proof`, `parental_care_statement`, `support_undertaking`, `means_of_subsistence_proof`, `disability_or_health_proof` or `enrollment_certificate`; a later guide version can add them.
5. **The agreement's own list** (article 4.1: birth certificate, nationality proof, sworn statement of no international records, medical certificate where required) is not asked for by the service's page, so only the page's list is shown, as version 5's leftover 4 already says for the sworn statement.
6. **The means proof for a partner** is a reading: the spouse-or-partner section says "su cónyuge" for the means, and the same section covers the partner.
7. **Back to 2022-05-14:** the pages were updated in December 2025 and no earlier list was found, so version 6 applies it from the route's start, like version 5.
8. **New regulations announced, not published** (version 5's leftover 3): the revised Decreto N.º 177 may change the list.
9. **Production rows were not read.** This session has no database credentials; the proof of publishing is the production build, which runs the migration.

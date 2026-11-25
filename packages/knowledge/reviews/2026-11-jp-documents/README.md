# Session review 2026-11-jp-documents

The documents of Japan's one stored route, `jp-nikkei-long-term-resident`: long-term resident status (teijusha) for the third generation of Japanese descent (sansei), with spouse and children ([#527](https://github.com/fernandolisboa/arca/issues/527), spec [#519](https://github.com/fernandolisboa/arca/issues/519)). Version 5 corrects version 3 from its date, 2026-10-01, and version 6 corrects version 4 from its date, 2027-03-19: each keeps every item of the version it corrects and adds the route's official document list, `documents` ([ADR-0032](../../../../docs/adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../../../docs/runbooks/session-rule-review.md#documents)). Every source the documents cite was read on 2026-11-25, São Paulo date, and its `verifiedAt` says so.

## Where the list comes from

All on hosts of Japan's official-domain list:

- the Enforcement Ordinance of the Immigration Act on e-Gov, revisions in force from 2026-10-01 (v5) and 2027-03-19 (v6): art. 6-2(1) and (2) (the application for a certificate of eligibility on form 6-3, a photo taken in the 6 months before, the papers of appended table III), table III's long-term resident row, and table IV (the agent who may apply in Japan for this status: a relative living in Japan);
- the Immigration Act, art. 6(1): a valid passport with a visa from a Japanese consular officer;
- the Immigration Services Agency's pages on `moj.go.jp` for a certificate of eligibility: a sansei applicant (`longtermresident_01`), the spouse of a sansei who works for a company (`03_1`) or has no job (`03_3`), a minor unmarried biological child supported by a long-term resident (`04_1`, with the notes of `04`), and an adopted child under 6 supported by one (`05_2`).

The agency's pages answer the app's reader, which names itself (`Arca-rule-check/1`), and Node's `fetch`; plain `curl` gets a CloudFront 403.

## What the versions add

Thirty-nine items in version 5, for the principal and for each family member; version 6 adds six.

- **Everyone:** the application on form 6-3 (from abroad, a relative living in Japan files it), one photo, a return envelope, a letter of guarantee from a guarantor living in Japan, and a valid passport with a Japanese visa.
- **Principal:** the Japanese grandparent's family register record; the birth certificates of the parents and of the applicant and the marriage certificates of the grandparents and parents, from the home country; official records that the grandparents and parents existed and of the applicant's identity; a criminal record certificate; proof of means (own bank balance and a job offer in Japan, or a payer's Japanese tax certificates). Only where they exist or apply (`unmodeled`): Japanese notification certificates, the certificate of acknowledgment (ninchi), the resident record of whoever the applicant lives with in Japan, and proof of Japanese for a 5-year stay (adults only).
- **Spouse** (`person.hasSpouse`): marriage and birth certificates, the questionnaire (it has a Portuguese version), evidence of the couple's contact, criminal record certificate, identity records, proof of Japanese for a 5-year stay; a Japanese marriage notice certificate only if filed in Japan.
- **Children:** birth certificate and a statement of why the child must be supported; for a biological child of Japanese descent, criminal record certificate, identity records and the ancestors' records only when supported by a long-term resident (`unmodeled`, as the case does not say whether a spouse's child is of Japanese descent); for an adopted child, the adoption certificate.
- **The supporter's papers from Japan** (`unmodeled`): resident tax and tax payment certificates, resident record, proof of work.
- **Version 6** adds, from table III as amended from 2027-03-19, for the principal and each family member: documents on yearly income; tax and social insurance records; and, if someone else pays or supports, that person's income, tax and social insurance records.

Validity: certificates issued in Japan, 3 months from issue (`P3M`), on every item the agency's pages give it to. No apostille is set; no cited source states one. Translation: the agency asks for a Japanese translation of any paper in a foreign language, which is neither certified nor sworn, so the `translation` field is left out and each foreign document's note says it.

**Brazil's document guide** needs no new version: `birth_certificate`, `marriage_certificate`, `passport` and `police_certificate` are in it already; the new kinds are issued in Japan (`japanese_family_register`, `japanese_notification_certificate`, `resident_record`, `local_tax_certificate`, `letter_of_guarantee`) or are papers the family writes or gathers (`return_envelope`, `relationship_questionnaire`, `relationship_evidence`, `support_reason_statement`, `tax_social_insurance_records`), and `identity_document`, `ancestry_records`, `paternity_acknowledgment` and `adoption_decree` were not in it before either.

**Code:** the quote check now reads full-width digits (`３か月`, `１８歳`) as plain ones ([ADR-0027 amendment](../../../../docs/adr/0027-admins-and-the-checked-batch-activation.md#amendment-2026-11-25-full-width-digits)), which the agency's pages use for every figure.

## Rounds

One adversarial round, one reviewer, reading every item, its quotes and its pt-BR text against the downloaded pages and ordinance, and looking for a document the lists leave out. No high finding. Proven and fixed: the supporter items said "if the supporter already lives in Japan", which no page states (now "from their municipal office in Japan", still `unmodeled`); the minor child's deadline is the day before turning 18, not the birthday, and only for a biological child; pt-BR wordings ("exigido", "de nacionalidade japonesa", "certificado de reservista", "estadia"). Accepted as leftovers: 2, 6 and 7 below. Every fix after the round is listed in leftover 8.

The proposal check and the quote check, the app's own (`ARCA_REVIEW_QUOTES=2026-11-jp-documents`, in `apps/api`), passed in the session on 2026-11-25 UTC.

## Leftover

1. **The visa itself.** The certificate of eligibility is shown at a Japanese embassy or consulate to apply for the visa; the consulate's own list and fee are on `mofa.go.jp` and the embassy's site, not on the `jp` official-domain list, which only the app can extend.
2. **Validity the address hides.** The echo rule refuses any quote on a page whose address holds the value, and the spouse pages' addresses (`03_1`, `03_3`) hold a 3, so the spouse's Japanese marriage notice certificate carries no 3-month validity and the supporter items cite the child pages for it. The photo's 6 months stay in its title only, as both cited addresses hold a 6.
3. **The pages assume a supporter in Japan.** The spouse and child pages are written for a family member joining a long-term resident already in Japan; for a family landing together, the supporter's Japanese certificates do not exist yet, so those items are `unmodeled`. A change of status or an extension (in Japan) has its own list, not in these versions.
4. **The agency's lists from 2027-03-19** are not published yet; version 6 adds what table III as amended states, beside the agency's current lists.
5. **A child of the principal is shown "may apply"** for the criminal record certificate, identity records and ancestors' records: the pages ask them of a child of Japanese descent supported by a long-term resident, which the principal's own child always is, but a condition cannot tell the principal's child from the spouse's.
6. **Optional and in-Japan papers left out:** a passport copy when the name's spelling differs between the certificate and the passport ("if possible"), and the validity of the supporter's proof of work and of a job offer issued in Japan, which the 3-month line may cover.
7. **Version 6's tax and social insurance records** apply to every family member, an infant too, as table III reads for each applicant.
8. **Corrections no adversarial round saw:** the round's fixes above and the repository reviewers' fixes, if any; the session, the proposal check and the quote check read the result.
9. **Production rows were not read.** This session has no database credentials; the proof of publishing is the production build, which runs the migration.

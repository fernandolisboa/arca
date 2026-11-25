# Session review 2026-11-lv-documents

The documents of Latvia's one stored route, `lv-capital-investment` ([#527](https://github.com/fernandolisboa/arca/issues/527), spec [#519](https://github.com/fernandolisboa/arca/issues/519)). Version 6 corrects version 5 from its date, 2026-09-15: it keeps every item of version 5 and adds the route's official document list, `documents` ([ADR-0032](../../../../docs/adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../../../docs/runbooks/session-rule-review.md#documents)). Every source the documents cite was read on 2026-11-25, São Paulo date, and its `verifiedAt` says so.

## Where the list comes from

All on `likumi.lv`, Latvia's one official domain:

- Cabinet Regulations No. 564 of 2010 on residence permits (id 212441), which the Immigration Law's transitional provision keeps in force until the new regulations, at the latest until 1 December 2027: points 11 (how long certificates stay valid), 28 and 29 (the documents of any request), 37 (foreign military service), 40 and 41 (family members) and 73 (what is handed in on receiving the permit);
- Cabinet Regulations No. 591 of 2008 on health insurance (id 179063), points 7 and 9;
- the Official Language Law (id 14740), art. 10, and Cabinet Regulations No. 291 of 2000 on certified translations (id 10127);
- the Immigration Law (id 370622), art. 27(3) and transitional provision 3, and the Law on the Protection of the Rights of the Child (id 49096), art. 3.

## What version 6 adds

- **Everyone, the investor and each family member:** a valid travel document; the request form; a photograph; the payment of the state fee when filing at a mission (may apply); the means of subsistence (valid three months); health insurance with a liability limit of at least EUR 42,600 for the whole stay, shown on receiving the permit; and the documents of the place of residence (may apply, valid three months).
- **May apply to everyone:** a police certificate, for someone over 14 needing a visa, from the countries of citizenship or of a stay over 12 months (certified translation, valid six months); a document on foreign military service other than compulsory service in the last five years (certified translation, valid six months); and a Latvian health certificate on receiving the permit, not needed for a permit asked again in time (valid six months).
- **Family members:** a copy of the marriage document, for a spouse; the documents of kinship, for a minor child; the consent of the parent who stays, for a minor child (may apply, notarised or signed before an official, valid six months); and the court ruling on guardianship or curatorship, for a family member under it (may apply).
- Translations are `certified`: the Official Language Law accepts a foreign-language document only with a translation certified as Regulations No. 291 set, or notarised.

**The quote check reads Latvian number words** from this review on (`packages/domain/src/quote-check/number-words.ts`): point 11 writes the validity as "trīs mēnešus" and "sešus mēnešus", and Latvian numbers decline, so the table holds the forms of each unit by gender and case.

**Brazil's document guide** needs no new version. `passport`, `police_certificate` and `marriage_certificate` are in it already; the other kinds have no Brazilian issuer as such, or are Latvian (the health certificate) or the parents' own (the consent).

## Rounds

Three adversarial rounds: one reviewer checked every item and its quotes against the pages; one looked for anything official that makes the list out of date or incomplete.

- Round 1. The gap reviewer found the validity of point 11, the foreign military service of point 37 and the certified translation of the Official Language Law missing, and the curatorship ruling limited to adult children. The item reviewer found the means of subsistence asked once for the family instead of per person, the health certificate stated as always needed, quotes that did not back the health insurance, and kinship and consent items that also caught a married child. All fixed.
- Round 2. The gap reviewer asked for the translation on the means of subsistence (fixed) and on the health insurance (leftover 4), and noted the military record's six months (leftover 7). The item reviewer found the health insurance's "on receiving the permit" and "for the whole stay" unquoted: the first is quoted again, the second left the title, since the route's health insurance assessment already holds it and an item takes at most five quotes.
- Round 3 found nothing medium or higher. Its low points, fixed after it: the health insurance cited the Immigration Law with no quote from it, and two leftovers misread art. 10(4) and point 15.

The quote check, the app's own (`ARCA_REVIEW_QUOTES=2026-11-lv-documents`, in `apps/api`), passed in the session on 2026-11-25 UTC.

## Leftover

1. **Originals or certified copies** (point 10) are not an item of their own.
2. **A minor travelling without the parents** (point 43) is not listed: the route covers the investor's own family.
3. **The documents of a permit asked again** are not listed; the list is for a first permit.
4. **Translation is set on the items usually issued abroad.** Art. 10(3) of the Official Language Law asks a certified translation of any foreign-language document; a policy from a foreign insurer needs one too, though the health insurance item does not carry the field, while art. 10(4) lets the Office accept and examine documents received from abroad without a translation. A passport translation may not be certified (Regulations No. 291, point 2.1).
5. **No apostille or legalisation rule** was found in the texts read, so `apostille` is not set: the checklist shows it as not known.
6. **The marriage condition** asks only whether the person has a spouse, so it also fires for a married child, who is not a family member on the route.
7. **The military record's six months** read point 11.3 as written; a discharge paper is often older, and 11.3 leaves out archive certificates, so the Office may accept an older one.
8. **The investment's own documents** are not listed: Regulations No. 564 name none for this ground, and the Office checks the investment.
9. **Production rows were not read.** This session has no database credentials; the proof of publishing is the production build, which runs the migration.

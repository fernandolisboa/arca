# Session review 2026-11-uy

Uruguay has one stored route, `uy-mercosur-permanent`: permanent residence for nationals of the Mercosur states parties and associated states, under Ley N.º 18.250, article 33, literal B, as worded by Ley N.º 20.075, article 169, and Decreto N.º 45/023. Its newest version, 3, effective 2023-02-17, was read on 2026-11-20 against the IMPO article pages of Ley N.º 18.250 (articles 10, 33, 45 and 46, current and original wording), Ley N.º 20.075, Ley N.º 20.212, Decreto N.º 45/023, the Mercosur Residence Agreements (Ley N.º 17.927), Ley N.º 18.246, Decreto N.º 394/009 and the Civil Code, and the migration directorate's pages on www.gub.uy ([ADR-0032](../../../../docs/adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../../../docs/runbooks/session-rule-review.md)).

Version 3 matched the law on who qualifies, the family of article 10 and of the agreements' article 9.2, the partner's five years and registered recognition, and majority at 18. Versions 4 to 6 correct and complete it.

## Version 4, correcting version 3 from 2023-02-17

- **Articles 45, C, and 46 as first worded.** Ley N.º 20.212 reworded both from 2024-01-01 (its article 2); version 3 used the new wording from 2023. Until 2023-12-31 a prosecution or conviction counted by the penalty under Uruguayan law, the five years ran from the sentence, and an expulsion had no three-year lapse. The two assessments now cite `/bases/leyes-originales/18250-2008/45` and `/46`.
- **New assessments** from Decreto N.º 45/023, article 2, c) and d), article 4, and the directorate's page: `criminal-record-certificates` (each country lived in for over six months in the last five years; not for applicants under 18), `vaccination-certificate` (issued by a vaccination centre in Uruguay), `documents` (originals, identity document or passport, any marriage certificate under a year old, apostille or legalization unless verifiable online, translation save Brazil's papers), `minor-applicants` (birth certificate, the parents' express consent in person or by a power notarized in Uruguay, valid 180 days), `where-to-apply` (the Ministry of the Interior or a consulate, 30 business days after entry to complete, a decision within 90 business days) and `fees-in-indexed-units`.
- **Fees.** The schema cannot hold an amount in indexed units (leftover 1), so `fees-in-indexed-units` states them in its title: 557.30 UI for the residence, none for Brazilians and Paraguayans by reciprocity (Decreto N.º 45/023, article 8), 55.70 UI for the migration certificate, and 225.60 UI for each re-entry permit while the application is pending.

## Version 5, from 2024-01-01

Version 4 with articles 45, C, and 46 as Ley N.º 20.212, articles 158 and 155, word them: a charge (`formalizadas`) or conviction, the penalty under the law of the place of the crime, five years from when the sentence was served, and an administrative expulsion on other grounds lapsing after three years.

## Version 6, from 2024-12-06

Version 5 with Panama, an associated state of Mercosur since 2024-12-06 (Presidency of the Republic), shown as possible: article 33, B, names the associated states without a list, while the directorate's pages still list eleven countries and no reciprocity agreement with Panama was found.

## Rounds

Two reviewers in round 1, one checking each item against its provision, the other looking for anything official that makes the route out of date; the first again in round 2, on the changes.

- **Round 1.** Proven and fixed: Panama was a silent "no"; version 4 gave the 2023 period the 2024 wording of articles 45 and 46; `documents` read as if every applicant needs a marriage certificate and left out the exemption for papers verifiable online. The second reviewer found no amendment of articles 10, 33, 45 or 46 or of Decreto N.º 45/023 after Ley N.º 20.212; Ley N.º 20.446 (2025) rewords only articles 24 and 26; Decretos N.º 138/024 and 239/026 serve asylum seekers who cannot use article 33; Ley N.º 20.531 (2026) has no migration article.
- **Round 2**, on the changes: no defect. No third round was needed.

The proposal check and the quote check, which reads the official pages through the app's reader (`ARCA_REVIEW_QUOTES=2026-11-uy`), pass on the final files.

## Leftover

1. **Fees in indexed units.** A UI amount has two decimals and the currency code UYI none, so no version has a cost; the fees are in an assessment's title ([OPEN-QUESTIONS](../../../../docs/OPEN-QUESTIONS.md)). The amounts are the directorate's page of 2026-10-20; no official text gives earlier ones, so versions 4 and 5 repeat them.
2. **Panama** shows as possible, not eligible, until the directorate lists it: the app reads "Faltam informações" with no fact to supply, as for every unmodeled condition.
3. **Naturalized nationals.** Article 33, B, asks only for the nationality; the agreements' article 2 counts a naturalized national after five years, which no fact reads, so every listed citizenship counts, as in version 3.
4. **Family members with a listed nationality of their own** qualify under article 33, B, themselves; the dependent rules still show them by the principal's nationality, as in version 3.
5. **Procedure not modeled:** Decreto N.º 45/023, article 6 (the directorate may decide after 365 days without the missing papers), and article 2, e) (the police checks within 15 business days).
6. **Uruguay's temporary Mercosur residence** (two years, extendable), on the directorate's page, is a route the catalog does not have; a new route goes through the app.
7. **Facts no route records:** each family member's own criminal records, vaccination certificate and papers, and who holds parental authority, so the assessments show principal-level facts as evidence.
8. **Leap day.** `unsettled`, as in version 3.
9. **The source `ley-17927-nationals`** is kept, uncited by any item, for leftover 3.
10. **Production rows were not read.** This session has no database credentials; the proof of publishing is the production build, which runs the migration.

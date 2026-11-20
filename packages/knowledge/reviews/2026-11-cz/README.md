# Session review 2026-11-cz

The Czech Republic has one stored route, `cz-eu-blue-card`: the EU Blue Card (Aliens Act No. 326/1999 Sb., §§ 42i and 42j) with family reunification (§§ 42a and 42b). Its newest version, 4, effective 2026-05-01, was read on 2026-11-20 against the Aliens Act as in force since 2026-06-12, the Act on Administrative Fees (No. 634/2004 Sb., version of 2026-09-01), the Ministry of Labour's communication No. 44/2026 Sb., Decree No. 205/2023 Sb., the Employment Act (No. 435/2004 Sb.), Directive (EU) 2021/1883 and the Ministry of the Interior's information portal ([ADR-0032](../../../../docs/adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../../../docs/runbooks/session-rule-review.md)). Version 5 corrects version 4 from the same date.

Version 4 matched the law on the pay threshold (1.5 times CZK 590,580, so CZK 885,870 a year from 2026-05-01 to 2027-04-30), the contract of at least 6 months, the high qualification and the ICT skill route, the regulated professions, the family income test, the spouse, minor children and the spouse's, the same-sex partner of § 180f, the 90-day decisions, the 3-year card, the citizenship requirement and the fee amounts. Nothing published up to 2026-11-20 changes them: the Aliens Act has no later version, no new wage communication is out, and the fees act's items 116 and 162 read the same in its versions of 2028.

## Version 5, correcting version 4 from 2026-05-01

- **Health ground** (§ 42a(1)(d)): a parent or an adult child of any age who cannot care for themselves for health reasons may join. The act asks for no financial dependence, so every parent other than a lone one of 65 or more, and every child of 18 or more, now reads as possible; version 4 left out those not recorded as depending on the principal.
- **Fees by where one may file:** § 42i(3) lets a holder of another EU state's Blue Card apply in Czechia within a month of entry, and asylum holders too, so the embassy fees are definite only for someone living outside the EU, EEA and Switzerland, and the in-country fees are possible for someone living in them. The in-country fee's title now lists who may file there.
- **New assessments:** `not-excluded` (§ 42i(1)(a) to (d): research permit applicants, EU long-term residents of another state here for work or business, treaty traders, posted workers), `accommodation` and `criminal-record` (§ 31(1)(d) and (g), through §§ 42j(1)(a) and 42b(1)(a)), `travel-health-insurance` (§§ 42j(2), 42b(5) and 180j(1), (4) and (5)) and `family-documents` (§ 42b(1)(b) and (c)).
- **New costs:** `appointment-order-fee` and `family-appointment-order-fee`, tariff item 162(d), CZK 1,000 for an order to book the in-person filing at an embassy that books that way, for the principal and for each family member: possible.
- **Durations:** both decision titles add the 30 days, 60 in complex cases, for a holder of another EU state's Blue Card and for that holder's family (§ 169t(6)(c) and (e)).
- **Sources:** all read again on 2026-11-20 and dated so; four Aliens Act provisions added (§§ 31, 42j(1)(a) and (2), 42b(1)(a) to (c) and (5), 180j); the Civil Code is no longer cited, since its page is too long for the reader and the portal states the age of 18; the directive gets its HTML address as the machine-readable one. Every item cites its passages in `cz-eu-blue-card.5.evidence.json`.

## Rounds

Two reviewers in round 1, one checking each item against its provision, the other looking for anything official that makes the route out of date; the first again in round 2, on the changes.

- **Round 1.** Proven and fixed: the health ground tied to financial dependence; the in-country fee's title naming too few who may file there, and the fee conditions that ignored them. Omissions fixed: the § 42i(1) exclusions, the family documents, the appointment-order fee, comprehensive cover for family members and the 30-day family decision. The second reviewer read the Collection of Laws to act No. 223 of 2026, the versions of the fees act to 2028, the Employment Act's version of 2027 and the portal's news since 2025-12-30: nothing changes the route.
- **Round 2**, on the changes. Fixed: comprehensive cover limited to adult family members and waived for the publicly insured; the appointment-order fee also for each family member; `not-excluded` narrowed to posting by an EU employer and keeping intra-company transferees; subsidiary protection named in the in-country fee.
- **Round 3**, on those fixes: no defect.

The proposal check and the quote check (`ARCA_REVIEW_QUOTES=2026-11-cz`) pass on the final files.

## Leftover

1. **Version 6, from 2027-05-01, is owed**, with the Ministry of Labour's communication of the 2026 average wage, usually published in March.
2. **The 65th birthday.** § 42a(1)(d) says "starším 65 let" (older than 65) and the portal "over 65"; the version counts a lone parent from the 65th birthday, so on that one day it may read a parent as a dependent a stricter reading would not.
3. **The portal's readings beyond the act:** it attaches "lone" to the health ground and asks a financially dependent adult child; the version follows the act and shows both as possible.
4. **Not modeled:** foster children and minors under guardianship (§ 42a(1)(c)) read as children only when the case records them as such; a second spouse in a polygamous marriage (§ 42a(8)); no proof of qualification after 2 years with another EU state's Blue Card (§ 42j(4)); under the portal, a child under 18 needs travel cover for 90 days only, which the reader cannot quote from the portal's tabs.
5. **The portal's tabs** (applying in Czechia, from abroad) are not in the text the app's reader takes from the page, so fees and documents are evidenced from the acts.
6. **Production rows were not read.** This session has no database credentials; the proof of publishing is the production build, which runs the migration.

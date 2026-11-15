# cz-eu-blue-card

Research notes for Czechia's EU Blue Card, route `cz-eu-blue-card` in `packages/knowledge/data/routes`. The seed research is in [other-destinations.md](../other-destinations.md); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-15

A corrector run ([ADR-0029](../../adr/0029-correction-requests-and-the-corrector-session.md)), for version 4, which the independent check flagged and no record named: pull request [#423](https://github.com/fernandolisboa/arca/pull/423) wrote it to add the machine-readable addresses of the Aliens Act (`{0..3}`) and the Employment Act (`{0..1}`) to version 3, with no audit.

- **Version audited:** 4
- **Outcome:** no change.
- **Sources re-read** (on 2026-11-15 UTC, with `curl`):
  - The Aliens Act at 2026-06-12, whole, through its four pages of the e-Sbírka fragment API, the version's machine-readable address: §§ 42i and 42j read in full, the rest searched for the Blue Card's terms. The act's current text is still the one of 2026-06-12 (`datumUcinnostiZneniOd`).
  - The Ministry of the Interior's Blue Card page on `ipc.gov.cz`, whole.
  - Not re-read in full: the other sources, all verified on 2026-11-11 (the Directive on 2026-11-07). The API's metadata shows each cited act's current text still starting on the date the last audit read: Communication No. 44/2026 Sb. on 2026-03-24, Decree No. 205/2023 Sb. on 2023-07-01, the Employment Act on 2026-07-01, the Civil Code on 2026-01-01, and the fees act on 2026-09-01. No version changes, so no `verifiedAt` moves.
- **Amendments looked for**, up to 2026-11-15: the Aliens Act's related-documents list (`souvislosti`). Act No. 314/2025 Sb. is still the last act that amends it. Of the later acts listed, Government Regulation No. 212/2026 Sb., published and not yet in force, sets up a special work visa for agriculture and does not touch the Blue Card.
- **Leads:** version 4, flagged by the independent check, report of 2026-11-14: `assessment:contract` differs; could not be checked: `requirement:not-eu-eea-or-swiss-citizen`, `assessment:highly-qualified-job`, `assessment:family-income`, `dependent:children`, `dependent:spouse-children`, `dependent:parents`, `dependent:partner-children`, the five costs, `duration:validity` and `countrySet:eu-free-movement/2`. Not confirmed: § 42j(1)(b) states "nejméně 6 měsíců na zákonem stanovenou týdenní pracovní dobu", as the item says. The portal's opening summary still says "at least one year", while its list of documents says 6 months: the act decides, as the last audit found.
- **Findings:** none. The contract item is right, and the run below confirmed it.
- **Check loop:** run [43677144219](https://github.com/fernandolisboa/arca/actions/runs/43677144219) on `main`'s version 4: 12 of 23 match, none differs, `assessment:contract` among the matches. The run on this record's own head, the final one, is in the pull request's body. Left over:
  - `unreadable`: `dependent:children` and `dependent:partner-children`, whose age of majority rests on the Civil Code, § 30. It has 11 pages in the API, over the 10 a source may name, and its page gave no text.
  - `checker-gap`: `requirement:not-eu-eea-or-swiss-citizen` (the passages given held neither § 1 of the Aliens Act nor the Directive) and `assessment:highly-qualified-job` (the passages held § 42i(1) but not (11)(b), the central register). Both are run-to-run variance from the passage locator over a four-page act.
  - `checker-gap`: the five costs. The model found each amount in the fees act's tariff items but would not join it to the Aliens Act's conditions on who pays where, which sit in another act.
  - `checker-gap`: `duration:validity`. The passages given held § 44, but not paragraph (7).
  - `checker-gap`: the pinned set `eu-free-movement` v2, as in earlier audits.
- **Watch next:** as the last audit left it. The portal's summary still says one year.

### 2026-11-11

The first audit ([#360](https://github.com/fernandolisboa/arca/issues/360)), on demand, in one pull request with the Danish, Latvian, Georgian and Icelandic routes ([Danish](dk-pay-limit.md), [Latvian](lv-capital-investment.md), [Georgian](ge-property-short-term.md) and [Icelandic](is-remote-work.md) records).

- **Version audited:** 2
- **Outcome:** correction, version 3 (pull request [#394](https://github.com/fernandolisboa/arca/pull/394)), from version 2's date, 2026-05-01, which it replaces entirely. It pins the EU, EEA and Swiss set at version 2.
- **Sources re-read** (all on 2026-11-11 UTC with `curl`):
  - The Aliens Act (No. 326/1999 Sb.), the text in force since 2026-06-12, whole, through the four pages of the e-Sbírka fragment API. §§ 1, 42a, 42b, 42i, 42j, 44, 169t, 178a and 180f are now one source each, cited by the dated address with its anchor. The text in force from 2026-01-01 to 2026-06-11, read the same way, words every one of them the same, so the correction holds from 2026-05-01.
  - Communication No. 44/2026 Sb. (the average wage), Decree No. 205/2023 Sb. (professional skill), the Employment Act (No. 435/2004 Sb.), § 3, and the Civil Code (No. 89/2012 Sb.), § 30, through the same API.
  - New: the Act on Administrative Fees (No. 634/2004 Sb.), the text in force since 2026-09-01, whole; tariff items 116 and 162. The text in force on 2026-05-01 gives the same amounts in items 116(1)(a) and (b) and 162(a) and (c).
  - New: the Ministry of the Interior's portal pages on the Blue Card and on the long-term residence permit for family reunification (`ipc.gov.cz`), whole.
  - Not re-read: Directive (EU) 2021/1883 (`blue-card-directive`), which keeps its date; version 3 changes nothing that rests on it.
  - Not readable: none.
- **Amendments looked for**, up to 2026-11-11: the related-documents list (`souvislosti`) of the Aliens Act and of the fees act. The Aliens Act's current text is the one Act No. 314/2025 Sb. left in force on 2026-06-12, with no later version announced. Constitutional Court judgment No. 140/2026 Sb. rejected a challenge to § 169r, which this route does not use. The fees act changes again on 2028-01-01, and item 162 stays as it is. Communication No. 44/2026 Sb. is unchanged.
- **Leads:** none.
- **Findings:**
  - Missing, now costs: the fee for the Blue Card application (CZK 5,000 at an embassy, item 162(c); CZK 2,500 in Czechia, item 116(1)(a), shown as possible since the case does not say where the application is filed) and for each family member's permit (CZK 2,500 at an embassy; in Czechia CZK 2,500, or CZK 1,000 under 15).
  - Missing, now durations: the decision within 90 days (§ 169t(6)), for the principal and for the family, and the card's validity of up to 3 years (§ 44(7)).
  - Missing, now dependents shown as possible: the partner in an officially confirmed same-sex union and that partner's children under 18 (§ 180f), which version 2 left out ([OPEN-QUESTIONS](../../OPEN-QUESTIONS.md)).
  - Corrected: the leap-day convention. No Czech text read says on which day a person born on 29 February completes a year of age in a common year; `leapDayBirthday` is now `unsettled`, and the case of a child born on 29 February moved from "excluded" to "possible" on 28 February.
  - Split: the one assessment of version 2 is now the job, the contract, the pay, the qualification, the professional skill that may replace it and the regulated profession, each citing only what states it; the family's income is an assessment of its own.
  - Confirmed, unchanged: the 6-month contract (§ 42j(1)(b); the portal's opening summary still says one year, while its list of documents says 6 months), the pay of 1.5 times the average wage (CZK 590,580 from 2026-05-01 to 2027-04-30), the spouse, the children under 18, and the lone parent over 65.
- **Check loop:** runs [43085585954](https://github.com/fernandolisboa/arca/actions/runs/43085585954) (version 2, 0 of 10 items: the e-Sbírka pages are drawn by scripts and gave no text), [43087381074](https://github.com/fernandolisboa/arca/actions/runs/43087381074) (4 of 23, 1 differs), [43088296917](https://github.com/fernandolisboa/arca/actions/runs/43088296917) (4 of 23, none differs) and, after review, [43090845128](https://github.com/fernandolisboa/arca/actions/runs/43090845128) and [43091465538](https://github.com/fernandolisboa/arca/actions/runs/43091465538) on the final head (0 of 23 each, none differs). Five runs in all, over the runbook's three and one: review changed the versions after the third, and a fourth run on the reviewed head was followed by small logic fixes, so a fifth ran on the final head. The first two runs read the Aliens Act, the Employment Act and the Civil Code through single pages of the fragment API; review held that against the runbook, which never names one page of a paged API, so version 3 names a machine-readable address only for the acts the API serves on one page. Fixed on the way: the contract item, which the check read against the portal's summary ("one year") rather than its list of documents ("6 months"), now cites the act alone. Left over:
  - `unreadable`: the items that rest on the Aliens Act, the Employment Act or the Civil Code, whose pages are drawn by scripts and whose API answers come in pages the runbook does not let a source name ([OPEN-QUESTIONS](../../OPEN-QUESTIONS.md)): `requirement:not-eu-eea-or-swiss-citizen` as far as the act goes, `assessment:highly-qualified-job`, `assessment:contract`, `assessment:pay` (the communication confirms the CZK 590,580), `assessment:regulated-profession`, `assessment:family-income`, the six dependent rules (§ 180f was confirmed while page 3 was named), `duration:decision`, `duration:family-decision` and `duration:validity`. The audit read each of these provisions whole through the API with `curl`.
  - `checker-gap`: the five costs, whose tariff items sit at the end of the fees act, past where the checker cuts it; the pinned set `eu-free-movement` v2, as in earlier audits.
- **Watch next:**
  - The average wage communication for 2027-05-01 onward: version 4, due by 2027-05-01.
  - The fees act's text of 2028-01-01.
  - The guide `cz` version 1 did not list the fees act; version 2 adds it, in a pull request of its own.

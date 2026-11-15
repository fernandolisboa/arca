# cz-eu-blue-card

Research notes for Czechia's EU Blue Card, route `cz-eu-blue-card` in `packages/knowledge/data/routes`. The seed research is in [other-destinations.md](../other-destinations.md); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-15

A corrector run ([ADR-0029](../../adr/0029-correction-requests-and-the-corrector-session.md)), for version 4, which the independent check flagged. Pull request [#423](https://github.com/fernandolisboa/arca/pull/423) wrote version 4 as a correction of version 3 that only adds machine-readable addresses for the Aliens Act (`{0..3}`) and the Employment Act (`{0..1}`), and no audit record named version 4 before this one.

- **Version audited:** 4
- **Outcome:** no change.
- **Sources re-read** (on 2026-11-15 UTC, with `curl` on the e-Sbírka API, from the saved text):
  - The Aliens Act at 2026-06-12, all four pages of its fragment API. Read in full: the provisions the version cites, § 1 (`aliens-act-eu-citizens`), § 42a (`aliens-act-family`), § 42b (`aliens-act-family-income`), § 42i (`aliens-act-blue-card`), § 42j (`aliens-act-blue-card-contract`), § 44 (`aliens-act-validity`), § 169t (`aliens-act-time-limits`), § 178a (`aliens-act-lone`) and § 180f (`aliens-act-partnership`). The rest of the act was searched for the Blue Card's terms, not read line by line. Its current text is still the one of 2026-06-12.
  - `fees-act-consular` and `fees-act-in-country`: the Act on Administrative Fees, text of 2026-09-01, tariff items 116 and 162.
  - `civil-code-age`: the Civil Code, § 30, on the first of its 11 API pages.
  - `ipc-blue-card`: the Ministry of the Interior's Blue Card page, whole, with `curl`.
  - Not readable: none. As before, `civil-code-age` has no machine-readable address: its 11 pages are over the 10 a source may name, and its cited page is drawn by scripts.
  - Not re-read in full: `mpsv-average-wage-2025`, `professional-skill-decree`, `employment-act-eu-citizens` and `ipc-family`, all verified on 2026-11-11, and `blue-card-directive`, verified on 2026-11-07. The API's metadata shows each cited act's current text starting on the same date as when the last audit read it: Communication No. 44/2026 Sb. on 2026-03-24, Decree No. 205/2023 Sb. on 2023-07-01 and the Employment Act on 2026-07-01. No version changes, so no `verifiedAt` moves.
- **Amendments looked for**, up to 2026-11-15: the Aliens Act's related-documents list (`souvislosti`). Act No. 314/2025 Sb. is still the last act that amends it. Of the later acts listed, Government Regulation No. 212/2026 Sb., in force from 2027-01-01, sets up a special work visa for agriculture and does not touch the Blue Card. The API's metadata shows no text of the fees act after 2026-09-01 and none of the Civil Code after 2026-01-01.
- **Leads:** version 4, flagged by the independent check, report of 2026-11-14: `assessment:contract` differs; could not be checked: `requirement:not-eu-eea-or-swiss-citizen`, `assessment:highly-qualified-job`, `assessment:family-income`, `dependent:children`, `dependent:spouse-children`, `dependent:parents`, `dependent:partner-children`, `cost:blue-card-fee-embassy`, `cost:blue-card-fee-in-czechia`, `cost:family-fee-embassy`, `cost:family-fee-in-czechia`, `cost:family-fee-in-czechia-under-15`, `duration:validity` and `countrySet:eu-free-movement/2`. The official text does not bear out the difference: § 42j(1)(b) requires a contract "na dobu nejméně 6 měsíců na zákonem stanovenou týdenní pracovní dobu", which is what the item says. The portal's opening summary still says "at least one year", while its list of documents says 6 months. The act decides, as the last audit found. A web search for 2026 changes to the Blue Card found only the yearly pay threshold from 2026-05-01, CZK 73,823 a month, which is 1.5 times Communication No. 44/2026 Sb.'s CZK 590,580 a year divided by 12, as the version has it.
- **Findings:** none.
- **Check loop:** three runs on version 4, none with an item differing, `assessment:contract` matching in each: [43677144219](https://github.com/fernandolisboa/arca/actions/runs/43677144219) on `main` (12 of 23), [43677613444](https://github.com/fernandolisboa/arca/actions/runs/43677613444) (11 of 23) and [43677864144](https://github.com/fernandolisboa/arca/actions/runs/43677864144) (10 of 23). The run on this record's own head, the final one, is in the pull request's body. Left over, across the runs:
  - `unreadable`: `dependent:children`, `dependent:spouse-children` and `dependent:partner-children`, whose age of majority rests on Civil Code § 30 (18 years), with no machine-readable address (above). The check got no text from its page. `dependent:spouse-children` matched in the first run.
  - `checker-gap`: `requirement:not-eu-eea-or-swiss-citizen`. § 1(2) and (3) state it, but the passages given did not hold § 1. The Directive's EUR-Lex page also gave the check no text (HTTP 202).
  - `checker-gap`: `assessment:highly-qualified-job`. § 42i(1) and (11)(b) state it, but in every run the passages held (1) and not (11)(b), the central register.
  - `checker-gap`: `assessment:family-income`. § 42b(1)(d) states it, but in the last run the passages held only the start of § 42b. It matched in the first two runs.
  - `checker-gap`: `cost:blue-card-fee-embassy` and `cost:blue-card-fee-in-czechia`. Tariff items 162(c) and 116(1)(a) state the amounts (CZK 5,000 and 2,500), and the model found them. The passages given did not hold the `ipc-blue-card` page's list of who may apply in Czechia.
  - `checker-gap`: `cost:family-fee-embassy`, `cost:family-fee-in-czechia` and `cost:family-fee-in-czechia-under-15`. Tariff items 162(a) and 116(1)(a) and (b) state the amounts (CZK 2,500, 2,500 and 1,000), and the `ipc-family` page states the same fees. The check found the tariff amounts but did not tie them to a Blue Card holder's family, or to who may apply in Czechia, from the passages it was given.
  - `checker-gap`: `duration:validity`. § 44(7) states it, but the passages held § 44 without paragraph (7).
  - `checker-gap`: the pinned set `eu-free-movement` v2. The pages given do not carry the set's whole member list: the EU page lists the 27 member states, and the others treat the EEA and Switzerland in general terms.
- **Watch next:**
  - The average wage communication for 2027-05-01 onward: a new version, which will be version 5, due by 2027-05-01. The record below and OPEN-QUESTIONS still call it version 4, from before #423.
  - The fees act's text of 2028-01-01.
  - The portal's opening summary, which still says one year.

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

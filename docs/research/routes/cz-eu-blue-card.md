# cz-eu-blue-card

Research notes for Czechia's EU Blue Card, route `cz-eu-blue-card` in `packages/knowledge/data/routes`. The seed research is in [other-destinations.md](../other-destinations.md); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-11

The first audit ([#360](https://github.com/fernandolisboa/arca/issues/360)), on demand, in one pull request with the Danish, Latvian, Georgian and Icelandic routes ([Danish](dk-pay-limit.md), [Latvian](lv-capital-investment.md), [Georgian](ge-property-short-term.md) and [Icelandic](is-remote-work.md) records).

- **Version audited:** 2
- **Outcome:** correction, version 3 (pull request [#394](https://github.com/fernandolisboa/arca/pull/394)), from version 2's date, 2026-05-01, which it replaces entirely. It pins the EU, EEA and Swiss set at version 2.
- **Sources re-read** (all on 2026-11-11 UTC with `curl`):
  - The Aliens Act (No. 326/1999 Sb.), the text in force since 2026-06-12, whole, through the four pages of the e-Sbírka fragment API. §§ 1, 42a, 42b, 42i, 42j, 44, 169t, 178a and 180f are now one source each, cited by the dated address with its anchor and read through the API page that holds the provision whole.
  - Communication No. 44/2026 Sb. (the average wage), Decree No. 205/2023 Sb. (professional skill), the Employment Act (No. 435/2004 Sb.), § 3, and the Civil Code (No. 89/2012 Sb.), § 30, through the same API.
  - New: the Act on Administrative Fees (No. 634/2004 Sb.), the text in force since 2026-09-01, whole; tariff items 116 and 162.
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
- **Check loop:** runs [43085585954](https://github.com/fernandolisboa/arca/actions/runs/43085585954) (version 2, 0 of 10 items: the e-Sbírka pages are drawn by scripts and gave no text), [43087381074](https://github.com/fernandolisboa/arca/actions/runs/43087381074) (4 of 23, 1 differs) and [43088296917](https://github.com/fernandolisboa/arca/actions/runs/43088296917) (4 of 23, none differs). Fixed on the way: the machine-readable addresses; the contract item, which the check read against the portal's "one year" summary, now says which part of the page says what. Left over:
  - `checker-gap`: the 18 items that rest on the Aliens Act or on the fees act. The Aliens Act's API page is 1.3 MB of JSON with no headings and the fees act keeps its tariff at the end, so the checker cuts both before the provision cited ([OPEN-QUESTIONS](../../OPEN-QUESTIONS.md)): `assessment:highly-qualified-job`, `assessment:contract`, `assessment:pay` (the communication confirmed the CZK 590,580), `assessment:regulated-profession`, `assessment:family-income`, the six dependent rules (§ 180f itself was read and confirmed), the five costs, `duration:decision` and `duration:family-decision`; and the pinned set `eu-free-movement` v2, as in earlier audits. The audit read each of these provisions whole from the same API.
- **Watch next:**
  - The average wage communication for 2027-05-01 onward: version 4, due by 2027-05-01.
  - The fees act's text of 2028-01-01.
  - The guide `cz` does not list the fees act: a version 2 of the guide, in a pull request of its own.

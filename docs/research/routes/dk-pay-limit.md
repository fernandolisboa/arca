# dk-pay-limit

Research notes for Denmark's Pay Limit Scheme, route `dk-pay-limit` in `packages/knowledge/data/routes`. The seed research is in [other-destinations.md](../other-destinations.md); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-11

The first audit ([#360](https://github.com/fernandolisboa/arca/issues/360)), on demand, in one pull request with the Czech, Latvian, Georgian and Icelandic routes ([Czech record](cz-eu-blue-card.md)).

- **Version audited:** 1
- **Outcome:** correction, version 2 (pull request [#394](https://github.com/fernandolisboa/arca/pull/394)), from version 1's date, 2026-01-01, which it replaces entirely. It pins the EU, EEA and Swiss set at version 2.
- **Sources re-read** (all on 2026-11-11 UTC with `curl`):
  - The Aliens Act (consolidated Act No. 953 of 2026), LexDania XML, whole; §§ 1, 2, 9 a, 9 h and 9 m are cited. Every retsinformation source now names its `/xml` address as the machine-readable one, since the page itself is drawn by scripts.
  - The EU Residence Order (Order No. 1457 of 2020), §§ 1 and 2, with its amending Order No. 965 of 2025, which changes §§ 14, 18, 24, 26, 29 to 31 and 36 to 38 and none of what the route cites; the Guardianship Act (consolidated Act No. 1122 of 2021), § 1.
  - SIRI's pages on the Pay Limit Scheme and on accompanying family of employees, whole.
  - New: Order No. 1612 of 2025 on fees (`fee-order-principal`, `fee-order-family`), § 5, found through § 9 h of the act.
  - Not readable: none.
- **Amendments looked for**, up to 2026-11-11: retsinformation's document search for acts amending the Aliens Act after the consolidation. Act No. 765 of 8 September 2026 adds a collective-agreement scheme for certified companies (a new § 9 a(2)(15), DKK 322,000) and renumbers the subsections of § 9 a; it comes into force on 2027-01-01. Act No. 263 of 2026 changes only § 25 a. SIRI still shows the 2026 pay limit, DKK 552,000; the 2027 amount is not published.
- **Leads:** none.
- **Findings:**
  - Missing, now costs: the application fee for 2026, DKK 6,810 for the principal (Order No. 1612 of 2025, § 5(2)(1)) and DKK 3,080 for each family member (§ 5(5)(1)).
  - Missing, now durations: SIRI's processing time, normally 1 month and up to 3; the permit, for the employment period and normally 4 years at most.
  - Corrected: the leap-day convention. No Danish text read says on which day a person born on 29 February turns a year older in a common year; `leapDayBirthday` is now `unsettled`, and the case of a child born on 29 February moved from "excluded" to "possible" on 28 February.
  - Split: `employment-terms` is now the working hours, the Danish bank account, the usual pay and terms, and the genuine offer; the shared home is an assessment of its own.
  - Confirmed, unchanged: the pay limit, the citizenship rule, and the family rules (a spouse married at 18 or over, a cohabiting partner over 18 after 2 years, shown as possible from 1.5 years or in a registered partnership, and children under 18).
- **Check loop:** runs [43085585954](https://github.com/fernandolisboa/arca/actions/runs/43085585954) (version 1, 0 of 9 items: the retsinformation pages gave no text), [43087381074](https://github.com/fernandolisboa/arca/actions/runs/43087381074) (8 of 16, 1 differs) and [43088296917](https://github.com/fernandolisboa/arca/actions/runs/43088296917) (12 of 16, none differs), and after review [43090845128](https://github.com/fernandolisboa/arca/actions/runs/43090845128) and [43091465538](https://github.com/fernandolisboa/arca/actions/runs/43091465538) on the final head (6 of 16 each, none differs); the Aliens Act's long XML gives the locator different passages each run. Five runs in all, over the runbook's three and one: review changed the versions after the third, and a fourth run on the reviewed head was followed by small logic fixes, so a fifth ran on the final head. Fixed on the way: the machine-readable addresses; the partner item, which the check read as a flat two years against SIRI's "1.5 to 2 years", now says how the rule treats each length. Left over:
  - `checker-gap`: `assessment:pay-limit`, `assessment:genuine-offer` and `assessment:no-social-assistance`, whose provisions (§ 9 a(2)(3), (4), (26) and (29)) sit in the Aliens Act's long XML after the point where the checker cuts it ([OPEN-QUESTIONS](../../OPEN-QUESTIONS.md)); SIRI's page confirmed the DKK 552,000. The pinned set `eu-free-movement` v2, as in earlier audits.
- **Watch next:**
  - Version 3, due before 2027-01-01, is not written now although Act No. 765 of 2026 is published: a version from 2027-01-01 needs the 2027 pay limit and fees, which SIRI and the ministry have not published, and with 2026's amounts it would show wrong figures from that day. It brings SIRI's 2027 pay limit, the 2027 fee order that replaces Order No. 1612 of 2025, and the subsection numbers Act No. 765 of 2026 gives § 9 a. The collective-agreement scheme it adds is another route.
  - The guide `dk` does not list the fee order: a version 2 of the guide, in a pull request of its own.

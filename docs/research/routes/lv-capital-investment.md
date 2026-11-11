# lv-capital-investment

Research notes for Latvia's temporary residence permit for an investment in a company's share capital, route `lv-capital-investment` in `packages/knowledge/data/routes`. The seed research is in [other-destinations.md](../other-destinations.md); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-11

The first audit ([#360](https://github.com/fernandolisboa/arca/issues/360)), on demand, in one pull request with the Czech, Danish, Georgian and Icelandic routes ([Czech record](cz-eu-blue-card.md)).

- **Version audited:** 3
- **Outcome:** correction, version 4 (pull request [#394](https://github.com/fernandolisboa/arca/pull/394)), from version 3's date, 2026-09-15, which it replaces entirely. It pins the EU, EEA and Swiss set at version 2.
- **Sources re-read** (all on 2026-11-11 UTC with `curl` on `likumi.lv`):
  - The Immigration Law (id 370622), whole, in the redaction in force since 2026-09-15; arts. 1, 2, 27, 28, 29 and 33 are cited, each provision now a source of its own.
  - The Civil Law, family part (id 90223), arts. 219 to 221.
  - New: Cabinet Regulations No. 731 of 2024 on the state fee for migration services (id 356656), whole.
  - No longer cited: the Administrative Procedure Law (below).
  - Not readable: none.
- **Amendments looked for**, up to 2026-11-11: the law's list of redactions (2026-06-27, 2026-08-26, 2026-09-15 and, announced, 2027-12-31) and its amending laws. Art. 27(1) point 36, the EUR 150,000 state-fund permit, is still in the text. No Cabinet regulations under art. 28 were found.
- **Leads:** the bill sent to committee on 2026-09-10 that would delete point 36, and private pages about it; nothing official confirms it passed.
- **Findings:**
  - Missing, now costs: the state fee for examining the request (EUR 160 in 30 days, EUR 280 in 10 working days, EUR 560 in 5; Regulations No. 731, point 5.1), for the principal and for each family member, and the EUR 2,000 paid on a repeated permit after five years (art. 29(3)), shown as possible.
  - Missing, now durations: the Office's answer within 30 days (art. 33(1) point 1) and the permit of up to two years (art. 27(1) point 10).
  - Missing, now assessments: no more than ten investors holding permits through the same company, and no suspension by the Cabinet (art. 28).
  - Corrected: the leap-day convention. The Administrative Procedure Law counts procedural terms, not ages, and no Latvian text read says on which day a person born on 29 February turns a year older in a common year; `leapDayBirthday` is now `unsettled`. The cases already showed such a child as possible on 28 February.
  - Split: the definition of a family member (art. 1(1) point 8), the renewal, the time limit and the suspension are sources of their own.
  - Confirmed, unchanged: the EUR 50,000 or EUR 100,000 investment with the EUR 10,000 payment, the company's size and taxes, the exclusion of Russian and Belarusian citizens, and the family rules.
- **Check loop:** runs [43085585954](https://github.com/fernandolisboa/arca/actions/runs/43085585954) (version 3, 5 of 12 items), [43087381074](https://github.com/fernandolisboa/arca/actions/runs/43087381074) (9 of 18) and [43088296917](https://github.com/fernandolisboa/arca/actions/runs/43088296917) (8 of 18); none differs, and 11 items matched in at least one run. The law is one long page, and the passage locator does not pick the same passages each run ([OPEN-QUESTIONS](../../OPEN-QUESTIONS.md)). Left over:
  - `checker-gap`: `requirement:not-eu-eea-or-swiss-citizen`, `dependent:spouse`, `dependent:children` and `dependent:spouse-children`, each a chain of art. 27(3), the definitions of art. 1 and, for children, the Civil Law, which the locator never gave together; `assessment:no-suspension`, since no page can show that a regulation does not exist; `duration:permit`, whose "two years" the law writes in words; the pinned set `eu-free-movement` v2, as in earlier audits.
  - Matched in one run only: `requirement:capital`, `requirement:not-russian-or-belarusian`, `cost:state-fee`, `cost:family-state-fee` and `cost:renewal-payment`.
- **Watch next:**
  - The redaction of 2027-12-31 and the Cabinet's art. 28 regulations, due by 2027-12-01: a suspension that names a country is a new version.
  - Regulations No. 731 of 2024 lose force on 2027-12-02: the fees need a new source by then.
  - The fund bill: if point 36 is deleted, nothing changes here, since this route never modeled the fund.

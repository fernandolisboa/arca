# us-eb5

Research notes for the U.S. EB-5 immigrant investor route, route `us-eb5` in `packages/knowledge/data/routes`. The seed research and the gaps known since version 1 are in [us.md](../us.md#eb-5-investor-green-card); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-10

The first full audit by the runbook ([#355](https://github.com/fernandolisboa/arca/issues/355)), on demand.

- **Version audited:** 2, and version 1, which is the version in effect until 2026-11-29.
- **Outcome:** three corrections (pull request [#367](https://github.com/fernandolisboa/arca/pull/367)). Version 3 corrects version 1 from its own date, 2024-04-01. Version 4 corrects version 3 from 2025-11-12, the day USCIS went back to the fees in effect until 2024-03-31. Version 5 corrects version 2 from its own date, 2026-11-30.
- **Sources re-read** (all on 2026-11-10, with `curl`):
  - `usc-1153`, `usc-1101`, `usc-1101-leap-day`: the 2024 edition pages on govinfo.gov, read whole. No 2025 edition is published (its address redirects).
  - `usc-1186b` (new): the 2024 edition page, read whole.
  - `cfr-204-6`: the eCFR versioner text on 2026-09-30, the title's latest issue date (a later date answers 404).
  - `cfr-106-2`: the eCFR versioner text on 2024-03-31, 2024-04-01, 2026-09-29 and 2026-09-30.
  - `cfr-22-1` (new): the eCFR versioner text of 22 CFR 22.1 on 2024-04-01, 2025-11-12 and 2026-10-19.
  - `fee-rule-2026`: the govinfo HTML of 91 FR 61940 read whole, and its Table 1 (images ER30SE26.019 and .020 from img.federalregister.gov, listed by the Federal Register API), read as images.
  - Not re-read: `fee-rule-2024` (2026-11-05), cited only by version 3 for the period it was in force.
- **Amendments looked for**, up to 2026-11-10:
  - eCFR versions of 8 CFR 204.6 (last amended 2020-10-02), 106.2 (2026-04-29, 05-29, 08-10, 08-31, 09-09 and 09-30, none of them to the EB-5 fees in force), 216.6 (2026-09-30, the EB-5 fee rule from 2026-11-30) and 22 CFR 22.1 (item 32 unchanged since 2024).
  - Federal Register API, from 2025-01-01, for "EB-5", "regional center", "immigrant investor", "investment amount", "204.6", "Gold Card" and the CPI adjustment; the public inspection list of 2026-11-10. No technical amendment with the 2027 investment amounts. Found: the proposed rule of 2026-07-02 below, the e-filing interim rule of 2026-08-11 (91 FR 51924; 8 CFR 1, 103 and 106: USCIS may require online filing), and the public charge rule in force from 2026-09-18 (91 FR 45324; 8 CFR 103 and 212), which concerns admissibility, not the route.
  - Public laws: no amendment of 8 U.S.C. 1153 or 1186b after the 2024 edition was found; the leads below agree that Congress has not extended the regional center program or the grandfathering date.
- **Leads:**
  - Law firm and fund pages on the 2027 CPI adjustment, projecting USD 900,000 to 937,500 (TEA) and 1.2 to 1.25 million. No official text gives the amounts yet; nothing changes.
  - A news summary of a DHS proposal for USD 1.4 million. Confirmed as a proposal only: 91 FR 40676 (2026-07-02) would set USD 1,400,000 for a high employment area (INA 203(b)(5)(C)(iv)), move the EB-5 rules from 8 CFR 204.6 to a new subpart D (204.401 and on), and require the investment to stay in place on the filing date. Comments closed 2026-08-31; no final rule.
  - Industry pages on the regional center program ending 2027-09-30 and on H.R. 6992 (2026), an advisory committee bill. No law extends the program.
  - Executive Order 14351, "The Gold Card" (90 FR 46031, 2025-09-24), and the information collection for its immigrant petition: a separate path under EB-1 and EB-2, not EB-5. Not audited here; it would be a route of its own.
- **Findings:**
  - Fees from 2025-11-12 to 2026-11-29: the fee rule says USCIS went back on 2025-11-12, after the stay in *Moody v. Noem*, to the EB-5 fees in effect until 2024-03-31, and its Table 1 gives them: Form I-526 and I-526E USD 3,675, Form I-829 USD 3,750, Integrity Fund fee USD 1,000. Version 1 still charged USD 11,160. Version 4 has the reverted amounts. Table 1's heading says "Reinstated on Nov. 13, 2025" while the text says 2025-11-12 three times; the text's date is used.
  - The EB-5 Integrity Fund fee of USD 1,000 for each regional center petition (8 U.S.C. 1153(b)(5)(J)(ii)(II), from 2022-10-01) was missing from version 1. Versions 3 and 4 add it; version 5 already had USD 1,100.
  - The investor's engagement in the enterprise, through management or policy making, which 8 CFR 204.6(j)(5) requires, was missing. It is now the assessment `engagement`.
  - The lawful source of funds now cites the statute, 8 U.S.C. 1153(b)(5)(L)(i), which also covers the money paid for the investment's fees and costs; the title says so.
  - `at-risk` now says the capital must be expected to stay invested for at least 2 years (1153(b)(5)(A)(i)); `job-creation` now says the investor's spouse, sons and daughters do not count (1153(b)(5)(A)(ii)).
  - Costs missing from every version, now added: Form I-829 (USD 9,525 in version 3, 3,750 in version 4, 5,000 in version 5); the employment-based immigrant visa application fee, USD 345 per person (22 CFR 22.1, item 32(b)); and the USCIS immigrant fee, USD 235 per person (8 CFR 106.2(c)(3)), both for a family that gets its visas at a consulate abroad.
  - The two years of conditional residence (8 U.S.C. 1186b(a)(1) and (d)(2)) are now a duration.
  - Unchanged and confirmed: the capital amounts, the child definition and the dependents (1101(b)(1)(A) to (E), 1153(d)), the leap-day convention, the regional center fees of version 2.
  - Gaps kept, as in [us.md](../us.md#eb-5-investor-green-card): ages at the evaluation date rather than the Child Status Protection Act age (1153(h)); a father's child born out of wedlock; stepchildren of an earlier marriage; a proxy marriage that was not consummated (1101(a)(35)); the high employment area amount, which DHS has never set.
- **Watch next:**
  - The 2027-01-01 CPI amounts ([#219](https://github.com/fernandolisboa/arca/issues/219)): a version 6 from 2027-01-01 that keeps version 5's additions. The open question on versions that must stop on a date is in [OPEN-QUESTIONS.md](../../OPEN-QUESTIONS.md).
  - The final rule after 91 FR 40676: it would replace the citations of 8 CFR 204.6, may carry the 2027 amounts, and may set the high employment area amount.
  - The regional center program ends 2027-09-30 unless Congress extends it: then a version from 2027-10-01 keeps only the standalone Form I-526 (USD 7,615, no Integrity Fund fee).
  - USCIS's e-filing interim rule: whether Forms I-526, I-526E or I-829 must be filed online.
  - The country guide gains the 2026 proposed rule and the fee stay in version 2 ([#368](https://github.com/fernandolisboa/arca/pull/368)).

# us-eb5

Research notes for the U.S. EB-5 immigrant investor route, route `us-eb5` in `packages/knowledge/data/routes`. The seed research and the gaps known since version 1 are in [us.md](../us.md#eb-5-investor-green-card); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-10

The first full audit by the runbook ([#355](https://github.com/fernandolisboa/arca/issues/355)), on demand.

- **Version audited:** 2, the newest, and version 1, the version in effect until 2026-11-29, since the errors found are in both.
- **Outcome:** correction, version 3, of version 1 from its own date, 2024-04-01; correction, version 4, of version 3 from 2025-11-12, the day USCIS went back to the fees in effect until 2024-03-31; correction, version 5, of version 2 from its own date, 2026-11-30. All three in pull request [#368](https://github.com/fernandolisboa/arca/pull/368), one pull request for the route.
- **Sources re-read** (all on 2026-11-10 UTC, with `curl`):
  - `usc-1153`, `usc-1101`, `usc-1101-leap-day`: the 2024 edition pages on govinfo.gov, read whole. No 2025 edition is published (its address redirects to an error page).
  - `usc-1186b` (new): the 2024 edition page, read whole.
  - `cfr-204-6`: the eCFR versioner text on 2026-09-30, and the eCFR renderer page on 2026-11-06, the day title 8 is up to date as of (a later date answers 404). Its machine-readable address is that renderer page.
  - `cfr-106-2`: the eCFR versioner text on 2024-03-31, 2024-04-01, 2026-09-29 and 2026-09-30, and the renderer page on 2026-11-06. The text of 2024-03-31 prints the enjoined 2020 amounts (USD 4,010 and 3,900), so it is no source for the fees then in force.
  - `cfr-22-1` (new): the eCFR versioner text of 22 CFR 22.1 on 2024-04-01, 2025-11-12 and 2026-10-19, and the renderer page on 2026-11-06.
  - `fee-rule-2026`: the govinfo HTML of 91 FR 61940 read whole, and its Table 1 (images ER30SE26.019 and .020 from img.federalregister.gov, listed by the Federal Register API), read as images.
  - `fee-rule-2016` (new): the govinfo HTML of 81 FR 73292, its dates and fee table.
  - Not readable: none tried this time. uscis.gov stays unreadable (the reading recipes).
  - Not re-read: `fee-rule-2024` (2026-11-05), cited only by version 3 for the period it was in force; it gets no machine-readable address until a session re-reads it.
- **Amendments looked for**, up to 2026-11-10:
  - eCFR versions of 8 CFR 204.6 (last amended 2020-10-02), 106.2 (2026-04-29, 05-29, 08-10, 08-31, 09-09 and 09-30, none of them to the EB-5 fees in force), 216.6 (2026-09-30, the EB-5 fee rule from 2026-11-30) and 22 CFR 22.1 (item 32 unchanged since 2024).
  - Federal Register API, from 2025-01-01, for "EB-5", "regional center", "immigrant investor", "investment amount", "204.6", "Gold Card" and the CPI adjustment; the public inspection list of 2026-11-10. No technical amendment with the 2027 investment amounts and no correction of 91 FR 61940. Found: the proposed rule below, the e-filing interim rule of 2026-08-11 (91 FR 51924; 8 CFR 1, 103 and 106: USCIS may require online filing), and the public charge rule in force from 2026-09-18 (91 FR 45324; 8 CFR 103 and 212), which concerns admissibility, not the route.
  - Public laws: govinfo has no U.S. Code edition after 2024, and the Federal Register searches found no act amending 8 U.S.C. 1153 or 1186b. govinfo's public-law collection needs an API key, so this negative rests on those searches and on the leads below.
- **Leads:**
  - Law firm and fund pages on the 2027 CPI adjustment, projecting USD 900,000 to 937,500 (TEA) and 1.2 to 1.25 million. No official text gives the amounts yet; nothing changes.
  - A news summary of a DHS proposal for USD 1.4 million. Confirmed as a proposal only: 91 FR 40676 (2026-07-02) would set USD 1,400,000 for a high employment area (INA 203(b)(5)(C)(iv)), move the EB-5 rules from 8 CFR 204.6 to a new subpart D (204.401 and on), and require the investment to stay in place on the filing date. Comments closed 2026-08-31; no final rule.
  - Industry pages on H.R. 6992 (2026), an advisory committee bill, and on calls to extend the regional center program. No law extends it.
  - Executive Order 14351, "The Gold Card" (90 FR 46031, 2025-09-24), and the information collection for its immigrant petition: a separate path under EB-1 and EB-2, not EB-5. Not audited here; it would be a route of its own.
  - Before 2024, Form I-829 carried a separate USD 85 biometric services fee per person; whether USCIS collects it with the reverted fees is not in the rule's text or Table 1. Not modeled.
- **Findings:**
  - Fees from 2025-11-12 to 2026-11-29: 91 FR 61940 says USCIS went back on 2025-11-12 (four times in its text), after the stay in *Moody v. Noem*, to the EB-5 fees in effect until 2024-03-31, and would still take the 2024 fee for items postmarked before 2025-11-26. The lower fee is enough from 2025-11-12, so version 4 starts then; the 2025-11-26 date in [us.md](../us.md#eb-5-investor-green-card) is the end of that grace period for the higher fee. Table 1 gives the reverted fees (Form I-526 and I-526E USD 3,675, Form I-829 USD 3,750, Integrity Fund fee USD 1,000), and 81 FR 73292, the 2016 fee rule, states the first two in its text. Version 1 still charged USD 11,160. Table 1's heading says "Reinstated on Nov. 13, 2025"; the text's date is used.
  - The EB-5 Integrity Fund fee of USD 1,000 for each regional center petition (8 U.S.C. 1153(b)(5)(J)(ii)(II), from 2022-10-01) was missing from version 1. Versions 3 and 4 add it as a possible cost, since their petition fee covers both forms and a standalone Form I-526 investor does not pay it; its title says so. Version 2 already had USD 1,100 as a certain cost under its regional center assumption, and version 5 keeps it.
  - The investor's engagement in the enterprise, through management or policy making, which 8 CFR 204.6(j)(5) requires, was missing. It is now the assessment `engagement`.
  - The lawful source of funds now cites the statute, 8 U.S.C. 1153(b)(5)(L)(i), which also covers the money paid for the investment's fees and costs; the title says so.
  - `at-risk` joined two provisions; it is now `at-risk` (8 CFR 204.6(j)(2)) and `investment-term`, the expectation that the capital stays invested for at least 2 years (1153(b)(5)(A)(i)). `job-creation` now says the investor's spouse, sons and daughters do not count, from the same provision as the 10 jobs (1153(b)(5)(A)(ii)).
  - Costs missing from every version, now added: Form I-829 (USD 9,525 in version 3, 3,750 in version 4, 5,000 in version 5), with its filing window from 1186b(d)(2); and, as possible costs, the employment-based immigrant visa application fee, USD 345 per person (22 CFR 22.1, item 32(b)), and the USCIS immigrant fee, USD 235 per person (8 CFR 106.2(c)(3)). These two apply only to visas issued at a consulate abroad, and the case does not record whether a family will instead adjust status in the U.S. (Form I-485, USD 1,440, or 950 for a child under 14 filing with a parent).
  - Conditional residence is now a duration: 2 years, or 3 when DHS extends it a year because the jobs are still being created (8 U.S.C. 1186b(a)(1), (c)(3)(B) and (d)(2)).
  - Unchanged and confirmed: the capital amounts, the child definition and the dependents (1101(b)(1)(A) to (E), 1153(d)), the leap-day convention, version 2's regional center fees. The `capital` requirement stays one item: (C)(i) and (C)(ii) are one subparagraph, the expression tests only the reduced amount because where the money is invested is not a case fact, and the title names the higher one.
  - Gaps kept: ages at the evaluation date rather than the Child Status Protection Act age (1153(h)); a father's child born out of wedlock; stepchildren of an earlier marriage (all in [us.md](../us.md#eb-5-investor-green-card)); a proxy marriage that was not consummated (1101(a)(35), a pitfall of the country guide); the high employment area amount, never set above the standard amount (the guide's pitfall on 204.6(f)); the filing path and the investor's role, which no fact records, so `engagement` shows the unit's liquid assets as its evidence, like the other assessments ([OPEN-QUESTIONS.md](../../OPEN-QUESTIONS.md)). The cases files repeat version 1's and 2's, since the dependents and the requirement did not change; R8 has no cost expectations, so the amounts are pinned only by the hashes and this record.
  - The independent check cannot confirm version 4's two reverted fees from 91 FR 61940's machine-readable text, which lacks the image tables; 81 FR 73292's text has them for Forms I-526 and I-829. Form I-526E dates from 2022, so its USD 3,675 rests on Table 1 alone.
- **Watch next:**
  - The 2027-01-01 CPI amounts ([#219](https://github.com/fernandolisboa/arca/issues/219)): a version 6 from 2027-01-01 that keeps version 5's additions, with the amount changed in both the `capital` requirement and the `investment` cost. The open question on versions that must stop on a date is in [OPEN-QUESTIONS.md](../../OPEN-QUESTIONS.md).
  - The final rule after 91 FR 40676: it would replace the citations of 8 CFR 204.6, may carry the 2027 amounts, and may set the high employment area amount.
  - Regional center visas are available only through 2027-09-30 (8 U.S.C. 1153(b)(5)(E)(i)) unless Congress extends the program: then a version from 2027-10-01 keeps only the standalone Form I-526 (USD 7,615, no Integrity Fund fee).
  - USCIS's e-filing interim rule: whether Forms I-526, I-526E or I-829 must be filed online.
  - The country guide's version 2, in a pull request of its own after this one: the 2026 proposed rule, the reverted fees, engagement, gifted and borrowed funds, and the immigrant visa fees.

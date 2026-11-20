# Session review 2026-11-gb

The United Kingdom has one stored route, `gb-skilled-worker`: the Skilled Worker visa (Immigration Rules, Appendix Skilled Worker). Its newest version, 2, effective 2026-04-08, the audit's correction of 2026-11-11, was read on 2026-11-20 against Appendix Skilled Worker as amended by HC 584 (in force 8 October 2026), Appendices Skilled Occupations, English Language, Relationship with Partner, Children, Tuberculosis and ATAS, the introduction to the Rules, the explanatory memoranda of HC 1333 and HC 1691, the Home Office fees table of 8 October 2026, the health surcharge pages and the Immigration Act 1971, ss. 2 and 3ZA ([ADR-0032](../../../../docs/adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../../../docs/runbooks/session-rule-review.md)). Version 3 corrects version 2 from the same date.

Version 2 matched the law on every amount it states: £41,700, £37,500 and £33,400 with 90%, 80% and 70% of the going rate, English at B2, £1,270 and the dependants' £285, £315 and £200, the visa fees (£819, £1,618, £943, £1,865; £628 and £1,235 on the Immigration Salary List), the surcharge (£1,035 and £776 a year), age 18, the partner's 2 years and the Afghan visa brake from 26 March 2026. Nothing published up to 2026-11-20 changes them: the statements of changes collection ends with HC 584, Appendix Skilled Worker last changed on 8 October 2026, Appendix Skilled Occupations on 11 November 2025, and no fees or health charge instrument followed the 8 October 2026 table. The earned settlement response of 2 November 2026 is about settlement, and the Immigration and Asylum Bill is still in Parliament.

## Version 3, correcting version 2 from 2026-04-08

- **New assessments:**
  - `salary-health-education-or-earlier-worker`: options F to K of the table after SW 4.4. A job in Table 3 (health or education) needs £25,000 and the going rate (option K, SW 4.2(c)); a Health and Care ASHE salary job, or a worker with Skilled Worker permission since before 4 April 2024 applying before 4 April 2030, has floors from £25,000 to £31,300 (SW 4.2(b)). Version 2 showed only options A to E, so a nurse or teacher paid under £33,400 read as failing every listed option.
  - `tuberculosis-certificate` (SW 3.2, 28.2; Appendix Tuberculosis, TB2): from abroad, for the worker, partner and child, after 6 months or more continuously in a listed country, part of it in the last 6 months.
  - `criminal-record-certificate` (SW 16.1, 34.1): from abroad, for a job in a code SW 16.1 lists, for the worker and the partner.
  - `atas-certificate` (SW 6.3A, Appendix ATAS).
- **Titles:** `eligible-occupation` adds the Temporary Shortage List (certificates issued before 31 December 2026) and points to SW 6.1B for care workers, who may only switch inside the UK; `sponsored-job` adds that the A rating is not needed to stay with the last sponsor (SW 5.3); `funds` and `funds-dependants` add the exemption for an application inside the UK after 12 months there with permission (SW 15.1, 33.1).
- **Costs:** the visa fee titles add the Health and Care Visa fee (£324 for three years or less, £628 for more), and the surcharge titles say a Health and Care Worker visa and its dependants pay none (the "who needs to pay" page, now cited).
- **Children:** a child under 18 with an unmarried partner now reads as possible instead of excluded. The Rules count an unmarried partner only after 2 years (the introduction's definitions of "partner" and of not leading an independent life), and the case does not record when the child's relationship began.
- **Sources** all read again on 2026-11-20 and dated so; every item now cites its passages in `gb-skilled-worker.3.evidence.json`.

## Rounds

Two reviewers in round 1, one checking each item against its provision, the other looking for anything official that makes the route out of date; the first again in round 2, on the changes.

- **Round 1.** No amount, age, date or citation wrong; all 21 cases agree with the law as modeled. Proven and fixed: salary options F to K missing; the Temporary Shortage List and SW 6.1B missing from the occupation item; the Health and Care Visa fees and surcharge exemption missing; the TB, criminal record and ATAS certificates missing; a child with a partner of under 2 years excluded; the A-rating and 12-month funds exceptions missing from titles. The second reviewer found no statement of changes, fees regulations or health charge order after the 8 October 2026 changes that touches this route (SI 2026/1008 amends only other fees).
- **Round 2**, on the changes: the TB title left out that the stay must be continuous and reach into the last 6 months; the funds exemption applies only inside the UK; the earlier-worker floors need continuous permission and an application before 4 April 2030; the criminal record list is wider than health, education and care; the child with a partner of 2 years or more is not covered. All fixed.

The proposal check and the quote check (`ARCA_REVIEW_QUOTES=2026-11-gb`) pass on the final files.

## Leftover

1. **A family needs the worker's job in Table 1, 2 or 3** (SW 29.1A, 32A.2). The case records no job, so the spouse, partner and children rules state it in their titles as not checked and still list family members as dependents; a worker who qualifies only through the Immigration Salary List or the Temporary Shortage List brings no family.
2. **The permission's 14 days.** SW 18.1 grants leave until 14 days after a certificate of up to 5 years; a duration range takes one unit, so it stays at most 5 years and the title gives the 14 days. GP specialty trainees get 4 months after the certificate (SW 18.1A), not modeled.
3. **Edges of the citizenship requirement:** a Commonwealth citizen with the right of abode (Immigration Act 1971, s. 2(1)(b)) and an Irish citizen under a deportation order or exclusion decision (s. 3ZA(2) to (4), who does need leave) are not modeled; the first reads as eligible to apply, the second as not.
4. **The new entrant** (SW 12.2: under 26, recent UK student or graduate, and similar) and the 4-year cap (SW 12.3) are not spelled out in `salary-isl-or-new-entrant`; the scholarship consent of SW 1.4 is not modeled.
5. **Costs as alternatives:** the engine adds possible costs up, so the possible total still sums every fee band, as in version 2 ([OPEN-QUESTIONS](../../../../docs/OPEN-QUESTIONS.md)).
6. **Production rows were not read.** This session has no database credentials; the proof of publishing is the production build, which runs the migration.

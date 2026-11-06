# United States

Checked 2026-10-31 unless noted.

## Immigrant visa processing in 2026

| Date | Event | Source |
| --- | --- | --- |
| 2026-01-21 | State Department pauses immigrant visa issuance for nationals of 75 countries, Brazil included; nonimmigrant visas not affected; dual nationals of a non-listed country exempt | [Mintz](https://www.mintz.com/insights-center/viewpoints/2806/2026-01-29-state-department-suspends-immigrant-visa-processing-75), [Dorsey](https://www.dorsey.com/newsresources/publications/client-alerts/2026/1/immigrant-visas-for-75-countries-on-pause) |
| 2026-08-21 | Federal court (S.D.N.Y., *CLINIC v. Rubio*) vacates the 75-country pause | [Garvish](https://goimmigrationlaw.com/state-department-paused-immigrant-visa/), [Zafiro Law](https://zafirolaw.com/blog/immigrant-visa-processing-pause/) |
| 2026-08-25 | Immigrant visa interviews paused worldwide for consular training on public-charge screening | [Garvish](https://goimmigrationlaw.com/state-department-paused-immigrant-visa/), [Ogletree](https://ogletree.com/insights-resources/blog-posts/state-department-pauses-immigrant-visa-interviews-for-new-public-charge-guidance-training/) |
| 2026-09-10 | Cable instructs posts to resume immigrant visa processing and issuance; some interviews still rescheduled | [University of Michigan](https://internationalcenter.umich.edu/about/news/state-department-resumes-immigrant-visa-interviews-and-processing), [Nepyork](https://nepyork.com/2026/09/13/u-s-embassies-resume-processing-immigrant-and-diversity-visas-for-citizens-of-75-countries/) |

Implication: entering on a nonimmigrant visa and adjusting status inside the U.S. was insulated from these pauses.

## EB-5 (investor green card)

Checked on 2026-11-05 against 8 U.S.C. 1153(b)(5)(C) on govinfo.gov: USD 800,000 and 1,050,000, adjusted by CPI for petitions filed on or after 2027-01-01. The I-526 and I-526E fee is USD 11,160 (8 CFR 106.2). Route version `us-eb5` 1 (proposed, 2026-11-05) covers the spouse and unmarried children under 21 under 8 U.S.C. 1101(b)(1): biological children, children adopted before 16 after two years of custody, and stepchildren whose parent married the principal before they turned 18. A child adopted at 16 or 17 (the sibling exception in (E)(ii)) or whose two years of custody are not complete yet is shown as possible, not excluded. Lawful source of funds, capital at risk and job creation (8 CFR 204.6(j)) are assessments, so a family that meets the capital threshold gets "needs assessment", never a plain "eligible". Orphan and Hague adoptions ((F) and (G)) need a U.S.-citizen adopter, so they cannot apply to an EB-5 investor.

Known gaps in version 1:

- The amounts change for petitions filed on or after 2027-01-01, so a new version is needed once DHS publishes them; no version has an end date ([#219](https://github.com/fernandolisboa/arca/issues/219)).
- Only the USD 800,000 amount (TEA or infrastructure) is modeled; the TEA status of a project is not a case fact.
- Ages are read at `factsAsOf`, which fits a family that has not filed yet. After filing, the Child Status Protection Act (8 U.S.C. 1153(h)) can keep a child who turns 21 during processing; version 1 does not model it.
- Any biological parent link counts. A child born out of wedlock qualifies through the father only with legitimation or a bona fide relationship ((C) and (D)), which the snapshot cannot tell.
- Stepchildren are reached only through the current marriage, so a step relationship from an earlier marriage is missed; and the spouse's own link to the child is not checked against 1101(b)(1).
- The leap-day convention (`feb-28`) has no official source; the version cites the statute's age of 21 and says the 28 February date is assumed.

Version 2 (proposed, 2026-11-06, effective 2026-11-30) follows the EB-5 fee final rule ([91 FR 61940](https://www.federalregister.gov/documents/2026/09/30/2026-20016/us-citizenship-and-immigration-services-employment-based-immigrant-visa-fifth-preference-eb-5-fee), read from the [govinfo PDF](https://www.govinfo.gov/content/pkg/FR-2026-09-30/pdf/2026-20016.pdf)), which revises 8 CFR 106.2(d) for filings postmarked on or after 2026-11-30: Form I-526 USD 7,615, Form I-526E USD 7,850 (each with the USD 75 technology fee included), plus the USD 1,100 EB-5 Integrity Fund fee for each I-526E (up from USD 1,000 by CPI-U from 2022 to 2025). Its costs follow the regional center path, which the USD 800,000 amount already assumes: USD 7,850 plus USD 1,100; the petition fee's title gives the standalone I-526 amount. The capital requirement's title says it holds for petitions filed before 2027-01-01. Everything else is unchanged from version 1, with the same gaps.

On 2026-11-06 the Federal Register had no technical amendment with the 2027 investment amounts, which 1153(b)(5)(C)(iii) asks DHS to publish (the standard amount follows CPI-U from 2022-01-01, rounded down to USD 50,000; the TEA amount is 75 percent of it).

| Fact | Source |
| --- | --- |
| Minimum investment: USD 800,000 in a targeted employment area (TEA), USD 1,050,000 elsewhere (EB-5 Reform and Integrity Act of 2022) | [Claxton Law Group](https://claxtonlawgroup.com/investor-visas/eb-5-minimum-investment-2026) |
| Amounts scheduled to adjust for inflation on 2027-01-01; projection USD 937,500 (TEA) and USD 1,250,000 (non-TEA) | [EB5AN](https://eb5visainvestments.com/blog/eb-5-investment-amounts-could-increase-by-over-100000-on-january-1-2027-how-to-secure-your-eb-5-green-card-at-todays-lower-cost/) |
| Derivatives: spouse and unmarried children under 21 | [NTL](https://ntlinternational.com/residency/usa-eb5-visa/) |
| November 2026 Visa Bulletin: EB-5 set-aside categories current for all countries | [EB5AN](https://eb5visainvestments.com/?p=206367) |
| Concurrent filing of the investor petition and adjustment of status is possible when the applicant is in the U.S. in valid status | **Unverified** |

## E-2 (treaty investor)

The official treaty table on travel.state.gov refuses automated reads (checked 2026-11-05), so the E-2 country set waits for a readable official copy.

| Fact | Source |
| --- | --- |
| Brazil has no E-2 treaty; Brazilian-only nationals are ineligible regardless of amount | [Beyond Border](https://www.beyondborderglobal.com/resources/e2-visa-guide), [Lehigh Valley Immigration Lawyers](https://www.lehighvalleyimmigrationlawyers.com/blog/e-2-treaty-countries-list-investment-threshold-2026) (official table checked 2026-09-27) |
| Dual nationals can apply through a treaty nationality, for example Italian | [Alaz Law](https://www.alazlaw.com/blog/e-2-visa-countries-list-2026-treaty-investor/) |
| Portugal became an E-2 country in 2024; Portuguese citizens living in Brazil may apply in São Paulo | [Pollak](https://www.pollakimmigration.com/e2-visa/e2-visa-portuguese), [Watson](https://watsonimmigrationlaw.com/visas/e-2/for/portugal) |
| Citizenship obtained by investment requires 3 years of residence in that country before an E visa; descent and residence-based citizenship are not affected | [Stevens & Lee](https://www.stevenslee.com/labor-and-employment-law-center/congress-passes-ndaa-for-fy2023-portuguese-nationals-now-eligible-for-e-1-and-e-2-visas/) |
| Spouse may be of any nationality | [NNU Immigration](https://www.nnuimmigration.com/e-visa-treaty-countries/) |
| No statutory minimum; in practice USD 100,000–200,000 for small businesses | [PolicyRisk](https://policyrisk.com/wiki/e2-treaty-investor-visa) |

## Work and talent routes

| Fact | Source |
| --- | --- |
| H-1B USD 100,000 payment for new petitions for beneficiaries abroad, extended by proclamation of 2026-09-18 through 2027-09-21; blocked by court orders as of 2026-10-01 | [Mintz](https://www.mintz.com/insights-center/viewpoints/2806/2026-09-23-presidential-proclamation-extends-100k-h-1b-fee), [Columbia ISSO](https://isso.columbia.edu/news/white-house-issues-new-h-1b-proclamation-and-executive-order) |
| Change of status inside the U.S. (for example F-1 to H-1B) is exempt from that payment | [Alma](https://www.tryalma.com/learn/h1b-supplementary-fee-explained) |
| EB-2 NIW: 9,238 approvals and 9,585 denials in the first three quarters of FY2026 (49% of decided cases) | [Tukki](https://tukki.ai/blog/eb2-niw-approval-rate) |
| November 2026 Visa Bulletin: EB-1 current for Rest of World; EB-2 Rest of World final action date 2025-04-01 | [Colombo & Hurd](https://www.colombohurdlaw.com/?p=34952) |
| O-1 approval rate 91.2% in Q2 FY2026 | [Immi-USA](https://www.immi-usa.com/fy-2026-q2-approval-rates-eb1-o1-eb2niw/) |
| L-1A requires one year as manager or executive at a related foreign company within the past three years | **Unverified** |

## Gold Card

| Fact | Source |
| --- | --- |
| USD 1,000,000 individual gift plus USD 15,000 processing fee; uses the EB-1/EB-2 framework | [WorkVisa Guide](https://workvisa.guide/es/blog/trump-gold-card-visa-2026) |
| One approval as of April 2026 | [AP via Sharon Herald](https://www.sharonherald.com/ap/trumps-gold-card-visa-starting-at-1-million-granted-to-just-1-person-so-far/article_3f7fdb71-4a6d-5d4a-9cf2-539ce0ba3f0a.html) |

## Family-based

| Fact | Source |
| --- | --- |
| An adult U.S. citizen can petition for a parent as an immediate relative, without a queue | **Unverified** |
| Brazil and the U.S. have no income tax treaty | **Unverified** |

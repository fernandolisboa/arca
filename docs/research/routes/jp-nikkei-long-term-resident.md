# jp-nikkei-long-term-resident

Research notes for Japan's long-term resident status (teijusha) for the third generation of Japanese descent, route `jp-nikkei-long-term-resident` in `packages/knowledge/data/routes`. The seed research is in [other-destinations.md](../other-destinations.md#japan); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-11

The first audit by the runbook ([#359](https://github.com/fernandolisboa/arca/issues/359)), on demand, in one pull request with the British, Irish and Australian routes ([British record](gb-skilled-worker.md)).

- **Version audited:** 1
- **Outcome:** correction, version 2 (pull request [PR_NUMBER](https://github.com/fernandolisboa/arca/pull/PR_NUMBER)), from version 1's date, 2022-04-01, which it replaces entirely.
- **Sources re-read** (all on 2026-11-11 UTC):
  - `teijusha-notice`: Ministry of Justice Notice No. 132 of 1990. `curl` gets a CloudFront 403 from `moj.go.jp`, so the `web-fetch` agent saved the PDF and the audit read the file with `pdftotext -raw`. Items 3 to 7 read as version 1 has them. The agency's page for the notice, `/isa/policies/bill/nyukan_hourei_h07-01-01.html`, names Notice No. 220 of 28 October 2021 as the latest amendment, as version 1 did.
  - `immigration-act`, `civil-code` (arts. 4 and 143) and `age-calculation-act`: `curl` on the e-Gov API v2, current revision of each. Each now names the API's whole-text XML, `https://laws.e-gov.go.jp/api/2/law_data/<id>?response_format=xml&law_full_text_format=xml`, as `machineReadableUrl`, since the cited page is drawn by scripts.
  - New: the Ordinance for Enforcement of the Immigration Control and Refugee Recognition Act, appended table II (`enforcement-ordinance-periods`).
- **Amendments looked for**, up to 2026-11-11: `law_revisions` of each law. The Immigration Act's current revision took effect 2026-10-01; revisions not yet in force take effect 2027-03-31 (Act No. 39 of 2025), 2027-04-01 (Act No. 60 of 2024, replacing technical intern training), 2028-10-31 and 2029-03-31 (Act No. 32 of 2026). The audit compared arts. 2, 5 and 7 of each future revision with today's: the 2027 revisions leave them as they are, and the 2029 one adds to art. 7(1) an electronic travel authorization for visa-exempt short stays, which a long-term resident, who needs a visa, does not use. The newest revisions not yet in force of the Civil Code and of the Enforcement Ordinance leave arts. 4 and 143 and the long-term resident periods as they are.
- **Leads:** none.
- **Findings:**
  - Missing, now a duration: a long-term resident of a status the notice sets stays 5 years, 3 years, 1 year or 6 months (Enforcement Ordinance, appended table II), then renews.
  - Confirmed, unchanged: the descent through a biological grandparent, the family items, the minors under 18 and the 29 February reading (the Act on the Calculation of Age applies Civil Code art. 143, whose paragraph 2 ends a year with no corresponding day at the end of the month, so a person born on 29 February is a year older from 1 March).
- **Check loop:** runs [43075817319](https://github.com/fernandolisboa/arca/actions/runs/43075817319) (0 of 11 items match) and [43076496175](https://github.com/fernandolisboa/arca/actions/runs/43076496175) (0 of 11, none differs). Left over, every item:
  - `unreadable`: the teijusha notice is a PDF (#363), and the e-Gov XML reached the model only as the law's opening.
  - `checker-gap`: `duration:period-of-stay`, whose periods the ordinance writes in kanji numerals, which the checker does not confirm as values.
- **Watch next:** the notice's page for a new amendment; the electronic travel authorization from 2028-10-31.

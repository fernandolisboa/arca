# is-remote-work

Research notes for Iceland's long-term visa for remote work, route `is-remote-work` in `packages/knowledge/data/routes`. The seed research is in [other-destinations.md](../other-destinations.md); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-11

The first audit ([#360](https://github.com/fernandolisboa/arca/issues/360)), on demand, in one pull request with the Czech, Danish, Latvian and Georgian routes ([Czech record](cz-eu-blue-card.md)).

- **Version audited:** 1
- **Outcome:** no change. Version 1 says the route closed on 2026-06-27, and every source still says so. With no new version the sources keep their `verifiedAt` of 2026-11-07, since a version is immutable, and go stale on 2027-02-05.
- **Sources re-read** (all on 2026-11-11 UTC, the gazette PDFs with `curl` and `pdftotext`):
  - Regulation No. 725/2026 (`B_nr_725_2026.pdf`), whole: art. 1 rewrites chapter II of Regulation No. 540/2017, which now covers only short-term residence permits, with no ground for remote work.
  - The Visa Act No. 37/2026 (`A_nr_37_2026.pdf`), whole; art. 23(1)(c) and (d) repeal art. 20 of the Foreign Nationals Act No. 80/2016 and replace art. 21 with the short-term residence permit.
  - Regulation No. 1048/2020 (`B_nr_1048_2020.pdf`), whose art. 2 had added the former art. 5 a, and Act No. 15/2005 on the gazette, art. 8(2) (`A_nr_15_2005.pdf`).
  - Not readable: none from the session. The guide page `https://island.is/en/get-long-term-visa-for-remote-workers`, never a source, now answers 404, which agrees with the closure.
- **Amendments looked for**, up to 2026-11-11: the gazette search (`officialJournalOfIcelandAdverts`) from 2026-06-01, departments A and B, for remote work, long-term visas and Regulation No. 725/2026. No instrument brings the visa back. Act No. 79/2026, the one candidate, is about another subject.
- **Leads:** none.
- **Findings:** none. The route has no requirement, cost or family rule to split or complete; it only states the closure.
- **Check loop:** one run, the baseline [43085585954](https://github.com/fernandolisboa/arca/actions/runs/43085585954) (0 of 1 item). Left over:
  - `unreadable`: the closure item. Every source is a gazette PDF, which the checker does not read (#363), and the gazette host answered the checker's fetch with 403. A further run would read the same nothing, so none was made.
- **Watch next:**
  - A new regulation under Act No. 37/2026 that creates a visa for remote work: that is a new version with a later `effectiveFrom`.
  - Once the checker reads PDFs (#363), run the check on this route again.

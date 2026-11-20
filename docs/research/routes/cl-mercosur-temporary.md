# cl-mercosur-temporary

Research notes for Chile's Mercosur temporary residence, route `cl-mercosur-temporary` in `packages/knowledge/data/routes`. The seed research is in [other-destinations.md](../other-destinations.md#chile); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-20

A session review ([ADR-0032](../../adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md)), on the owner's request: version 5, correcting version 4 from 2022-05-14, active once its pull request merges. It adds the fees by nationality (in an assessment's title for the principal, a USD 15 cost for each adult dependent), the from-abroad, documents and family-papers assessments, the sworn statement of costs, and drops Decreto N.º 177, article 46, which governs another subcategory. Ley Chile was read through BCN's JSON service (a lead); `www.bcn.cl` refused GitHub's quote check for every norm but the Civil Code, so version 5 cites only the Civil Code there. Rounds and leftovers: [review README](../../../packages/knowledge/reviews/2026-11-cl/README.md).

### 2026-11-15

A corrector run ([ADR-0029](../../adr/0029-correction-requests-and-the-corrector-session.md)), from a flagged version, with no request.

- **Version audited:** 3
- **Outcome:** correction, version 4 (pull request [#448](https://github.com/fernandolisboa/arca/pull/448)), from version 3's own date, 2022-05-14, so it replaces version 3 entirely. Versions 1 to 3 start on that date and form one chain of corrections, and version 2 carries the same wording as version 3, so version 4 stands for both and version 2 needs no correction of its own; should an admin reject version 4, the chain falls back to the wording corrected here. Only the criminal record item's title, the `agreement-records` source's title and the re-read sources' dates change; rules, other items and cases are those of version 3.
- **Sources re-read** (on 2026-11-15 UTC with `curl`):
  - `sermig-mercosur` (last updated 2025-12-18) and `sermig-dependents` (last updated 2025-12-16): the migration service's pages at their cited addresses, saved and read as text, unchanged since the last audit.
  - `agreement-nationals`, `-residence` and `-records`: `https://www.bacn.gov.py/leyes-paraguayas/1104/x`, the agreement as Paraguay's Ley N.º 3578/2008 prints it, saved and read as text, articles 2 to 6 and 9.
  - Not readable: `ley-21325-treaty-residence`, `ley-21325-dependents`, `decreto-177-treaty-permits`, `decreto-177-dependents` and `codigo-civil`, all on `www.bcn.cl`, whose page and XML export both answered 401 to the session. They keep 2026-11-07 and go stale on 2027-02-05.
- **Amendments looked for**, up to 2026-11-15: Ley Chile could not be read. The service's pages show no update since December 2025; an open-web search found no change to subcategory 15 or to dependents.
- **Leads:** flagged by the independent check, report of 2026-11-15: `assessment:no-criminal-record` differs; `assessment:means-for-dependents`, `dependent:spouse`, `dependent:partner`, `dependent:children`, `dependent:spouse-children` and `dependent:partner-children` could not be checked (`model_could_not_check`). The open-web search gave no lead.
- **Findings:**
  - Corrected: `no-criminal-record`. Version 3 counted the 60 days from an unnamed date ("issued no more than 60 days before") and did not tell the two limits apart. The service's page gives the country of origin's certificate its own validity of at most 60 days from its date of issue; any other document a public body issues, a certificate from a country of residence included, falls under the page's general rule that it is attached within 60 days of issue unless it states another validity. The title now states both. The certificate from the country of origin or of residence in the last 5 years, for adults, is unchanged. The `agreement-records` source cited article 4.1, c) to e), but only c) states the item; it now names c) alone.
  - Confirmed, unchanged: the five states of subcategory 15, still under article 70 N.º 13 on the service's page; the five years of a naturalized national (article 2); up to two years (article 4.1 and the page); the spouse, the partner, children under 18, older children with a disability or between 18 and 24 who study, and the principal's means against the Social Development and Family Ministry's indicators.
  - Not added: the certificate from the receiving country (article 4.1, e)), which applies to applications made inside that country (article 3, paragraph 2), while subcategory 15 is applied for from abroad only.
  - Open, for the owner: the sworn statement of no international criminal or police records (article 4.1, d)). The agreement asks it of every applicant and Decreto N.º 177, article 46, gives a treaty permit the treaty's requirements, but the service's page does not list it. Whether Chile asks for it is not settled by any text read here; it is under "Watch next" for an on-demand session.
  - The seven items the report could not check matched in the runs below; the report's misses were run-to-run variance of the model.
- **Check loop:** runs [43703297692](https://github.com/fernandolisboa/arca/actions/runs/43703297692) (9 of 10 items match; `leapDayBirthday` not checked, the Civil Code XML cut) and [43703744237](https://github.com/fernandolisboa/arca/actions/runs/43703744237) (10 of 10), then a last run on the head with this record, linked in the pull request.
- **Watch next:** the sworn statement of article 4.1, d) (above), an assessment to add once an official text or the service settles it; as before, a host the session can read for Ley Chile before 2027-02-05 (an official-domain list version of its own, for an on-demand session); the planned change to Decreto N.º 177; the fee table by nationality.

### 2026-11-11

The first audit by the runbook ([#358](https://github.com/fernandolisboa/arca/issues/358)), on demand, together with the other three Mercosur routes. The pull request carries the four Mercosur routes, as the [Argentine record](ar-mercosur-temporary.md) explains.

- **Version audited:** 1
- **Outcome:** correction, version 2 (pull request [#385](https://github.com/fernandolisboa/arca/pull/385)), from version 1's own date, 2022-05-14, so it replaces version 1 entirely.
- **Sources re-read** (on 2026-11-11 UTC with `curl`):
  - `sermig-mercosur` (last updated 2025-12-18) and `sermig-dependents` (last updated 2025-12-16): the migration service's pages.
  - `agreement-nationals`, `-residence` and `-records`: the agreement as Paraguay's Ley N.º 3578/2008 prints it, articles 2, 4 and 9.
  - Not readable: `ley-21325-treaty-residence`, `ley-21325-dependents`, `decreto-177-treaty-permits`, `decreto-177-dependents` and `codigo-civil`, all on `www.bcn.cl`, which answered 401 again; the Ley Chile JSON service, a lead, answered 401 too. They keep 2026-11-07 and go stale on 2027-02-05. Their new titles split what version 1's titles joined, from the reading of 2026-11-07 in the country guide.
  - The service's fee table by nationality is drawn by a script and was not found in the page or in the session's own Playwright render of it.
- **Amendments looked for**, up to 2026-11-11: Ley Chile could not be read. News of 2026-07 reports a planned change to Decreto N.º 177 for seasonal farm workers; no published decree was found, and nothing points at treaty permits or dependents.
- **Leads:** that planned change, unconfirmed.
- **Findings:**
  - Confirmed, unchanged: the five states of subcategory 15 and the five years of a naturalized national. Carried over from the reading of 2026-11-07, not re-read: the dependents of article 74 and the leap-day convention of article 48 of the Civil Code.
  - Missing, now an assessment: the principal's means for the dependents' upkeep, against the Social Development Ministry's indicators, which no text sets as an amount. This settles the open question on means for dependents: the dependents stay included, and the means are weighed.
  - Missing, now an assessment: the criminal record certificate the service's page asks of adults. No fact records it, so it shows the principal's visa refusals.
  - Missing, now a duration: up to two years.
  - Not modeled, in [OPEN-QUESTIONS.md](../../OPEN-QUESTIONS.md): the fee, which depends on nationality.
  - Sources: split one per provision. Article 70 is cited without choosing between N.º 9 and N.º 13, since the service still names N.º 13.
  - The cases file starts from version 1's cases; every case that met the requirement now reads "needs assessment".
- **Check loop:** runs [43061828774](https://github.com/fernandolisboa/arca/actions/runs/43061828774) (3 of 10 items match), [43064316443](https://github.com/fernandolisboa/arca/actions/runs/43064316443) (3 of 10), [43065678291](https://github.com/fernandolisboa/arca/actions/runs/43065678291) (5 of 10) and, on the reviewed head, [43068431755](https://github.com/fernandolisboa/arca/actions/runs/43068431755) (5 of 10, none differs). Fixed on the way: the dependents' titles now follow the service's page (spouse, partner, children between 18 and 24 who study), and the means assessment cites the page that states it. Left over:
  - `unreadable`: `assessment:means-for-dependents`, `dependent:children`, `dependent:spouse-children`, `dependent:partner-children` and `leapDayBirthday`. Each rests in part on Ley N.º 21.325, Decreto N.º 177 or the Civil Code on `www.bcn.cl`, where the check gets a page drawn by scripts with no text and the session gets 401; the check confirms the service's page and asks for the law. They were read on 2026-11-07 from the Ley Chile JSON service, a lead host.
- **2026-11-12, correction, version 3:** each `www.bcn.cl` source gets `machineReadableUrl` set to BCN's XML export of the same norm (`/leychile/Consulta/obtxml?opt=7&idNorma=<id>`), which the check reads from GitHub Actions. Run [43278497594](https://github.com/fernandolisboa/arca/actions/runs/43278497594): 10 of 10 items match, none left over. The session still gets 401, so no `verifiedAt` moves.
- **Watch next:** a host the session can read for Ley Chile before 2027-02-05 (an official-domain list version of its own), since the check matching does not re-verify a source; the planned change to Decreto N.º 177.

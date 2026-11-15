# it-descent

Research notes for Italian citizenship by descent, route `it-descent` in `packages/knowledge/data/routes`. The seed research is in [ancestry.md](../ancestry.md#italy); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-15

A corrector run ([ADR-0029](../../adr/0029-correction-requests-and-the-corrector-session.md)), for version 2, which the independent check flagged. The record above predates the check loop and names neither item it found differing.

- **Version audited:** 2
- **Outcome:** correction, version 4 (pull request [#447](https://github.com/fernandolisboa/arca/pull/447)), from version 2's own date, 2026-02-19, which it replaces entirely. Version 3, from 2029-01-01, carries neither item and is unchanged.
- **Sources re-read** (on 2026-11-15 UTC, with `curl`, from the saved text):
  - `dlgs-71-2011-consulate-limit` and `dlgs-71-2011-term`: art. 10 of D.Lgs. 71/2011, whole, as replaced by L. 11/2026.
  - `dlgs-71-2011-fee-table`: the annexed table, version 12, in force from 2026-01-01, read through the `caricaArticolo` address with the act's cookie. The table itself is a graphic ("Parte di provvedimento in formato grafico"). Its notes quote each amending provision: note 12 quotes L. 207/2024, art. 1, comma 639.
  - `legge-207-2024-consular-fee` and `legge-207-2024-municipal-fee`: art. 1, commi 601 to 700, in the text in force from 2027-01-01. Commi 636 and 639 read as cited.
  - `dpr-115-2002`: art. 13, comma 1-sexies, in force from 2025-01-01.
  - `legge-91-1992-art-1` and `legge-91-1992-art-3-bis`: both articles whole. The act's last update was published on 2025-12-30.
  - `dl-66-2014`: art. 5-bis, which states the original EUR 300. It is dropped from version 4 (below).
  - Not re-read in full: `dl-36-2025`, `legge-74-2025`, `legge-555-1912`, `legge-555-1912-minors` and `legge-11-2026`, whose pages show the same updates as on 2026-11-11. Also not re-read: the three Constitutional Court rulings and `cassazione-ssuu-24045-2026`. All keep 2026-11-11.
- **Amendments looked for**, up to 2026-11-15: each act's "Ultimo aggiornamento all'atto" on Normattiva. L. 207/2024 shows an update published on 2026-11-11 and an art. 1 text in force from 2027-01-01, in which commi 636 and 639 are unchanged. D.P.R. 115/2002 shows an update of 2026-10-16, with art. 13 unchanged since 2025-01-01. D.Lgs. 71/2011's last update is still of 2026-02-04 (L. 11/2026). A web search found nothing new on the EU Court of Justice reference of ordinanza 147/2026.
- **Leads:** version 2, flagged by the independent check, report of 2026-11-14: `assessment:consulate-yearly-limit` and `cost:consular-fee` differ; could not be checked: `requirement:citizen-line` and `cost:municipal-fee`. Both differing items were confirmed as below by the official texts.
- **Findings:**
  - `assessment:consulate-yearly-limit`: art. 10, comma 6, counts "i procedimenti di riconoscimento della cittadinanza conclusi", so rejections count too. The title said "recognitions"; it now says "recognition procedures". The years 2025 and 2028 come from comma 5 and the law's entry into force on 2026-02-19 (`legge-11-2026`, also cited).
  - `cost:consular-fee`: the amount, EUR 600, is right. The item also cited `dl-66-2014`, whose art. 5-bis created art. 7-bis at EUR 300 and states no other amount. It now cites only the table and comma 639, the texts that state EUR 600.
- **Check loop:** run [43677500354](https://github.com/fernandolisboa/arca/actions/runs/43677500354) on version 4: 3 of 6 match, none differs, `assessment:consulate-yearly-limit` among the matches. The run on this record's own head, the final one, is in the pull request's body. Left over:
  - `unreadable`: `cost:consular-fee` and `cost:municipal-fee`. The fee table and commi 636 and 639 of L. 207/2024 are served only by `caricaArticolo` addresses that need the session cookie. The cited act addresses open art. 1 of D.Lgs. 71/2011 and commi 1 to 100 of L. 207/2024. An admin reads the table under the act's "Allegato" and the commi in the part 601 to 700.
  - `unreadable`: `requirement:citizen-line`, as far as it rests on the Constitutional Court's rulings 63/2026 and 147/2026. The check's fetch got a 302 to a bot challenge (`redirect_refused`), as the `cortecostituzionale.it` recipe warns. `checker-gap`: the model also would not join art. 3-bis to the pre-1948 rules of L. 555/1912.
- **Watch next:** as the record above left it. A machine-readable address for Normattiva's annexes and for the parts of a budget law's single article would let the check read the fees. That is a recipe change for an on-demand session.

### 2026-11-11

The first full audit by the runbook ([#357](https://github.com/fernandolisboa/arca/issues/357)), on demand.

- **Version audited:** 1
- **Outcome:** new version 2 from 2026-02-19 and new version 3 from 2029-01-01 (pull request [#381](https://github.com/fernandolisboa/arca/pull/381)). Version 2 starts on 2026-02-19, the day Legge 19 gennaio 2026, n. 11 took effect; version 3 starts on 2029-01-01, the day that law moves adults' applications from the consulates to a central office. The citizenship rule itself did not change. Version 2 also carries what version 1 left out, the fees and the time limit. Version 1 stays selected for 2025-05-24 to 2026-02-18 without the fees, which were already in force then. The app evaluates a case only as of today, so no result is read from that window and it gets no correction of its own.
- **Sources re-read** (all on 2026-11-11 UTC, with `curl`, read from the saved text):
  - `legge-91-1992-art-1` and `legge-91-1992-art-3-bis` (version 1's single `legge-91-1992`, now one source per provision): arts. 1 and 3-bis of Legge 91/1992 on Normattiva, whose last update is an act published on 2025-12-30. Art. 3-bis shows the text in force from 2025-05-24. Arts. 4 and 9 were read to see what the later updates touched; the rest of the law was not read line by line.
  - `dl-36-2025`: art. 1, as in force from 2026-03-01. `legge-74-2025`: read whole.
  - `legge-555-1912` and the new `legge-555-1912-minors`: arts. 1, 7 and 12.
  - `corte-cost-30-1983`, `corte-cost-63-2026`, `corte-cost-147-2026`: each ruling read whole on its `scheda-pronuncia` page, the cited address. The PDF addresses answered a redirect, which this audit followed with `curl -L` and got the same rulings; the recipe now says not to follow it, since later the same day the host sent `curl` to a bot challenge on another host.
  - `legge-11-2026` (new): the law read whole, seven articles.
  - `dlgs-71-2011-term`, `dlgs-71-2011-consulate-limit`, `dlgs-71-2011-central-office`, `dlgs-71-2011-central-limit` and `dlgs-71-2011-fee-table` (new): art. 10 of Decreto legislativo 71/2011 as in force from 2026-02-19, arts. 12 and 15, and the annexed fee table with its notes.
  - `dl-66-2014` (new): art. 5-bis.
  - `legge-207-2024-consular-fee` and `legge-207-2024-municipal-fee` (new): art. 1, commi 636 to 639 and 814.
  - `dpr-115-2002` (new): art. 13.
  - `cassazione-ssuu-24045-2026` (new, `secondary`): the judgment read whole from the Court of Cassation's own site, which is not on the `it` list.
  - Not readable: none. Not re-read: none.
  - No source has a machine-readable address. Legge 207/2024 is one article of more than 900 commi, which Normattiva serves 100 at a time: the act's address opens commi 1 to 100, so the independent check will not find commi 636 and 639 there and an admin reads them on the page (part 601 to 700).
- **Amendments looked for**, up to 2026-11-11:
  - Each cited act's update list on Normattiva ("aggiornamenti all'atto" and "aggiornamenti all'articolo"). Legge 91/1992: arts. 1 and 3-bis unchanged. Decreto-legge 36/2025: Decreto-legge 200/2025, art. 1, comma 19-ter, moved the deadline of art. 1, comma 1-ter (a minor's declaration under art. 4, comma 1-bis) from 31 May 2026 to 31 May 2029; the route does not model that declaration. Decreto legislativo 71/2011: Legge 11/2026 replaced art. 10.
  - Legge 11/2026 (Gazzetta Ufficiale n. 28 of 2026-02-04, in force 2026-02-19). Art. 10 now sets 36 months to conclude an adult's application (comma 7). Until 2028-12-31 each consulate takes, per year, no more adult applications than the recognitions it concluded in 2025, and never fewer than 100 (comma 6). From 2029-01-01 adults who live abroad apply by post, with paper originals and proof of the fee, to a central office of the Foreign Ministry (commi 2, 3 and 5), which in 2029 and 2030 takes no more applications than those the consulates collected the fee for in 2025 (comma 5). Consulates still recognize minor children of recognized citizens (comma 1 b) and finish what they received before 2029.
  - Court rulings. The Constitutional Court's reference to the EU Court of Justice (ordinanza 147/2026) is still pending; a web search found no case number, hearing or opinion. The Court of Justice's own site, curia.europa.eu, is on no pinned list and was not read. The Court of Cassation, Sezioni Unite, sentenza 24045/2026 (published 2026-07-26) decided the question on arts. 7 and 12 of Legge 555/1912 that the country guide lists as pending: a minor born abroad, a citizen of that state by birth on its soil, kept Italian citizenship when the Italian parent lost it by naturalizing.
- **Leads:**
  - News and law firm pages on Legge 11/2026 led to the law; the route cites only the Normattiva text.
  - Firm pages report new referrals to the Constitutional Court by a tribunal in September 2026 and an Interior Ministry circular of 2026-08-10 on art. 3-bis. Neither was found on a listed host; nothing changes.
  - Consulate pages (esteri.it, not readable) show the EUR 600 fee. Confirmed on Normattiva: fee table, art. 7-bis, as raised by Legge 207/2024, art. 1, comma 639.
- **Findings:**
  - Changed: the consulate path. Version 2 adds the assessment `consulate-yearly-limit`; version 3 replaces it with `central-office-by-post` and `central-office-yearly-limit`. The case does not record where a person applies, so each is an assessment.
  - Missing: the time limit. `recognition-decision`, up to 36 months (art. 10, comma 7), from version 2. Before 2026-02-19 no single provision set a term this route could cite.
  - Missing: the fees, in force since 2025-01-01. EUR 600 for an adult's application through a consulate (fee table, art. 7-bis; from 2029 with the application to the central office, art. 10, comma 3), up to EUR 600 at a municipality that chooses to charge (Legge 207/2024, art. 1, comma 636) and EUR 600 for each claimant in court (D.P.R. 115/2002, art. 13, comma 1-sexies). A person pays one of the three, by the path taken, which the case does not record: each is a possible cost, and each title says only one is paid. The engine adds possible costs up, so the possible total reads EUR 1,800 where a person pays at most EUR 600. The fees are for adults; the costs do not read an age, because the route has no official source for a 29 February birthday and would need one to read any.
  - The single `legge-91-1992` source joined arts. 1 and 3-bis, and `legge-555-1912` stood for arts. 1, 7 and 12. Each is now one source per provision.
  - Unchanged: the requirement `citizen-line` and its expression. A result of `eligible` becomes `needs_assessment`, since versions 2 and 3 have assessments.
- **Watch next:**
  - The EU Court of Justice's answer to ordinanza 147/2026. An answer against art. 3-bis is a new version.
  - The ministerial rules for the central office before 2029-01-01, and any law that moves that date; version 3 is written from the text of 2026 and is re-read before it takes effect. A rule change before 2029 that makes a new version must also be carried into version 3, by a correction of it. The yearly limit of version 3 ends with 2030, so a version from 2031-01-01 drops it.
  - The country guide `it` version 1 lists the arts. 7 and 12 question as pending and does not have Legge 11/2026; a version 2 goes in a pull request of its own. The Court of Cassation's host is not on the `it` list.
  - Not modeled, in [OPEN-QUESTIONS.md](../../OPEN-QUESTIONS.md): the fees of 2025-05-24 to 2026-02-18, the path a person takes, the possible total that adds up three fees of which one is paid, and the minor's declaration under art. 4, comma 1-bis.

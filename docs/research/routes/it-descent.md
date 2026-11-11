# it-descent

Research notes for Italian citizenship by descent, route `it-descent` in `packages/knowledge/data/routes`. The seed research is in [ancestry.md](../ancestry.md#italy); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-11

The first full audit by the runbook ([#357](https://github.com/fernandolisboa/arca/issues/357)), on demand.

- **Version audited:** 1
- **Outcome:** two new versions (pull request PRNUM). Version 2 starts on 2026-02-19, the day Legge 19 gennaio 2026, n. 11 took effect; version 3 starts on 2029-01-01, the day that law moves adults' applications from the consulates to a central office. The citizenship rule itself did not change. Version 2 also carries what version 1 left out, the fees and the time limit. Version 1 stays selected for 2025-05-24 to 2026-02-18 without the fees, which were already in force then; no evaluation is dated in that window, so it gets no correction of its own.
- **Sources re-read** (all on 2026-11-11 UTC, with `curl`, read from the saved text):
  - `legge-91-1992-art-1` and `legge-91-1992-art-3-bis` (version 1's single `legge-91-1992`, now one source per provision): arts. 1 and 3-bis of Legge 91/1992 on Normattiva, whose last update is an act published on 2025-12-30. Art. 3-bis shows the text in force from 2025-05-24. Arts. 4 and 9 were read to see what the later updates touched; the rest of the law was not read line by line.
  - `dl-36-2025`: art. 1, as in force from 2026-03-01. `legge-74-2025`: read whole.
  - `legge-555-1912` and the new `legge-555-1912-minors`: arts. 1, 7 and 12.
  - `corte-cost-30-1983`, `corte-cost-63-2026`, `corte-cost-147-2026`: each ruling read whole from the court's PDF.
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
  - Court rulings. The Constitutional Court's reference to the EU Court of Justice (ordinanza 147/2026) is still pending; no case number, hearing or opinion was found on a listed host. The Court of Cassation, Sezioni Unite, sentenza 24045/2026 (published 2026-07-26) decided the question on arts. 7 and 12 of Legge 555/1912 that the country guide lists as pending: a minor born abroad, a citizen of that state by birth on its soil, kept Italian citizenship when the Italian parent lost it by naturalizing.
- **Leads:**
  - News and law firm pages on Legge 11/2026 led to the law; the route cites only the Normattiva text.
  - Firm pages report new referrals to the Constitutional Court by a tribunal in September 2026 and an Interior Ministry circular of 2026-08-10 on art. 3-bis. Neither was found on a listed host; nothing changes.
  - Consulate pages (esteri.it, not readable) show the EUR 600 fee. Confirmed on Normattiva: fee table, art. 7-bis, as raised by Legge 207/2024, art. 1, comma 639.
- **Findings:**
  - Changed: the consulate path. Version 2 adds the assessment `consulate-yearly-limit`; version 3 replaces it with `central-office-by-post` and `central-office-yearly-limit`. The case does not record where a person applies, so each is an assessment.
  - Missing: the time limit. `recognition-decision`, up to 36 months (art. 10, comma 7), from version 2. Before 2026-02-19 no single provision set a term this route could cite.
  - Missing: the fees, in force since 2025-01-01. EUR 600 for an adult's application through a consulate (fee table, art. 7-bis), up to EUR 600 at a municipality that chooses to charge (Legge 207/2024, art. 1, comma 636) and EUR 600 for each claimant in court (D.P.R. 115/2002, art. 13, comma 1-sexies). A person pays one of the three, by the path taken, which the case does not record: each is a possible cost. The fees are for adults; the costs do not read an age, because the route has no official source for a 29 February birthday and would need one to read any.
  - The single `legge-91-1992` source joined arts. 1 and 3-bis, and `legge-555-1912` stood for arts. 1, 7 and 12. Each is now one source per provision.
  - Unchanged: the requirement `citizen-line` and its expression. A result of `eligible` becomes `needs_assessment`, since versions 2 and 3 have assessments.
- **Watch next:**
  - The EU Court of Justice's answer to ordinanza 147/2026. An answer against art. 3-bis is a new version.
  - The ministerial rules for the central office before 2029-01-01, and any law that moves that date; version 3 is written from the text of 2026 and is re-read before it takes effect.
  - The country guide `it` version 1 lists the arts. 7 and 12 question as pending and does not have Legge 11/2026; a version 2 goes in a pull request of its own, with the Court of Cassation's host if it is to be cited as official.
  - Not modeled, in [OPEN-QUESTIONS.md](../../OPEN-QUESTIONS.md): the fees of 2025-05-24 to 2026-02-18, the path a person takes, and the minor's declaration under art. 4, comma 1-bis.

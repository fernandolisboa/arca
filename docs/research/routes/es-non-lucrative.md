# es-non-lucrative

Research notes for Spain's non-lucrative residence visa, route `es-non-lucrative` in `packages/knowledge/data/routes`. The seed research is in [other-destinations.md](../other-destinations.md#spain); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-11

The first full audit by the runbook ([#357](https://github.com/fernandolisboa/arca/issues/357)), on demand.

- **Version audited:** 2
- **Outcome:** correction, version 3 (pull request PRNUM), of version 2 from 2025-06-16. Nothing in version 2 was wrong; it left out the visa's general requirements, the fees and the durations. Version 3 starts on 2025-06-16 and not on version 2's own date, 2025-05-20, because the order that sets the permit and card fees, Orden PJC/617/2025, took effect that day: from then on every provision version 3 cites was in force. Version 2 stays selected for 2025-05-20 to 2025-06-15, when the fees came from the repealed Orden PRE/1803/2011, whose amounts the yearly budget laws had raised and no single official text states. No evaluation is dated in that window, so those 27 days get no version of their own.
- **Sources re-read** (all on 2026-11-11 UTC, with `curl` on boe.es, read from the saved text):
  - `rd-1155-2024-*` (one source per provision, all on the consolidated Real Decreto 1155/2024, last updated 2026-09-22): articles 38, 39, 60 to 64 and 196, additional provision 12 and transitional provisions 1 and 2, read in full. The rest of the regulation was not read line by line.
  - `ley-31-2022`: additional provision 90, on the consolidated text last updated 2026-09-30.
  - `orden-efd-581-2026`: its title and single article.
  - `codigo-civil`: articles 5 and 240.
  - `lo-4-2000` and the new `lo-4-2000-fees` and `lo-4-2000-reciprocity`: articles 1, 4 and 44 to 49 of the consolidated Ley Orgánica 4/2000, last updated 2025-03-19.
  - `rd-240-2007`: article 1, the start of article 2 and the third additional provision.
  - `orden-auc-891-2024` (new): read whole.
  - `orden-pjc-617-2025-permit` and `orden-pjc-617-2025-card` (new): the order read whole, annex included.
  - `codigo-penal` (new): article 19.
  - Not readable: none. Not re-read: none.
  - No source has a machine-readable address. The BOE open-data API serves each article as XML (`/datosabiertos/api/legislacion-consolidada/id/<id>/texto/bloque/<block>`), but only to a request that accepts `application/xml`; the independent check asks for HTML and gets HTTP 400, so the address would break the check instead of helping it.
- **Amendments looked for**, up to the BOE of 2026-11-11:
  - The later references of each cited act (the open-data API's `analisis`). Real Decreto 1155/2024: Real Decreto 316/2026 and the Supreme Court judgments of 2026-07-08 and 2026-07-29, none of them on articles 38, 39 or 61 to 64 (the country guide already records them). Ley 31/2022: the newest is Real Decreto-ley 25/2026, on additional provision 54; additional provision 90 is unchanged. Orden AUC/891/2024 and Orden PJC/617/2025: no later reference.
  - The BOE search by title from 2026-09-20 to 2026-11-11 for "extranjeros", "extranjería", "Real Decreto 1155/2024", "IPREM", "indicador público de renta", "Presupuestos Generales del Estado para el año 2027" and "tasas visados". Nothing changes a provision the route cites. No budget law for 2027 is published.
- **Leads:**
  - Law firm and news pages on the IPREM: still EUR 600 for 2026; a disability federation asks for EUR 900 in the 2027 budget. No official text; nothing changes.
  - Consulate pages (exteriores.gob.es, not on the list) show the permit fee as about USD 13, which matches EUR 10.94, and visa fees that differ by nationality (United States, Canada and United Kingdom citizens pay more). Confirmed in principle by Ley Orgánica 4/2000, article 48.4, and Orden AUC/891/2024, article 4 (reciprocity); the amounts per nationality are on no listed host, so the visa fee's title says another amount may apply.
  - Firm pages say consulates ask for private insurance with no co-payments and refuse remote work. Article 61.2 b) asks only for "health insurance" (article 35 i), for the long-stay study visa, asks for an insurer authorized in Spain and cover like the public system's); articles 61.1 and 61.2 a) rule out any work or professional activity. Version 3 states what the regulation says.
- **Findings:**
  - Missing: the specific requirements of article 61.2 b), c) and d) (health insurance, no pending commitment not to return, no threat to public order) and the general visa requirements of article 38 b), c), d), e) and i) (not irregularly in Spain, not listed as refusable, a passport valid a year, no criminal record abroad in five years from the age of 18, a medical certificate). Each is now an assessment. Article 61.1 and 61.2 a), residence with no work at all, is the assessment `no-work`.
  - Missing: the fees. EUR 90 for each national visa application (Orden AUC/891/2024, article 1), EUR 10.94 for each initial permit (Orden PJC/617/2025, annex, 2.1.1) and EUR 16.08 for each identity card (annex, 4.2). Each applicant or holder owes them (Ley Orgánica 4/2000, article 46.1), so each has a cost for the principal and one for each family member. No child exemption exists for a national visa: article 47 exempts children under six only from transit and stay visa fees.
  - Missing: the durations. One month for the permit decision, with silence as refusal (article 63.4); one month for the consulate to issue the visa (article 39.5); one month from entry to apply for the identity card (article 63.5); an initial permit of one year (article 61.4) and renewals of two (article 64.7).
  - The single `rd-1155-2024` source joined every provision. It is now one source per provision.
  - Unchanged: the means (400% and 100% of the IPREM of EUR 600, over 12 months), the EU, EEA and Swiss exclusion and the family rules.
- **Watch next:**
  - A State Budget law for 2027, or a decree-law, that sets a new IPREM or raises the fees (Orden PJC/617/2025, article 1.2, has the yearly budget laws raise them). Either is a new version from its date.
  - The country guide `es` version 1 does not list Orden AUC/891/2024, Orden PJC/617/2025 or the Código Penal; a version 2 that adds them goes in a pull request of its own.
  - Not modeled, in [OPEN-QUESTIONS.md](../../OPEN-QUESTIONS.md): the renewal conditions of article 64.2, the visa fee by reciprocity, and the fees of 2025-05-20 to 2025-06-15.

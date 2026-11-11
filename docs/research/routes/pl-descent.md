# pl-descent

Research notes for the confirmation of Polish citizenship by descent, route `pl-descent` in `packages/knowledge/data/routes`. The seed research is in [ancestry.md](../ancestry.md#poland); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-11

The first full audit by the runbook ([#357](https://github.com/fernandolisboa/arca/issues/357)), on demand.

- **Version audited:** 1
- **Outcome:** correction, version 2 (pull request PRNUM), of version 1 from 2026-01-01. The citizenship rule did not change; version 1 left out the stamp duty, the consular fee and the time limit, and one source title misread the 1951 act. Version 2 starts on 2026-01-01 because the consular fee it states took effect that day: from then on every provision it cites was in force. Version 1 stays selected for 2012-08-15 to 2025-12-31, without the stamp duty (PLN 277 from 2025-08-01, less before) or the six-month term (from 2025-08-01). No evaluation is dated in that window, so it gets no version of its own.
- **Sources re-read** (all on 2026-11-11 UTC, with `curl`, from the Journal of Laws PDFs the Sejm's ELI API serves; the scans read as page images):
  - `ustawa-2009-art-14`, `ustawa-2009-art-55` (version 1's single `ustawa-2009`), `ustawa-2009-term` and `ustawa-2009-consul` (new): the consolidated 2009 act, Dz.U. 2025 poz. 1611, with the Marshal's notice; arts. 1 to 4, 6, 10, 14, 15 and 55 to 58 read in full, the rest not line by line.
  - `ustawa-1962-art-4` and `ustawa-1962-art-6` (version 1's `ustawa-1962`): arts. 4 to 7 of the 1962 act.
  - `ustawa-1951-art-6`, `ustawa-1951-art-8` and `ustawa-1951-art-9` (version 1's `ustawa-1951`): arts. 6 to 9 of the 1951 act.
  - `ustawa-1920-art-5`, `ustawa-1920-art-11` and `ustawa-1920-art-13` (version 1's `ustawa-1920`): the 1920 act read whole.
  - `ustawa-2025-921` (new): arts. 2, 3, 5 and 6 of the act of 25 June 2025.
  - `oplata-skarbowa-item-27` and `oplata-skarbowa-due` (new): the consolidated Stamp Duty Act, Dz.U. 2026 poz. 1395, arts. 1, 3 and 5 to 7 and annex part I, items 26 to 27b.
  - `oplaty-konsularne-item-2-03` and `oplaty-konsularne-conversion` (new): the consolidated consular fees regulation, Dz.U. 2026 poz. 1298, §§ 1 to 9 and section II of both parts of the tariff; the amending regulation Dz.U. 2025 poz. 1523, which set the two parts.
  - Not readable: none. Not re-read: none.
  - No source has a machine-readable address: the consolidated texts are PDFs only (`/text.html` answers empty for them).
- **Amendments looked for**, up to 2026-11-11:
  - The Sejm ELI record of each act. The 2009 act (DU/2012/161): the newest amending acts are Dz.U. 2025 poz. 622 (from 2025-07-01, on recognition as a citizen) and poz. 921 (from 2025-08-01); nothing after the consolidated text. The Stamp Duty Act (DU/2006/1635): six acts after poz. 921, two of them not yet in force (Dz.U. 2026 poz. 875 from 2027-01-01 and poz. 1206 from 2027-01-11); none touches item 27. The 1920, 1951 and 1962 acts are repealed and unchanged.
  - The ELI search by title for 2025 and 2026: "obywatelstw", "opłacie skarbowej", "opłat konsularnych". Nothing else changes a provision the route cites. The regulation on reduced consular fees (Dz.U. 2026 poz. 1367) does not name Brazil.
- **Leads:**
  - News pages report three bills on citizenship in 2026 (a government draft, the President's bill and a deputies' bill rejected at first reading). All are about grant, recognition and restoration, none is law, and none was found to change confirmation by descent.
  - Voivode and consulate pages on `www.gov.pl` (a listed host) show PLN 277 and "no longer than 6 months" at the voivode, and at a consulate only the consular fee, in the local currency. They match the texts and are not cited.
- **Findings:**
  - Missing: the stamp duty, PLN 277 for the decision (annex part I, item 27), due when the application is filed (art. 6). Now the cost `stamp-duty`.
  - Missing: the consular fee, EUR 100 since 2026-01-01 (tariff item 2.03; EUR 80 until 2025-12-31), converted to the consulate's currency (§ 3), for a person abroad who files through a consul (2009 act, art. 57). A cost must be in the version's currency, PLN, so the fee is stated in the title of `stamp-duty` and not added to the total.
  - Missing: the time limit, 6 months from the day the application reaches the voivode (art. 10 ust. 3a, added from 2025-08-01). Now the duration `confirmation-decision`.
  - Wrong: the title of `ustawa-1951` said "stateless" where art. 6 says the other parent is unknown or of unknown or undetermined citizenship. Fixed in `ustawa-1951-art-6`. No result changes.
  - Each of the four sources joined two or three provisions. Each is now one source per provision.
  - Unchanged: the requirement `polish-line` and its expression, and every case result.
- **Watch next:**
  - The citizenship bills, if one reaches the Journal of Laws.
  - A new consular fee tariff, or a change to item 27 of the stamp duty annex. Either is a new version from its date.
  - The country guide `pl` version 1 does not list the consular fees regulation; a version 2 that adds it goes in a pull request of its own.
  - Not modeled, in [OPEN-QUESTIONS.md](../../OPEN-QUESTIONS.md): a cost in a currency other than the version's, and whether the stamp duty is also collected when a consul takes the application.

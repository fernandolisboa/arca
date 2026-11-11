# Citizenship by descent

Checked 2026-10-31; the Italy rows on art. 3-bis and the Poland rows on 2026-11-06; the Italy rows on fees, the time limit and the central office on 2026-11-11, in the [audit of `it-descent`](routes/it-descent.md).

A second citizenship from an E-2 treaty country opens the U.S. E-2 investor visa, and a European one opens the whole EU. Mapping every adult's parents and grandparents is one of the first intake tasks.

## Italy

| Fact | Source |
| --- | --- |
| Law 74/2025 (the "Tajani decree") limits new recognitions mainly to children and grandchildren whose Italian parent or grandparent held only Italian citizenship | [InfoMoney](https://www.infomoney.com.br/minhas-financas/apos-decisao-da-corte-brasileiros-podem-voltar-a-solicitar-cidadania-italiana-veja/) |
| Applications or court cases filed by 2025-03-27 follow the previous rules | [Dias e Dias](https://diasediasadvogados.com.br/blog/ate-que-geracao-tem-direito-a-cidadania-italiana/) |
| Italy is an E-2 treaty country | [Alaz Law](https://www.alazlaw.com/blog/e-2-visa-countries-list-2026-treaty-investor/) |
| Art. 3-bis of law 91/1992 (in force since 2025-05-24) treats someone born abroad who holds another citizenship as never Italian unless a parent or grandparent holds, or held at death, only Italian citizenship, a parent lived in Italy for two continuous years after becoming Italian and before the birth, or the case was filed by 2025-03-27. Modeled in `it-descent` v1, and unchanged in v2 and v3 | [Normattiva](https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1992-02-05;91) |
| The Constitutional Court upheld art. 3-bis (sentenza 63/2026), then asked the EU Court of Justice whether EU law precludes it (ordinanza 147/2026, 2026-07-23). The law applies until that answer; a ruling against it needs a new version | [63/2026](https://www.cortecostituzionale.it/scheda-pronuncia/2026/63), [147/2026](https://www.cortecostituzionale.it/scheda-pronuncia/2026/147) |
| Since 2026-02-19 (Legge 11/2026, which replaced art. 10 of Decreto legislativo 71/2011) an adult's application through a consulate is decided within 36 months, and until 2028-12-31 each consulate takes per year no more adult applications than the recognitions it concluded in 2025, never fewer than 100. From 2029-01-01 adults living abroad apply by post to a central office of the Foreign Ministry, limited in 2029 and 2030 to the number of applications the consulates collected the fee for in 2025. Modeled in `it-descent` v2 (from 2026-02-19) and v3 (from 2029-01-01) | [Legge 11/2026](https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:2026-01-19;11~art1), [art. 10](https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2011-02-03;71~art10) |
| Fees since 2025-01-01: EUR 600 for an adult's application through a consulate (consular fee table, art. 7-bis), up to EUR 600 at a municipality that chooses to charge (Legge 207/2024, art. 1, comma 636), EUR 600 for each claimant in court (D.P.R. 115/2002, art. 13, comma 1-sexies). Possible costs in `it-descent` v2 and v3, since the case does not record the path | [Legge 207/2024](https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:2024-12-30;207), [D.P.R. 115/2002](https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.del.presidente.della.repubblica:2002-05-30;115~art13) |
| Not modeled yet: the two years of residence (no residence-history fact), filings by 2025-03-27, adoption, the pre-1948 maternal line (no sex fact), an Italian parent who also holds another citizenship (art. 3-bis may bar the parent too), minors who become citizens by declaration (art. 4), and minors who follow a parent who becomes Italian after their birth (art. 14). Each leaves the answer open | |
| A dead ancestor's citizenships are read as held at death, since the snapshot has no death date: death is not recorded as a loss | |
| To read next: Interior Ministry circulars 26185 (2025-05-28) and 36356 (2025-07-24) on applying art. 3-bis; their host is not on the `it` official-domain list yet | |

## Portugal

| Fact | Source |
| --- | --- |
| Children of Portuguese citizens keep their right unchanged; grandchildren keep it with new requirements | [Cidadania Luso](https://cidadanialuso.com.br/regulamentacao-lei-da-nacionalidade-portuguesa) |
| Portugal is an E-2 treaty country since 2024 | [Pollak](https://www.pollakimmigration.com/e2-visa/e2-visa-portuguese) |

## Poland

| Fact | Source |
| --- | --- |
| Polish citizenship by descent is not granted but confirmed: someone born to a Polish parent was Polish from birth, and the voivode issues a decision confirming it (2009 act, art. 55). There is no generation limit, but every birth down the line must have passed it under the law then in force | [Dz.U. 2025 poz. 1611](https://dziennikustaw.gov.pl/DU/2025/1611) |
| From 2012-08-15 (2009 act, art. 14) a child of at least one Polish parent is Polish by birth. Modeled in `pl-descent` v1 as the only link that settles the answer. Art. 6(1) counts a parent established more than a year after the birth (late paternity) as no parent for this; a link cannot read when a biological parent was established, so the route reads every recorded one as a parent from birth | [Dz.U. 2025 poz. 1611](https://dziennikustaw.gov.pl/DU/2025/1611) |
| 1962-08-21 to 2012-08-14 (1962 act, art. 4 and 6): a child of a Polish parent was Polish, but with one foreign parent both parents could choose the foreign citizenship within three months of the birth. Left open: no fact records that declaration | [1962 act](https://api.sejm.gov.pl/eli/acts/DU/1962/49/text.pdf) |
| 1951-01-19 to 1962-08-20 (1951 act, art. 6, 8 and 9): a child was Polish when both parents were; with one foreign parent, only when born in Poland (unless the parents chose otherwise within a month) or abroad under reciprocity. Left open: a link names one parent only | [1951 act](https://api.sejm.gov.pl/eli/acts/DU/1951/25/text.pdf) |
| 1920-01-31 to 1951-01-18 (1920 act, art. 5, 11 and 13): a child born in wedlock took the father's citizenship, one born out of wedlock the mother's; a Pole lost it by acquiring a foreign citizenship or serving a foreign state without consent, and the loss extended to his wife and children under 18. Left open: no sex or legitimacy fact, and a recorded loss is the only loss the engine sees | [1920 act](https://api.sejm.gov.pl/eli/acts/DU/1920/44/text.pdf) |
| Not modeled yet: births before 1920-01-31 (citizenship then came from settlement, not descent), adoption (2009 act, art. 16 and earlier rules), the 1951 act's art. 4 exclusions for people abroad, and restoration (art. 38). Each leaves the answer open, except an ancestor whose Polish citizenship is recorded only from 1920 with a child born earlier, which reads as no citizenship at that birth. The law has no generation limit; the engine looks back four generations, its maximum | |
| A person below the Polish ancestor holds Polish citizenship through the line itself, usually unconfirmed, so a family rarely records it. The route leaves such a link open instead of reading the missing entry as no citizenship; only the ancestor at the top must have it recorded. A loss recorded on that person reads the same way, since the snapshot cannot tell a lost entry from a missing one at the child's birth | |
| The act dates come from the Sejm's ELI API (`entryIntoForce` of DU/1920/44, DU/1951/25, DU/1962/49 and DU/2012/161) | [api.sejm.gov.pl](https://api.sejm.gov.pl/eli/acts/DU/1962/49) |

## Japan

See [other-destinations.md](other-destinations.md#japan): Nikkei long-term resident status up to the third generation.

## How the tree is reused

One finding on a parent's line covers several people: if a grandparent was born in Italy, the parent is a child and their adult children are grandchildren of that Italian. The engine evaluates every person's lines and propagates.

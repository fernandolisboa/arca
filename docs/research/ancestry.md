# Citizenship by descent

Checked 2026-10-31; the Italy rows on art. 3-bis on 2026-11-06.

A second citizenship from an E-2 treaty country opens the U.S. E-2 investor visa, and a European one opens the whole EU. Mapping every adult's parents and grandparents is one of the first intake tasks.

## Italy

| Fact | Source |
| --- | --- |
| Law 74/2025 (the "Tajani decree") limits new recognitions mainly to children and grandchildren whose Italian parent or grandparent held only Italian citizenship | [InfoMoney](https://www.infomoney.com.br/minhas-financas/apos-decisao-da-corte-brasileiros-podem-voltar-a-solicitar-cidadania-italiana-veja/) |
| Applications or court cases filed by 2025-03-27 follow the previous rules | [Dias e Dias](https://diasediasadvogados.com.br/blog/ate-que-geracao-tem-direito-a-cidadania-italiana/) |
| Italy is an E-2 treaty country | [Alaz Law](https://www.alazlaw.com/blog/e-2-visa-countries-list-2026-treaty-investor/) |
| Art. 3-bis of law 91/1992 (in force since 2025-05-24) treats someone born abroad who holds another citizenship as never Italian unless a parent or grandparent holds, or held at death, only Italian citizenship, a parent lived in Italy for two continuous years after becoming Italian and before the birth, or the case was filed by 2025-03-27. Modeled in `it-descent` v1 | [Normattiva](https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1992-02-05;91) |
| The Constitutional Court upheld art. 3-bis (sentenza 63/2026), then asked the EU Court of Justice whether EU law precludes it (ordinanza 147/2026, 2026-07-23). The law applies until that answer; a ruling against it needs a new version | [63/2026](https://www.cortecostituzionale.it/scheda-pronuncia/2026/63), [147/2026](https://www.cortecostituzionale.it/scheda-pronuncia/2026/147) |
| Not modeled yet: the two years of residence (no residence-history fact), filings by 2025-03-27, adoption, the pre-1948 maternal line (no sex fact), an Italian parent who also holds another citizenship (art. 3-bis may bar the parent too), minors who become citizens by declaration (art. 4), and minors who follow a parent who becomes Italian after their birth (art. 14). Each leaves the answer open | |
| A dead ancestor's citizenships are read as held at death, since the snapshot has no death date: death is not recorded as a loss | |
| To read next: Interior Ministry circulars 26185 (2025-05-28) and 36356 (2025-07-24) on applying art. 3-bis; their host is not on the `it` official-domain list yet | |

## Portugal

| Fact | Source |
| --- | --- |
| Children of Portuguese citizens keep their right unchanged; grandchildren keep it with new requirements | [Cidadania Luso](https://cidadanialuso.com.br/regulamentacao-lei-da-nacionalidade-portuguesa) |
| Portugal is an E-2 treaty country since 2024 | [Pollak](https://www.pollakimmigration.com/e2-visa/e2-visa-portuguese) |

## Japan

See [other-destinations.md](other-destinations.md#japan): Nikkei long-term resident status up to the third generation.

## How the tree is reused

One finding on a parent's line covers several people: if a grandparent was born in Italy, the parent is a child and their adult children are grandchildren of that Italian. The engine evaluates every person's lines and propagates.

# Portugal

Checked 2026-10-31 and 2026-11-01.

## Naturalization

| Fact | Source |
| --- | --- |
| Lei Orgânica n.º 1/2026 in force since 2026-05-19: 7 years of legal residence for Brazilians and other Portuguese-speaking countries' nationals (was 5); 10 for most others | [Cidadania e Visto](https://www.cidadaniaevisto.com.br/blog/nacionalidade-por-tempo-de-residencia) |
| Time counts from the issuance of the residence permit, not from arrival | [Panrotas](https://www.panrotas.com.br/mercado/destinos/2026/05/portugal-eleva-de-5-para-7-anos-prazo-para-cidadania-de-brasileiros_228228.html) |
| Applications pending before the new law follow the previous wording | [Cidadania e Visto](https://www.cidadaniaevisto.com.br/blog/cidadania-portuguesa-por-naturalizacao-requisitos) |
| Regulation of the new law approved by the Council of Ministers on 2026-10-29 | [Cidadania Luso](https://cidadanialuso.com.br/regulamentacao-lei-da-nacionalidade-portuguesa) |

## Residence visas

D7 and D8 are now route versions `pt-d7` and `pt-d8` in `packages/knowledge/data/routes`, verified against the Diário da República on 2026-11-05. Version 2 of each, added on 2026-11-07, corrects version 1 from its first day: Lei n.º 23/2007 does not apply to nationals of EU or EEA states or of Switzerland (article 4.º, n.º 2, a), Portugal included, so a principal who holds any of those citizenships is not eligible. Version 3 of each, added on 2026-11-07 after the country guide's reading of the same texts, corrects version 2 from its first day: the portaria measures the means test against the minimum wage net of social security contributions (Portaria n.º 1563/2007, article 2.º, n.º 2), so it uses EUR 818.80, 89% of EUR 920 after the worker's 11% (Código dos Regimes Contributivos, article 53.º), and a spouse counts only when both spouses are 18 or over (Lei n.º 23/2007, article 99.º, n.º 6). D8's own income floor of four minimum wages (Decreto Regulamentar n.º 84/2007, article 31.º-A) stays gross. Where they differ from these notes, the route versions win: the means test counts 50% of the minimum wage for every adult after the principal (Portaria n.º 1563/2007, article 2.º), and D8 also needs the household means test.

Both versions use the 2026 guaranteed minimum monthly wage (RMMG), EUR 920 (Decreto-Lei n.º 139/2025). On 2026-11-06 the Diário da República had no decree setting the RMMG for 2027, so the next versions of `pt-d7` and `pt-d8` (v4, after the v2 and v3 corrections above) wait for it ([#220](https://github.com/fernandolisboa/arca/issues/220)). The last decrees came out on 2023-11-17 ([DL 107/2023](https://diariodarepublica.pt/dr/detalhe/decreto-lei/107-2023-224427489)), 2024-12-19 ([DL 112/2024](https://diariodarepublica.pt/dr/detalhe/decreto-lei/112-2024-900706889)) and 2025-12-29 ([DL 139/2025](https://diariodarepublica.pt/dr/detalhe/decreto-lei/139-2025-992879809)), checked the same day.

| Visa | Fact | Source |
| --- | --- | --- |
| D7 (passive income) | EUR 920/month for the applicant (2026 minimum wage), +50% for a spouse, +30% per child; practice recommends 12 months of reserve. The portaria itself uses the net minimum wage, which the route versions follow from v3 | [Ternrise](https://ternrise.com/pt/blog/visto-d7-portugal-2026-guia-completo), [Cidadania e Visto](https://www.cidadaniaevisto.com.br/blog/comprovacao-meios-visto-portugal-2026) |
| D8 (digital nomad) | EUR 3,680/month of active income from outside Portugal | [Cidadania e Visto](https://www.cidadaniaevisto.com.br/blog/diferenca-entre-visto-d7-e-d8) |
| D2 (entrepreneur) | No minimum amount in law; business viability and means for 12 months | [Cidadania e Visto](https://www.cidadaniaevisto.com.br/blog/melhor-visto-para-portugal) |

## Family reunification

Checked on 2026-11-05 against the consolidated Lei n.º 23/2007: the two-year wait is article 98.º, n.º 1, as amended by Lei n.º 61/2025, with the exceptions of n.º 3. Adult children qualify only when they study in Portugal (article 99.º, n.º 1, d), except for holders under article 90.º-A. Not yet a route version: the schema has no fact for how long the principal has held residence.

| Fact | Source |
| --- | --- |
| Covers spouse, minor children, adult children who are single, dependent and studying, and first-degree ascendants of the resident or spouse who are dependent on them | [AIMA](https://aima.gov.pt/documents/ari-reagrupamento-familiar.pdf) |
| A minor needs written authorization from the non-resident parent, when applicable | [Ternrise](https://ternrise.com/pt/blog/reagrupamento-familiar-portugal-requisitos-documentacao) |
| From 2026 the general rule requires two years of legal residence before applying, with exceptions such as minors | [Jobbatical](https://www.jobbatical.com/es/blog/portugal-family-reunification-guide) — verify against the 2026 Foreigners Law |
| New Foreigners Law promulgated on 2026-08-31 | [Cidadania e Visto](https://www.cidadaniaevisto.com.br/blog/portugal-valida-nova-lei-dos-estrangeiros-o-que-muda-para-brasileiros-que-buscam) |

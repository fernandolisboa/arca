# ADR-0042: Regions inside a country on the comparison screen

- Status: Accepted
- Date: 2026-11-25
- Amends: [ADR-0026](0026-destination-comparison-data.md) (an adult's stars may be kept per region, and each country carries its regions' ranking), [ADR-0035](0035-suggested-ratings.md) (suggested stars per region, from a second reviewed file)

## Context

On 2026-11-25 the owner, watching a video about the Azores, asked whether the comparison recommends states or cities and not only countries. It did not: a country was one row, so Portugal's score could not tell Lisbon from the Azores, nor Florida from Massachusetts. He agreed to a region layer for the United States, Portugal and Spain, scored with the criteria he already weighs, from public sources, with no model call (his API credit is nearly spent). A visa is granted by the country, so regions change where to live, not which route applies.

## Decision

- **A region is an ISO 3166-2 subdivision** (`US-FL`, `ES-CT`, `PT-20`): United States states and the District of Columbia, Spain's autonomous communities and cities, and Portugal's eighteen mainland districts with its two autonomous regions. Its country is the code's first two letters. Names come from the catalog (`regions.<code>`), since `Intl.DisplayNames` does not name subdivisions; a missing name shows the code.
- **A reviewed data file.** `packages/knowledge/regions/<n>.json` lists the regions and, per suggestion key, the stars each region gets with the value, year and source behind them, in the shape of the suggested-ratings file. The build validates the highest-numbered file against `regionRatingsSchema` and ships it beside the country file. Like that file it is a reviewed pull request with no activation, quote check or official-domain list: the stars are a starting point the adult overrides, never an immigration rule.
- **Scoring.** `compareDestinations` scores each region of a compared country with the adult's own weights. On a personal or own criterion, a region takes the adult's stars for the region, else the region's suggested stars, else its country's score, marked `inherited`. Indicator and category criteria read country data only, so a region always inherits them. A region's total and coverage are computed as a country's; regions rank inside their country, ties broken by code, and a region with no total has no place. A region never enters the country ranking.
- **Ratings per place.** The ratings map is keyed by a place code, a country or a region, so an adult can rate the Azores apart from Portugal through the same preferences write. The API refuses anything else, and the rest of the preferences contract is unchanged.
- **How stars are made.** The bands are ADR-0035's, so a region and its country are judged alike, with three differences: housing is a region's price as a percentage of its country's level, turned into stars by applying the ADR-0035 housing bands to the country's ICP housing value scaled by that percentage; language rates Spain's co-official languages beside Spanish (Galician 4, Catalan and Valencian 3, Basque 2); and taxes add the regional or state top rate to the national one. `packages/knowledge/test/region-ratings-bands.test.ts` recomputes every star from its value.
- **Sources, all read 2026-11-25.** Climate: NOAA statewide means 1991–2020, AEMET normals 1981–2010 and IPMA normals 1991–2020 at the regional or district capital. Taxes: Tax Foundation state rates for 2026 plus the federal top rate; Agencia Tributaria's 2025 regional scales plus the state top rate; the Autoridade Tributária's reading of the Azores 30% cut and Madeira's regional decree 17/2026/M. Housing: BEA regional price parities 2024, MIVAU appraised value Q2 2026, INE Portugal median sale value Q2 2026 in the district capital. Jobs: BLS LAUS 2025, INE España EPA 2025, INE Portugal 2025 by NUTS II. Brazilian community: Census ACS 2020–2024 and INE España's 2026 census. Direct flight: ANAC's scheduled international flights from Brazil, October 2025 to September 2026 (a region is `direct` when its airport had regular scheduled flights from Brazil in those twelve months). Time zone: IANA. Co-official languages: each statute of autonomy on the BOE. The screen shows each as plain text, never a link.
- **Gaps inherit the country.** No regional value is a known value: Hawaii's and DC's climate, Leiria and Viana do Castelo's climate, Ceuta's climate, Navarre's and the Basque Country's foral taxes, Ceuta and Melilla's taxes, mainland Portugal's taxes (national), mainland Portuguese unemployment outside the Algarve, Portugal's Brazilian community by district (the AIMA report could not be read), and every region's distance, schools, safety, healthcare and cost of living.
- **Screen.** On a wide screen, a country with regions gets "Ver as N regiões", which opens its regions as rows under it, in the same columns, with the scores they inherit in grey and their own sources behind "Ver as fontes". On a phone, the card lists the regions in order, each opening to its criteria. The lead says the visa is the country's.

## Consequences

- The adult sees where to live inside a destination with the weights they already chose, and can rate a region apart from its country.
- A region's total mixes its own data with its country's, so the screen marks every inherited score; regions of a country with few regional keys rank close together.
- Adding a country's regions, or refreshing values, is a new numbered file in a reviewed pull request, due when the screen flags sources as more than 90 days old, as for country suggestions. A region without a name in the catalog shows its code until the catalog names it; a test fails when the file and the catalog disagree.
- A wrong or tampered file shifts every adult's region ranking with no activation, held back only by the reviewers and the band test; it never decides eligibility, and the adult's own stars override it.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Cities instead of regions | Few comparable official sources per city across three countries, and many more rows to keep current |
| Regions as countries in the ranking | Would suggest a region has its own visa, and would double-count the country's data |
| Regional indicators in a new comparison version | Needs the owner's activation and turns personal criteria into objective ones the adult can no longer override per region |

# ADR-0035: Suggested ratings on the comparison screen, from public data in the repository

- Status: Accepted; amended 2026-11-25 by [ADR-0042](0042-regions-in-the-comparison.md): suggested stars per region from a second reviewed file, which beat the adult's stars for the region's country
- Date: 2026-11-21
- Amends: [ADR-0026](0026-destination-comparison-data.md) (a personal or own criterion may be scored from a suggested rating until the adult rates it), [ADR-0034](0034-criterion-suggestions.md) (a ready suggestion can come with stars per country)

## Context

On 2026-11-21 the owner saw every country of "Comparar destinos" at "Sem nota" and 0% coverage: the criteria he had added were rated by stars, and he had no idea what to give a country he does not know, so that country would never rank. He asked for Arca to suggest each country's stars on each criterion, with a source, for him to keep or change, and for the suggestions to be generated once, in a development session, with no model call at run time (his API credit is nearly spent).

## Decision

- **A reviewed data file.** `packages/knowledge/suggested-ratings/<n>.json` holds, per suggestion key, the stars (1 to 5) each country gets, the measured value behind them (a decimal string or a token), its year when the source gives one, and a source from the file's source list. A suggestion key is a personal criterion's ID (`climate`) or a ready suggestion's ID (`housing-cost`). The build validates the highest-numbered file against `suggestedRatingsSchema` and ships it in the API's runtime module. A new file is a reviewed pull request, with the repository's reviewers, and nothing else: there is no activation step, no quote check and no official-domain list, since a suggestion is a starting point the adult accepts or overrides, never a fact the app asserts about an immigration rule.
- **Not immigration rules.** Time to citizenship, dual citizenship and diploma recognition are rules, which CLAUDE.md rule 1 keeps in the rule base, so they get no suggested stars here. Public university cost has no comparable cross-country source yet and gets none either. A criterion without a suggestion behaves as before.
- **Scoring.** `compareDestinations` takes the suggestions. For a personal or own criterion the adult has not rated in a country, the suggested stars score it exactly like stars the adult gave; the adult's own stars always win, and the score carries the suggestion beside them, flagged stale like an indicator reading once its source is more than 90 days old. A country with no suggestion stays unknown. Coverage counts a suggested score as known, so countries the adult has never heard of enter the ranking.
- **Matching own criteria.** A criterion the adult created finds its suggestions when its name matches, compared like `plainName`, the name the interface gives a suggestion key (the pt-BR catalog's `compare.criterion` and `compare.suggestion`). The match runs in the API; renaming the criterion drops the suggestion. The app has only pt-BR, whose catalog names every ready suggestion; a second locale will need the key stored on the own criterion when it is added. Nothing about it reaches a model or a log.
- **Screen.** Unrated stars show the suggestion as outlined stars; the line under them says "Sugestão do Arca", why (the value, worded per key in the catalog) and the source with its date; "Usar esta nota" stores the suggestion as the adult's own stars, and any star the adult picks replaces it.
- **Sources.** They are official or reputable statistics (World Bank, OECD, UN, MIPEX, PwC), not immigration law, so they sit outside the official-domain lists that pin rule and indicator sources; the screen shows them as plain text, never as a link.
- **How stars are made.** Each value turns into stars with fixed bands, the same for every country; `packages/knowledge/test/suggested-ratings-bands.test.ts` recomputes every star from its value with these bands, so stars can never drift from the value shown:

| Key | Value | 5 | 4 | 3 | 2 | 1 |
| --- | --- | --- | --- | --- | --- | --- |
| `climate` | Mean annual temperature of the country, °C (World Bank CCKP, ERA5 1991–2020) | ≥ 20 | ≥ 15 | ≥ 11 | ≥ 7 | < 7 |
| `language` | Main language (CIA World Factbook) | Portuguese | Spanish, Italian | English | | other |
| `schools` | Mean PISA 2022 score over mathematics, reading and science (OECD) | ≥ 500 | ≥ 485 | ≥ 465 | ≥ 420 | < 420 |
| `jobs` | Unemployment, % (World Bank, ILO model) | ≤ 4 | ≤ 6 | ≤ 8 | ≤ 11 | > 11 |
| `taxes` | Highest marginal personal income tax rate, % (PwC Worldwide Tax Summaries, read 2026-11-21; local taxes included where they make most of it) | ≤ 15 | ≤ 25 | ≤ 37 | ≤ 48 | > 48 |
| `distance-to-brazil` | Great-circle km from São Paulo to the capital (World Bank coordinates) | ≤ 3,000 | ≤ 7,000 | ≤ 9,500 | ≤ 12,000 | > 12,000 |
| `brazilian-community` | Migrants born in Brazil (UN DESA International Migrant Stock 2024) | ≥ 150,000 | ≥ 50,000 | ≥ 10,000 | ≥ 1,000 | < 1,000 |
| `housing-cost` | ICP 2021 price level of housing and utilities, world = 100 (World Bank) | ≤ 60 | ≤ 110 | ≤ 160 | ≤ 230 | > 230 |
| `welcome-to-immigrants` | MIPEX 2020 overall score | ≥ 75 | ≥ 65 | ≥ 55 | ≥ 45 | < 45 |
| `stability` | Worldwide Governance Indicators, political stability score 0–100 (World Bank) | ≥ 85 | ≥ 75 | ≥ 65 | ≥ 55 | < 55 |
| `direct-flight` | Scheduled non-stop flight from Brazil (ANAC): `direct` or `connection` | direct | | | connection | |
| `time-zone` | Hours from Brasília, the capital's standard time (IANA) | ≤ 1 | ≤ 3 | ≤ 5 | ≤ 8 | > 8 |
| `public-transport` | SDG 11.2.1, mean over the cities UN-Habitat reports, % | ≥ 92 | ≥ 85 | ≥ 75 | ≥ 50 | < 50 |
| `banking` | Adults with an account, % (World Bank Global Findex 2024) | ≥ 97 | ≥ 90 | ≥ 80 | ≥ 65 | < 65 |
| `outdoors` | Terrestrial protected areas, % of land (World Bank) | ≥ 28 | ≥ 21 | ≥ 15 | ≥ 8 | < 8 |

A source that has no value for a country (MIPEX for Georgia, Paraguay and Uruguay; UN DESA's Brazil row for the United Kingdom and Georgia) leaves that country without a suggestion on that key.

## Consequences

- Every country with a route ranks from the first visit; the adult refines what matters.
- The suggestions are coarse proxies (a country's mean temperature, cities' access to transport), so the screen always shows the value and the source behind them.
- A country added to the route catalog has no suggestions until the next file. Refreshing them is another session run and pull request, with no model at run time, due when the screen flags the sources as more than 90 days old, as it does for indicators, or when a country is added; the data years run from 2020 to 2025.
- A merged file changes every adult's ranking with no activation. A wrong or tampered file is held back only by the reviewers and the band test; it never decides eligibility, and each adult's own stars override it.

## Alternatives considered

| Option | Why not |
| --- | --- |
| A model suggests the stars when the screen opens | Costs a call per view, the owner's credit is nearly spent, and the stars would not be reproducible |
| Store the suggestions in each adult's ratings | They would stop updating when the file improves, and a confirmed star could not be told from a suggested one |
| Add the suggestions as comparison indicators | Needs the owner's activation of a new comparison version and turns personal criteria into objective ones the adult can no longer override per country |

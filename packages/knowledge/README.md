# @arca/knowledge

The knowledge base as data: route versions, country sets, official-domain lists and the countries files, validated and hashed ([spec 0002](../../docs/specs/0002-rules-engine-and-knowledge-base.md), [ADR-0014](../../docs/adr/0014-knowledge-base-as-reviewed-data.md)). Route versions, country sets and official-domain lists now live in the database's `knowledge` schema ([ADR-0031](../../docs/adr/0031-rule-updates-on-request.md)): the files here were imported once, and the API reads the rows. The countries files and comparisons are still bundled into the API.

## Layout

```text
data/countries/<n>.json                     current country codes (generated, R7)
data/former-countries/<n>.json              former states, ISO 3166-3 (R7)
data/occupations/<n>.json                   ISCO-08 unit groups, the occupation codes (ADR-0036)
data/study-fields/<n>.json                  ISCED-F 2013 four-digit fields, the field-of-study codes (ADR-0036)
data/official-domains/<id>/<n>.json         official source hosts per country or body
data/country-sets/<id>/<n>.json             versioned country sets
data/routes/<route-id>/<n>.json             one file per route version
data/routes/<route-id>/<n>.cases.json       table-driven cases for that version (R8)
data/indicators/<id>/<n>.json               country indicators for the destination comparison (ADR-0026)
data/comparisons/<id>/<n>.json              comparison versions: criteria and the indicators they pin
data/hashes.json                            committed content hashes, append-only
suggested-ratings/<n>.json                  the comparison's suggested stars per country (ADR-0035); not rules, no activation
departure-checklists/<n>.json               what to do when leaving a country, with official sources (ADR-0038); no activation
rule-texts/pt-BR/<route-id>.json            route version titles in Portuguese, keyed by their English (ADR-0037); not rules, no activation
scripts/                                    load, validate, hash and write the catalog; generate countries
vendor/cldr/<release>/                      the pinned CLDR territories file, its license and manifest
src/                                        the runtime entry; pure, no I/O
src/generated/catalog.ts                    route data, written by the build, not checked in; only the bundled entry reads it
src/generated/runtime.ts                    what the API ships: countries files, comparisons and the latest suggested ratings; written by the build
test/fixtures/data/                         fixture routes on user-assigned codes, with cases (R8)
test/cases/                                 the cases runner
test/history.test.ts                        selection over the fixture version histories, with decision states (R5, R8)
test/performance.test.ts                    the engine's trace-size bound over every fixture route (R5)
```

Every file in `data` is immutable once on `main`. A change is a new numbered file; `hashes.json` and cases files only gain entries. The required check `knowledge-immutable` enforces this from `main` on every pull request (the rules in `tooling/scripts/src/knowledge-immutable.ts`, run by `check-knowledge-immutable.ts`; it reads hosts with the same `hostOf` the build uses, from `@arca/scripts/host`; run it locally with `pnpm check:knowledge-immutable`). It also keeps official-domain lists in pull requests of their own, refuses a new country guide (guides were retired with the independent check, [ADR-0031](../../docs/adr/0031-rule-updates-on-request.md)), and admits a file under `vendor` only once `.github/policy/vendored.json` on `main` approves it.

## Building

`pnpm --filter @arca/knowledge catalog` (the Turborepo task `@arca/knowledge#catalog`, which `typecheck`, `lint`, `test` and `build` depend on) runs `scripts/build.ts`:

1. Reads every file under `data`. A file outside the layout, a symbolic link or a file over 1 MB is an issue.
2. Parses each one in the accepted JSON subset: UTF-8 without a byte order mark, integers only and within ±(2^53 − 1), strings in NFC (checked, never normalized) with no control, format or invisible characters, no duplicate keys, bounded nesting.
3. Validates it against the schemas in `@arca/domain` and the rules of spec 0002 R6: IDs and numbers match the path, numbers are contiguous, pins resolve to valid files, official sources and their machine-readable addresses (`machineReadableUrl`, an optional data address of the same text, on an official source only) sit on a pinned official host, members and route countries are in the pinned countries files, `verifiedAt` is not after the build date, and version dates and corrections stay inside their bounds.
4. Hashes each route version, country set, country indicator and comparison version: SHA-256 over the RFC 8785 canonical JSON of `{ "version": <file>, "pinned": { "<kind>/<id>/<number>": <file>, … } }`, holding every file it pins, transitively.
5. Compares every hash, and the hashes of the RFC 8785 test vectors, with `data/hashes.json`.
6. Writes `src/generated/catalog.ts` (route data) and `src/generated/runtime.ts` (what the API ships), with the highest-numbered `suggested-ratings/<n>.json` checked against `suggestedRatingsSchema`; a new suggested ratings file is a new number, and `test/suggested-ratings-bands.test.ts` recomputes its stars from their values ([ADR-0035](../../docs/adr/0035-suggested-ratings.md)), and the highest-numbered `departure-checklists/<n>.json` checked against `departureChecklistsSchema` ([ADR-0038](../../docs/adr/0038-departure-checklists.md)), and every `rule-texts/pt-BR/<route-id>.json`, checked against `ruleTextFileSchema`, its file name and for a title translated twice ([ADR-0038](../../docs/adr/0037-rule-texts-in-the-screens-language.md)). Any issue fails the build and deletes both modules, so no tool keeps serving an earlier catalog.

## The import into the database

`scripts/rule-import.ts` (`pnpm --filter @arca/knowledge import:sql`) writes the migration `packages/db/migrations/<timestamp>_knowledge_rule_import/migration.sql` from `data`: every route version (with its cases file), country set and official-domain list, each with the hash the build computed, inserted with `ON CONFLICT DO NOTHING` after a check that aborts if a stored row has another hash ([ADR-0031](../../docs/adr/0031-rule-updates-on-request.md)). It ran once with the migrations; the migration journal never runs it again, and it is never edited. `test/rule-rows.test.ts` generates it again and compares it with the committed file, so any change to a route version, country set or official-domain list in `data` fails the tests: rules now change through update requests in the app, never here.

## Session reviews

`reviews/<review>/` holds the route versions a session review wrote ([ADR-0032](../../docs/adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../docs/runbooks/session-rule-review.md)): for each, the version, its cases with inline snapshots, and the official passages every item rests on. `scripts/session-review.ts` lists the reviews and checks each version as the app checks an update request's proposal; its evidence goes through the app's quote check. `test/session-review.test.ts` writes the review's migration (`vitest -u`) and compares it in CI; `apps/api/test/session-review-quotes.test.ts`, run by the `review-quotes` CI job and by the session with `ARCA_REVIEW_QUOTES=<review>`, finds every quote on its official page.

An official-domain list pins nothing, so its hash is the same `{ version, pinned }` form with no pins. `src/rule-rows.ts` reads rows back as the build read the files: each row parses by its schema, names the ID and number it is stored under and hashes, over everything it pins, to its stored hash; a row that does not, or that pins one that does not, is refused.

## Countries

`data/countries/<n>.json` is generated, never written by hand. `pnpm --filter @arca/knowledge countries:generate` runs `scripts/generate-countries.ts`, which only a maintainer runs and never `pnpm check` or the build. It checks the vendored CLDR file and license against the pins in `scripts/countries.ts`, keeps every alpha-2 region CLDR lists except the exclusions there (`XK` stays), and writes the next numbered file. It fails on any code that is neither excluded, admitted nor in the previous countries file, and on any code of the previous file the release drops unless it is withdrawn, so a new CLDR release's changes are classified in `reclassification` (in `scripts/countries.ts`) by a reviewed change first. A new release is vendored after its entry is approved in `.github/policy/vendored.json`; then update the pins and regenerate.

`data/former-countries/<n>.json` lists ISO 3166-3 codes, with sources; their names live in the i18n catalogs (`formerCountries`), because `Intl.DisplayNames` names only current countries. A test in `@arca/i18n` fails when a code has no name. User-assigned codes `QM` to `QZ` (except `QO` and `QU`) are for test fixtures only, and the real build rejects them.

## Classifications

Occupations and fields of study are codes from two official classifications ([ADR-0036](../../docs/adr/0036-case-records-and-classifications.md)), each a numbered file like the countries file: `{ "schemaVersion": 1, "id", "number", "classification", "sources", "codes" }`, with the codes sorted.

- `data/occupations/<n>.json`: the 436 ISCO-08 unit groups, from the ILO's [ISCO-08 structure and definitions](https://www.ilo.org/ilostat-files/ISCO/newdocs-08-2021/ISCO-08/ISCO-08%20EN%20Structure%20and%20definitions.xlsx) workbook (the rows of level 4).
- `data/study-fields/<n>.json`: the 148 four-digit ISCED-F 2013 fields, from Eurostat's [code list `ISCEDF13`, version 2.3](https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/codelist/ESTAT/ISCEDF13/2.3?format=TSV&lang=en) (the codes `F` plus four digits, without the `F`; the aggregates such as `F0113_0114` are Eurostat's, not the classification's).

A route version pins one in `occupations` or `studyFields` only when a rule reads such a code; its hash then covers the file, and validation refuses a code the pinned file lacks and a code read with no pin. Each code's pt-BR label lives in `@arca/i18n` (`occupations`, `studyFields`, and the groups the picker shows them under), and its test fails on a code without one.

To refresh one when the source publishes a new list: download the source into an empty directory of its own and treat it as untrusted data (export the workbook to CSV with a tool already at hand, never run its macros, and add no parser dependency without an ADR), take the codes as above, write them sorted as the next numbered file with the source's `verifiedAt`, run the build, and give `test/classifications.test.ts` the new file's counts and the SHA-256 of its codes joined by newlines; then add a label for every new code. Files already on `main` never change, so versions that pin them keep their codes.

## Comparison data

The destination comparison reads `comparisons/<id>/<n>.json`, which pins the `indicators/<id>/<n>.json` it scores ([ADR-0026](../../docs/adr/0026-destination-comparison-data.md)). An indicator holds one value per country (a decimal string or a token), its year and the source it comes from; a country without a value is unknown. A criterion is `indicator` (scored linearly from `zeroAt` to `tenAt`, so the anchors also give the direction), `category` (a score per token, every token scored) or `personal` (rated by each person). Refreshing values or adding a criterion is a new indicator version and a new comparison version, activated as a whole (an indicator's hash is recorded in `hashes.json` but never activated alone, and the build allows exactly one comparison series); criterion IDs stay stable across versions, since people's weights and ratings point at them. `@arca/knowledge` exports `comparisonCatalog`, which hands out a full entry only for an active version, like `routeCatalog`.

To refresh the World Bank values, run `pnpm --filter @arca/knowledge comparison:fetch` (`scripts/fetch-world-bank.ts`, run by a maintainer and never in CI). For every country with a route it writes the next file of each indicator: the most recent non-empty year from the API (`mrnev=1`), rounded half-even to two decimal places, with countries the API has no value for left out. Then write the next comparison version pinning them, run the build and append the hashes it prints. The indicators it reads and their units are listed in the script.

## Tags

Tags are free strings in each version, never an enumeration in code, so a new one is a data change. Use one route type and one outcome where they apply, and reuse an existing tag before adding one:

- Route type: `work`, `investment`, `study`, `family`, `descent`, `retirement`, `digital-nomad`, `humanitarian`, `seasonal-work`, `regional-agreement`.
- Outcome: `temporary-residence`, `permanent-residence`, `citizenship`.

## Adding a file

Add the new numbered file, run the build, and append the `{ "path", "sha256" }` entry the build prints for it to `files` in `data/hashes.json`. Never edit an existing entry: a hash that changes means the canonicalizer or a pinned file changed, and an activation of the old content no longer covers it.

## Changing a rule

- **A rule change** (the law changed): a new version numbered after the last one, with an `effectiveFrom` strictly after every earlier version's, corrections included.
- **A rule change dated earlier** than the latest version: write it as a correction of the version in effect from the latest `effectiveFrom` onward, carrying the merged content.
- **A data error** (the version was wrong from the start): a new version with `corrects: <n>`, where `n` is the version it fixes. Its `effectiveFrom` goes in one of three places:
  - the date of the version it fixes, which it then replaces entirely (a tie goes to the higher number);
  - an earlier date, when the original started too late;
  - a later date inside the original's period, for an error found late.

The build checks a correction by its outcome: added to the lower-numbered versions, all treated as active, selection must pick it from its `effectiveFrom` on wherever it picked the fixed version, another correction of it or a version its chain removes (and, for an early start, the run just before, without taking all of an unrelated version's run), and nothing else may change. So a correction never shadows a version it does not fix, and a newer correction is never shadowed by an older one. Old evaluations keep pointing at the version they used.

## Cases

Every route version ships with `<n>.cases.json` beside it, and `test/cases` runs them all through `evaluateVersion`, for `data` and for the fixture routes in `test/fixtures/data`:

```json
{
  "schemaVersion": 1,
  "cases": [
    {
      "id": "children-income-unknown",
      "family": { "id": "couple-young-children", "number": 1, "sha256": "<SHA-256 of the file>" },
      "principal": "p1",
      "rulesAsOf": "2026-10-01",
      "fx": { "rates": [{ "from": "BRL", "to": "EUR", "rate": "0.16", "date": "2026-09-30", "source": "…" }] },
      "expected": {
        "status": "missing_information",
        "dependents": ["p2", "p3", "p4"],
        "possibleDependents": [],
        "missingFacts": ["person.monthlyPassiveIncome@p3", "person.monthlyPassiveIncome@p4"]
      }
    }
  ]
}
```

- A case has a `family` from `eval/families/<id>/<n>.json`, pinned by the hash of its bytes, or an inline `snapshot`. Families are synthetic and never change, which `knowledge-immutable` enforces: extending one is a new number. Optional: `factsAsOf`, `referenceDates` (`{ "filingDate": "2026-09-01" }`) and `fx`.
- `missingFacts` are written as the runner prints them: `<fact>@<person>`, with ` edge <edge>` or ` line <ids>` when the fact is read across one; `relationship <edge>`; `marker <marker>@<person>`.
- Coverage, from the results: every requirement is true, false and unknown at least once; every dependent rule includes someone and, on its own, excludes someone (unless its condition cannot be false: the literal `true`, `unmodeled`, an `any` with such an operand, an `all` of them, or the `not` of a condition that cannot be true); a rule whose condition cannot be true (`unmodeled`, an `all` with such an operand, an `any` of them, or the `not` of a condition that cannot be false) makes someone possible instead of including anyone; an open version reaches `eligible` (`needs_assessment` when it has assessments), `not_eligible` and `missing_information`; a closed one, `unavailable`.
- Cases in `data` are append-only (fixture cases are test code and change with the engine in review). When a change to `packages/domain/src` changes a result, add a case with `supersedes` and `reason` that differs only in `expected`; the runner skips the case it replaces.

## Staleness

A source is stale when it was verified more than 90 days before the context's `today` (spec 0002, R9), which the evaluation records. An evaluation lists the stale sources it cites, its pinned country sets' included, and `evaluateRoute` sets `stale` only on the version in effect today, never on a superseded one reached through a past `rulesAsOf`. `pnpm --filter @arca/knowledge staleness-report [date]` prints the stale sources of the version each route selects, every version treated as active, as identifiers only. Re-verifying a source is a new version.

## Runtime entry points

- `@arca/knowledge` exports `ruleDataFromRows`, which reads rule rows into the versions whose hashes still hold, and `createRouteCatalog`, the `RouteCatalog` the engine reads over them: every version's identity, and a full entry only for an exact identity (route, number and content hash) whose decision state is active. It also exports `datasetFiles`, `comparisonCatalog` and `pinnedCountries`.
- `@arca/knowledge/bundled` exports the rules as `data` holds them (`bundledRuleData`, `routeCatalog`, `routeIds`), for tests and tools. The API never imports it; a test of the Nitro build checks that no route version reaches the server bundle.
- `@arca/knowledge/display` exports `createDisplayCatalog(rules)`, every version whatever its state, for the activation screen only.
- `@arca/knowledge/reproduction` exports `createReproductionLookup(entries)`, which ignores decision states so an old evaluation stays reproducible. Modules and folders named `reproduction` are reserved for it: lint allows importing them only in the cases runner (`test/cases`), the reproduction path (`src/reproduction`, `test/reproduction`) and the lookup's own test, and those files may not re-export it with `export … from` (passing it on any other way is for review to catch). Inside this package only the entry points read the generated modules.

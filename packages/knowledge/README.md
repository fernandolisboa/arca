# @arca/knowledge

The knowledge base as data: route versions, country sets, official-domain lists, country guides and the countries files, validated, hashed and bundled into the API ([spec 0002](../../docs/specs/0002-rules-engine-and-knowledge-base.md), [ADR-0014](../../docs/adr/0014-knowledge-base-as-reviewed-data.md)).

## Layout

```text
data/countries/<n>.json                     current country codes (generated, R7)
data/former-countries/<n>.json              former states, ISO 3166-3 (R7)
data/official-domains/<id>/<n>.json         official source hosts per country or body
data/country-sets/<id>/<n>.json             versioned country sets
data/routes/<route-id>/<n>.json             one file per route version
data/routes/<route-id>/<n>.cases.json       table-driven cases for that version (R8)
data/indicators/<id>/<n>.json               country indicators for the destination comparison (ADR-0026)
data/comparisons/<id>/<n>.json              comparison versions: criteria and the indicators they pin
data/guides/<country>/<n>.json              country guides for the independent check (ADR-0027)
data/hashes.json                            committed content hashes, append-only
scripts/                                    load, validate, hash and write the catalog; generate countries
vendor/cldr/<release>/                      the pinned CLDR territories file, its license and manifest
src/                                        the runtime entry; pure, no I/O
src/generated/catalog.ts                    written by the build, not checked in
test/fixtures/data/                         fixture routes on user-assigned codes, with cases (R8)
test/cases/                                 the cases runner
test/history.test.ts                        selection over the fixture version histories, with decision states (R5, R8)
test/performance.test.ts                    the engine's trace-size bound over every fixture route (R5)
```

Every file in `data` is immutable once on `main`. A change is a new numbered file; `hashes.json` and cases files only gain entries. The required check `knowledge-immutable` enforces this from `main` on every pull request (the rules in `tooling/scripts/src/knowledge-immutable.ts`, run by `check-knowledge-immutable.ts`; it reads hosts with the same `hostOf` the build uses, from `@arca/scripts/host`; run it locally with `pnpm check:knowledge-immutable`). It also keeps official-domain lists, and country guides, in pull requests of their own and admits a file under `vendor` only once `.github/policy/vendored.json` on `main` approves it.

## Building

`pnpm --filter @arca/knowledge catalog` (the Turborepo task `@arca/knowledge#catalog`, which `typecheck`, `lint`, `test` and `build` depend on) runs `scripts/build.ts`:

1. Reads every file under `data`. A file outside the layout, a symbolic link or a file over 1 MB is an issue.
2. Parses each one in the accepted JSON subset: UTF-8 without a byte order mark, integers only and within ±(2^53 − 1), strings in NFC (checked, never normalized) with no control, format or invisible characters, no duplicate keys, bounded nesting.
3. Validates it against the schemas in `@arca/domain` and the rules of spec 0002 R6: IDs and numbers match the path, numbers are contiguous, pins resolve to valid files, official sources sit on a pinned official host, members and route countries are in the pinned countries files, `verifiedAt` is not after the build date, and version dates and corrections stay inside their bounds.
4. Hashes each route version, country set, country indicator, comparison version and country guide: SHA-256 over the RFC 8785 canonical JSON of `{ "version": <file>, "pinned": { "<kind>/<id>/<number>": <file>, … } }`, holding every file it pins, transitively.
5. Compares every hash, and the hashes of the RFC 8785 test vectors, with `data/hashes.json`.
6. Writes `src/generated/catalog.ts`. Any issue fails the build and deletes the module, so no tool keeps serving an earlier catalog.

## Countries

`data/countries/<n>.json` is generated, never written by hand. `pnpm --filter @arca/knowledge countries:generate` runs `scripts/generate-countries.ts`, which only a maintainer runs and never `pnpm check` or the build. It checks the vendored CLDR file and license against the pins in `scripts/countries.ts`, keeps every alpha-2 region CLDR lists except the exclusions there (`XK` stays), and writes the next numbered file. It fails on any code that is neither excluded, admitted nor in the previous countries file, and on any code of the previous file the release drops unless it is withdrawn, so a new CLDR release's changes are classified in `reclassification` (in `scripts/countries.ts`) by a reviewed change first. A new release is vendored after its entry is approved in `.github/policy/vendored.json`; then update the pins and regenerate.

`data/former-countries/<n>.json` lists ISO 3166-3 codes, with sources; their names live in the i18n catalogs (`formerCountries`), because `Intl.DisplayNames` names only current countries. A test in `@arca/i18n` fails when a code has no name. User-assigned codes `QM` to `QZ` (except `QO` and `QU`) are for test fixtures only, and the real build rejects them.

## Comparison data

The destination comparison reads `comparisons/<id>/<n>.json`, which pins the `indicators/<id>/<n>.json` it scores ([ADR-0026](../../docs/adr/0026-destination-comparison-data.md)). An indicator holds one value per country (a decimal string or a token), its year and the source it comes from; a country without a value is unknown. A criterion is `indicator` (scored linearly from `zeroAt` to `tenAt`, so the anchors also give the direction), `category` (a score per token, every token scored) or `personal` (rated by each person). Refreshing values or adding a criterion is a new indicator version and a new comparison version, activated as a whole (an indicator's hash is recorded in `hashes.json` but never activated alone, and the build allows exactly one comparison series); criterion IDs stay stable across versions, since people's weights and ratings point at them. `@arca/knowledge` exports `comparisonCatalog`, which hands out a full entry only for an active version, like `routeCatalog`.

To refresh the World Bank values, run `pnpm --filter @arca/knowledge comparison:fetch` (`scripts/fetch-world-bank.ts`, run by a maintainer and never in CI). For every country with a route it writes the next file of each indicator: the most recent non-empty year from the API (`mrnev=1`), rounded half-even to two decimal places, with countries the API has no value for left out. Then write the next comparison version pinning them, run the build and append the hashes it prints. The indicators it reads and their units are listed in the script.

## Country guides

`guides/<country>/<n>.json`, where `<country>` is the lowercase ISO 3166-1 alpha-2 code, is what a specialist in that country knows, which the independent check reads beside the pages a route version cites ([ADR-0027](../../docs/adr/0027-admins-and-the-checked-batch-activation.md)). It holds:

- `laws`: the laws and regulations that govern the country's routes, each with a `title`, a `url` on a host of an official-domain list the guide pins (`officialDomains`), the date it was read (`verifiedAt`) and how it is usually amended (`amendment`).
- `pitfalls`: known traps in reading those laws, each naming the `laws` it is about.

Free text (`amendment` and a pitfall's `text`) is plain prose of at most 600 characters, with no angle brackets and no URLs. A guide is never a source and never widens what counts as official: the pages a version cites stay the authority, and the check ranks the guide below them. The build validates guides, hashes each one with the files it pins like other knowledge files, and `@arca/knowledge` exports `countryGuide(code)`, which answers a country's highest guide version and its hash, by the uppercase code.

A guide is a trust root: a pull request that adds one changes no other knowledge data except the `hashes.json` append (guides for several countries may land together). A change to a guide is a new numbered file, so a report that recorded the old guide's hash goes stale. Write a guide in an authoring session from the official texts themselves, covering every route of the country in the catalog.

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

- `@arca/knowledge` exports `routeCatalog`, the `RouteCatalog` the engine reads: every version's identity, and a full entry only for an exact identity (route, number and content hash) whose decision state is active. It also exports `countryGuide`, the lookup of each country's current guide.
- `@arca/knowledge/reproduction` exports `reproductionEntry(routeId, number, hash)`, which ignores decision states so an old evaluation stays reproducible. Modules and folders named `reproduction` are reserved for it: lint allows importing them only in the cases runner (`test/cases`), the reproduction path (`src/reproduction`, `test/reproduction`) and the lookup's own test, and those files may not re-export it with `export … from` (passing it on any other way is for review to catch). Inside this package only the two entry points read the built catalog.

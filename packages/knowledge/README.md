# @arca/knowledge

The knowledge base as data: route versions, country sets, official-domain lists and the countries files, validated, hashed and bundled into the API ([spec 0002](../../docs/specs/0002-rules-engine-and-knowledge-base.md), [ADR-0014](../../docs/adr/0014-knowledge-base-as-reviewed-data.md)).

## Layout

```text
data/countries/<n>.json                     current country codes (generated, R7)
data/former-countries/<n>.json              former states, ISO 3166-3 (R7)
data/official-domains/<id>/<n>.json         official source hosts per country or body
data/country-sets/<id>/<n>.json             versioned country sets
data/routes/<route-id>/<n>.json             one file per route version
data/routes/<route-id>/<n>.cases.json       table-driven cases for that version (R8)
data/hashes.json                            committed content hashes, append-only
scripts/                                    load, validate, hash and write the catalog
src/                                        the runtime entry; pure, no I/O
src/generated/catalog.ts                    written by the build, not checked in
```

Every file in `data` is immutable once on `main`. A change is a new numbered file; `hashes.json` and cases files only gain entries.

## Building

`pnpm --filter @arca/knowledge catalog` (the Turborepo task `@arca/knowledge#catalog`, which `typecheck`, `lint`, `test` and `build` depend on) runs `scripts/build.ts`:

1. Reads every file under `data`. A file outside the layout, a symbolic link or a file over 1 MB is an issue.
2. Parses each one in the accepted JSON subset: UTF-8 without a byte order mark, integers only and within ±(2^53 − 1), strings in NFC (checked, never normalized), no duplicate keys, bounded nesting.
3. Validates it against the schemas in `@arca/domain` and the rules of spec 0002 R6: IDs and numbers match the path, numbers are contiguous, pins resolve to valid files, official sources sit on a pinned official host, members and route countries are in the pinned countries files, `verifiedAt` is not after the build date, and version dates and corrections stay inside their bounds.
4. Hashes each route version and country set: SHA-256 over the RFC 8785 canonical JSON of `{ "version": <file>, "pinned": { "<kind>/<id>/<number>": <file>, … } }`, holding every file it pins, transitively.
5. Compares every hash, and the hashes of the RFC 8785 test vectors, with `data/hashes.json`.
6. Writes `src/generated/catalog.ts`. Any issue fails the build and writes nothing.

## Adding a file

Add the new numbered file, run the build, and append the `{ "path", "sha256" }` entry the build prints for it to `files` in `data/hashes.json`. Never edit an existing entry: a hash that changes means the canonicalizer or a pinned file changed, and an activation of the old content no longer covers it.

## Runtime entry points

- `@arca/knowledge` exports `routeCatalog`, the `RouteCatalog` the engine reads: every version's identity, and a full entry only for an exact identity (route, number and content hash) whose decision state is active.
- `@arca/knowledge/reproduction` exports `reproductionEntry(routeId, number, hash)`, which ignores decision states so an old evaluation stays reproducible. Lint allows importing it only in the cases runner (`test/cases`), the reproduction path (`src/reproduction`) and its own test.

# Spec 0002: Rules engine and knowledge base

- Status: Ready for tickets
- Date: 2026-11-02
- Epic: consultancy core ([ROADMAP.md](../ROADMAP.md#phase-1--family-mvp-web)), slice 1
- Decisions: [ADR-0014](../adr/0014-knowledge-base-as-reviewed-data.md), [ADR-0002](../adr/0002-rules-as-versioned-data.md), [ADR-0004](../adr/0004-ai-providers-behind-ports.md), [ADR-0010](../adr/0010-stack-revised.md)

## Goal

The deterministic core that every consultancy service reads: a rule schema that can express any route, a pure evaluation engine that applies a route version to a case snapshot, unit computation per route, and a knowledge catalog of versioned, sourced, tested route data. After this slice, adding a route is a data change: a JSON file and its cases.

## Scope

**In:** calendar dates and money in `packages/domain`; the case snapshot and the fact catalog; the rule schema; the evaluation engine, unit computation and the active-version rule; `packages/knowledge` with the country dataset, country sets, official domains, the catalog loader, validation, content hashes and the immutability check; fixture routes and the synthetic families corpus; the staleness report.

**Out:** real route data (slice 2); storing cases, intake, any AI, and the activation screen with its passkey verification (slice 3); ranking and routes chained to citizenship (slice 4); documents, steps and action points (slice 5); retrieval (slice 6); FX rate feeds and the simulator (slice 7); any API route or UI.

**No case data.** Every snapshot in this slice is synthetic, and the snapshot schema has no names, document numbers or free text.

## The epic: consultancy core

Each slice gets its own spec when it starts. Order and dependencies:

| Slice | Delivers | Depends on |
| --- | --- | --- |
| 1. Rules engine and knowledge base (this spec) | Schema, engine, units, catalog | Foundations scaffold (spec 0001; the workspace, boundaries and CI it uses are merged) |
| 2. Knowledge seed | Route versions for the first countries, from official sources, with cases; research notes in `docs/research/` are the starting point | Slice 1 schema (R4); the owner's choice of countries |
| 3. Case model and text intake | Case tables under forced row-level security, free-text intake through the `Extractor` port, playback and correction, decisive questions, permissions per person and unit, audit log, and the activation screen (ADR-0014) | Slice 1; the rest of the foundations epic (passkeys, synthetic `development` branch, deletion and export, retention, incident runbook, observability with scrubbing); an Anthropic API budget |
| 4. Comparison and recommendation | Destination comparison weighted per person, ranking of route combinations, routes chained to citizenship | Slices 2 and 3 |
| 5. Checklist and plan | Documents, steps, action points, execution modes; decides whether knowledge items and action points are files like route versions | Slice 4 |
| 6. On-call assistant | Answers with cited sources over active knowledge | Slices 2 and 3; an `Embedder` vendor ADR |
| 7. Assets and currency | Tax and FX simulator, source-of-funds trail, official FX rates | Slices 1 and 3 |

**Active versions only.** Every use that reaches a user (evaluations, the questions derived from them, retrieval, checklists) reads active versions only, through one interface that returns nothing else. Version selection may read proposed versions' identity to report `pending_activation`, never their content; only the activation screen shows proposed versions.

Intake is proposed as text first ([OPEN-QUESTIONS.md](../OPEN-QUESTIONS.md)). Voice joins later through the `SpeechToText` port, with its own vendor ADR.

## Layout

```text
packages/
  domain/
    src/calendar/     CalendarDate, PartialDate, Duration
    src/money/        Money, Decimal, FX conversion
    src/case/         CaseSnapshot schema and the fact catalog
    src/rules/        rule schema, expressions, version selection, active versions, engine, units
  knowledge/
    data/countries/<n>.json                     current country codes, generated (R7)
    data/former-countries/<n>.json              former states, reviewed and sourced (R7)
    data/official-domains/<country>/<n>.json    official source hosts per country, versioned
    data/country-sets/<id>/<n>.json             versioned country sets with sources
    data/routes/<route-id>/<n>.json             one file per route version
    data/routes/<route-id>/<n>.cases.json       table-driven cases for that version
    test/fixtures/                              fixture routes on user-assigned codes (R8)
    src/                                        the runtime entry: the built catalog and its index
    scripts/                                    build (load, validate, hash), country generator,
                                                immutability check, staleness report
eval/
  families/           synthetic case snapshots, shared with later AI evaluation
```

## Requirements

### R1. Packages and boundaries

- New package `@arca/knowledge`. This slice updates the boundary matrix in spec 0001 R2 and `tooling/scripts/src/check-boundaries.ts`: `packages/knowledge` may depend on `domain`; `apps/api` may also depend on `knowledge`. Nothing else changes.
- `@arca/domain` gains `zod` (already in the catalog) as its only runtime dependency. It stays pure: the domain lint rules of spec 0001 R2 apply unchanged, so no clock, no I/O, no hashing.
- In `packages/knowledge`, `src` is the runtime entry and does no I/O: it exports the catalog the build produced. File reading, validation and hashing live in `scripts`, which run at build and in CI.
- `fast-check` joins the catalog for property tests in `domain` and `knowledge` (see [Versions](#versions)).

### R2. Calendar dates and money

- **Dates.** `CalendarDate` is an ISO 8601 calendar date (`YYYY-MM-DD`) with no time or time zone. Operations: parse and validate, compare, add a `Duration`, whole years and months between two dates, and age at a date.
  - `Duration` is ISO 8601 `PnYnMnD`. Adding one applies years, then months, clamps to the month's last day, then adds days (as `Temporal.PlainDate.add` does).
  - Durations are compared only anchored to a date: "at least P2Y since D" means `D + P2Y <= reference date`. A duration range uses a single unit, so its bounds always order.
  - Age at a date counts whole years. A 29 February birthday turns a year older on 28 February in common years by default; a route version can set `leapDayBirthday: "march-1"` for jurisdictions that use 1 March.
  - `PartialDate` (a year, or a year and month) exists for ancestors, whose records are often incomplete. A comparison with a partial date is true or false only when every date it could be gives the same answer; otherwise unknown.
  - When `Temporal.PlainDate` is available on the runtime and in TypeScript's library, it can replace the implementation behind the same interface.
- **Money.** `{ amount, currency }`: `amount` is an integer in minor units (a safe integer), `currency` an ISO 4217 code with its minor-unit exponent from a table in the package. No floating point anywhere in money or rates.
- **Decimals.** Multipliers, shares and FX rates are decimal strings (up to 12 fractional digits), computed with `bigint` scaled arithmetic.
- **Rounding.** Comparisons use exact values: a converted or multiplied amount is compared with a threshold before any rounding. Only reported amounts (costs and totals) are rounded half-even to minor units, once, after an exact sum.
- **FX.** Conversion uses an `FxTable` the caller supplies: rates with their date and source. The rate for a pair is the latest dated on or before `factsAsOf` and at most 7 days older. The engine never fetches a rate. A missing rate makes the comparison unknown and is reported under `missingRates`, never as a question for the family.
- Property tests cover date arithmetic and month-end clamping, ages around birthdays and leap days, partial-date comparisons, money addition and comparison, and conversion rounding.

### R3. Case snapshot and fact catalog

- **`CaseSnapshot`** is the engine's only view of a case, a Zod schema in `packages/domain/src/case`. People carry opaque IDs and structured facts only: birth date, citizenships (country, acquired and lost dates, basis), country of residence, education (ISCED 2011 level), languages (BCP 47 language, CEFR level), income (active or passive, monthly amount, source country), assets (kind, owners with shares, value with its valuation date, liquidity), immigration history (country, event kind such as a visa refusal, date), financial dependence on another person, and whether the person is studying.
- **Relationships** are typed edges: `spouse` and `partner` (with start and end dates) and `parent` (with kind, such as biological or adoptive, and custody). Other relationships are derived: an ex-spouse is a `spouse` edge that ended, an in-law is a path such as `spouse.parent`, a sibling shares a parent. The graph may hold people who are not case members, such as grandparents.
- **Unknown versus none.** An absent field is unknown, never false. Fields whose usual answer is that something has not happened take an explicit value for it: an end date of a `spouse` or `partner` edge, a lost date of a citizenship and a sale of an asset are a date, `"none"`, or absent (unknown). A present list is complete, so `[]` means none.
- **Completeness markers.** Each person carries directional markers for relationships: `spouses`, `partners`, `children` and `parents` recorded in full. Without the marker, people who are not recorded may exist: a collection over them has no upper bound, and the missing marker is itself a decisive missing fact (R5). Table cases cover absent, `"none"`, empty and complete for each.
- The schema has no free-text fields, names or document numbers, so a snapshot cannot carry instructions. Objects are strict: unknown keys fail validation.
- **Fact catalog.** Rules read facts by key (for example `person.ageYears`, `person.citizenships`, `unit.liquidAssets`). The catalog in `packages/domain` maps each key to its value type, its scope (`principal`, `candidate`, `member` inside a collection, `ancestor` inside a line) and the pure function that derives it from the snapshot and the context.
  - Derived facts such as age, elapsed time or the unit's liquid assets are computed here, in code. Money facts that aggregate across assets return the route version's currency, converted per R2.
  - Facts in a line of ancestors can read the next person toward the principal (for example `lineage.childBirthDate`), so "the ancestor was a citizen when the next person in the line was born" is expressible. `lineage.links` is the collection of people strictly between an ancestor and the principal (empty for a parent, where `every` is true), so an unbroken line (each link a citizen at the next birth) is expressible with `every`. Inside a nested collection, `person.*` and `lineage.*` bind to the current link, and the ancestor stays readable as `lineage.ancestor.*`.
  - A fact can be read at a named reference date from the context (for example the filing date, for age protections) instead of `factsAsOf`. A missing named date makes the fact unknown and is reported under `missingDates`.
- A rule that names a key outside the catalog, or compares it with a value of the wrong type, fails validation. Adding a fact is a reviewed code change in `domain`; adding a route never is.

### R4. Rule schema

Zod schemas in `packages/domain/src/rules`, exported as JSON Schema for editors (`z.toJSONSchema`), with `schemaVersion: 1` on every file. Objects are strict. The schema evolves additively; a breaking change adds a schema version that the engine supports alongside the old one, so old versions still evaluate.

- **Route.** `id` (`<country code in lowercase>-<slug>`, for example `pt-d7`), country, tags (free strings such as `work`, `investment`, `descent`, `seasonal-work`; never an enumeration in code) and its versions.
- **Route version.** Route ID; number (contiguous from 1); `effectiveFrom` (a `CalendarDate`); optional `corrects` (R6); `status` (`open` or `closed`); `currency`; optional `leapDayBirthday`; `sources`; `countrySets`, `officialDomains` and `countries` (references pinned to an exact ID and number); `requirements`; `assessments`; `dependents`; `costs`; `durations`. A `closed` version (for example, an abolished golden visa) has no requirements, dependents or costs, and cites an official source for the closure.
- **Sources.** Each has an ID, an `https` URL, a title, a kind (`official` or `secondary`) and `verifiedAt`. Every requirement, assessment, dependent rule, cost and duration cites at least one `official` source by ID. A source is `official` only if its host is on the official-domain list version the route version pins (R6). Matching uses the parsed URL: `https` only, no user information or port, the host lowercased and in ASCII (punycode), equal to a listed host or a subdomain of it on a label boundary (`www.uscis.gov` matches `uscis.gov`; `evil-uscis.gov` does not). Secondary sources may be added beside an official one, never instead.
- **Free text.** Titles, names and tags are plain strings capped at 200 characters, rendered escaped, and never passed to a model as instructions.
- **Expressions.** A JSON tree with a closed set of operators, evaluated without `eval`, regular expressions or user code:
  - Values: boolean, integer, decimal, money, date, duration, country code, string enum from the fact catalog, pinned country set.
  - Comparisons: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `intersects`.
  - Logic: `all`, `any`, `not`.
  - Arithmetic: `add`, `sub`, `mul` (by a decimal), `min`, `max`, so a threshold can depend on the unit (Portugal D7 shape: a base amount, plus a share per adult dependent and per child).
  - Money operands must share a currency; mixing currencies fails validation unless an operand is wrapped in `convert(expression, currency)`.
  - Dates: `since(date, duration)`, true when the date plus the duration is on or before `factsAsOf`, or a named reference date when the expression names one.
  - Collections: `count`, `sum`, `some` and `every` over people (`unit.members`, which includes the principal; `unit.dependents`; `principal.ancestors`, everyone reachable from the principal through `parent` edges up to a generation depth given in the expression, at most 4, whether a case member or not), each with a condition per person.
  - Limits checked by validation: depth at most 16 and at most 500 nodes per version.
- **Logic is three-valued** (Kleene): true, false or unknown. Unknown propagates through comparisons and arithmetic; `all` is false if any operand is false, `any` is true if any operand is true. Collections carry bounds: `count` and `sum` over members whose condition or membership is unknown yield a known minimum and maximum, and a comparison is decided when both bounds give the same answer.
- **Requirements** are named expressions on the principal and the unit, each with sources. **Assessments** model judgment calls (for example, national importance in an EB-2 NIW petition) as named factors with the evidence facts that support them, never as pass or fail (ADR-0002).
- **Dependents.** Rules of the form *relationship path from the principal* (`spouse`, `partner`, `child`, `parent`, or a composition of up to three steps such as `spouse.parent`) *plus a condition on the candidate* (for example, unmarried and under 21; or financially dependent on the principal). Each step crosses only edges valid at `factsAsOf`, or at the rule's named reference date (start on or before it, and end `"none"` or after it); an unknown start or end makes the candidate possible. So `spouse` means a current spouse, and an ex-spouse is never reached. Conditions read `candidate`, `principal` and `edge` facts (kind, custody, start and end of the path's last edge), never `unit` facts, so a unit cannot depend on itself. Paths never return the principal and remove duplicates. This expresses U.S. EB-5's spouse and unmarried children under 21 and Portuguese family reunification's dependent parents of the resident or spouse, without a fixed family partition.
- **Costs.** Kind (`fee`, `capital`, `proof_of_means`), an amount expression in the version's currency, who it applies to (`principal`, `each_dependent`, `unit`), an optional condition, and sources.
- **Durations.** Named stages (for example, to a decision, to residence) as a single-unit `Duration` range with sources.
- **Country sets** (for example, E-2 treaty countries, Mercosur members) are versioned files that cite an official source and pin their own official-domain and countries versions. A route version pins each set it uses by ID and number, so a new set version reaches a route only through a new route version. The same holds for official-domain lists.

### R5. Evaluation engine and unit computation

Pure functions in `packages/domain/src/rules`, with no I/O and no model calls. The catalog hands the engine `CatalogEntry` values: a validated version with its content hash and the country-set and official-domain versions it pins (R6). The engine reads sets only from the entry, never from the caller.

- **Context:** `rulesAsOf` (the date that selects the version: today, or a filing date when a route keeps old rules for pending applications), `factsAsOf` (the date ages and elapsed times are computed at; defaults to `rulesAsOf`), named reference dates, `today` (for staleness only), the `FxTable`, the activations, and the engine's commit (for reproducibility, ADR-0014).
- `selectVersion(route, rulesAsOf)` picks, among **all** versions, the one in effect: the greatest `effectiveFrom` on or before `rulesAsOf`, and on a tie the highest number. Only then is activation checked: if the selected version is not active, the result is `pending_activation`. The engine never falls back to an older active version, so a proposed closure or a proposed correction is never silently ignored. Selection reads only the identity of proposed versions (number, `effectiveFrom`, `status`, hash); their content is never evaluated for a case.
- `activeVersions(catalog, activations)` and the `Activation` type live in `domain` too: a version is active when an activation names its route ID, number and content hash. Verifying the passkey assertion behind an activation is the API's job (slice 3); `domain` only matches hashes.
- `computeUnit(snapshot, entry, principalId, context)` returns the dependents the version covers (included), the ones it might cover pending unknown facts (possible, with those facts), and everyone else with the reason they are out. Units are computed, never stored. Possible dependents count as unknown members, so collection bounds (R4) and `each_dependent` costs reflect them: costs give a known total plus the possible extra.
- `evaluateVersion(snapshot, entry, principalId, context)` evaluates one given version, with no selection and no activation check. It returns an `Evaluation`: route ID, version number, content hash, the dates of the context, principal, unit, status, each requirement's result with its sources and a trace, each assessment with evidence present and missing, the decisive missing facts, `missingRates`, `missingDates`, costs per item with totals per currency, durations, the FX rates it used, and `stale` (R9). Table-driven cases (R8) and the reproduction of an old evaluation use it.
- `evaluateRoute(snapshot, route, principalId, context)` is selection, then the activation check, then `evaluateVersion`. It adds `newerProposedVersion` when a version with a higher number than the selected one is not active, and the activation the evaluation relied on.
- **Status**, first match wins: `unavailable` (no version in effect), `pending_activation` (the version in effect is not active; `evaluateRoute` only), `unavailable` (the version is `closed`), `not_eligible` (a requirement is false), `missing_information` (a requirement is unknown), `needs_assessment` (all requirements hold and the version has assessments), `eligible`. A proposed closure therefore shows as `pending_activation`, never as `unavailable`.
- **Decisive missing facts**, defined deterministically: empty when a requirement is false; otherwise, for each unknown requirement, the facts at its unknown leaves that are not cut off by a known operand (a false inside `all`, a true inside `any`), plus the completeness markers whose absence leaves a collection unbounded there. Facts that matter only together are both listed. Missing FX rates and context dates are reported apart, since the family cannot answer them. Slice 3 turns them into "only the questions that change the answer".
- **Evaluations are personal data.** A snapshot, an evaluation and its trace hold birth dates, assets, income and immigration history of several adults. They are never logged, never sent to error reports or workflow payloads, and slices 3 and 4 show each viewer only what that viewer may see (SECURITY.md principle 3).
- Performance: linear in the size of the expressions times the number of people; a test bounds a 12-person snapshot against the full fixture catalog.

### R6. Knowledge catalog

- **Build.** `scripts/build.ts` reads every file in `data`, validates it against R4, checks references (sources, pinned country sets, official domains, route ID prefix against the country) and writes the catalog, with hashes, into `dist`; `@arca/api` imports it. Nothing reads the data directory at runtime.
- **Content hash:** SHA-256 over the RFC 8785 canonical JSON of the route version together with every country-set, official-domain and countries version it pins, computed by the build with Node `crypto`. An activation therefore covers them too. JSON numbers are integers only, so canonicalization has no floating-point cases.
- **Corrections.** A rule change is a new version with a later `effectiveFrom`. A correction of a data error is a new version with `corrects: <n>`, where `n` is a lower version number, and any `effectiveFrom`: the date of the version it fixes (it wins the tie, R5), an earlier date when the original started too late, or a date inside an earlier period for a rule found late. Selection stays the same everywhere: the greatest `effectiveFrom` on or before `rulesAsOf`, ties to the highest number. Old evaluations keep pointing at the version they used and are reproduced with `evaluateVersion`.
- **Official domains.** `data/official-domains/<country>/<n>.json` lists the hosts that count as official for a country (for example `uscis.gov`, `travel.state.gov`), each with a source showing the host belongs to the government. Versioned and immutable like everything in `data`; each route version is validated against the list version it pins, so a later list never breaks an old version.
- **Immutability check** (`pnpm check:knowledge-immutable`, run in CI on pull requests): fails when a file under `data` that exists on the base branch is modified, renamed or deleted. Cases files are the one exception: entries may be added, but an existing entry (matched by its `id`) may not change or disappear. A case whose expected result must change after an engine fix gets a new entry with `supersedes: <id>`, a reason and the engine commit; the superseded entry stops running and no longer counts toward coverage.
- **Validation in `pnpm check`:** every file validates; version numbers are contiguous; among versions without `corrects`, `effectiveFrom` strictly increases with the version number; a `corrects` version names a lower number; every requirement, assessment, dependent rule, cost and duration cites an official source; `verifiedAt` is not after the build date; every version has a cases file that meets R8's coverage.
- **Review.** No reviewer changes. The reviewers check route data for structure and CLAUDE.md's domain rules; they cannot open the sources. Checking a rule's content against its official source is the owner's job on the activation screen (ADR-0014), which shows the rule and its source hosts side by side.

### R7. Countries

- `data/countries/<n>.json` is generated by `scripts/generate-countries.ts` from a pinned Unicode CLDR release (Unicode License v3), with the CLDR version and the source file's SHA-256 recorded in the file. It holds:
  - every current ISO 3166-1 alpha-2 code CLDR lists as a region. The generator excludes numeric macro-regions, grouping codes (`EU`, `EZ`, `UN`), the pseudo-regions `XA` and `XB`, `QO`, `ZZ` and, by an explicit list, the exceptionally reserved codes CLDR also lists (`AC`, `CP`, `DG`, `EA`, `IC`, `TA`).
  - `XK` (Kosovo) is included: CLDR lists it and it issues passports.
- `data/former-countries/<n>.json` is a reviewed, sourced list of former states with ISO 3166-3 four-letter codes (for example `CSHH` Czechoslovakia, `SUHH` Soviet Union, `YUCS` Yugoslavia, `DDDE` East Germany), allowed only in citizenship and ancestry facts, since many ancestors were citizens of states that no longer exist. Route versions pin it with the countries file.
- A regeneration is a new numbered file, like any other data, and the generator's test checks each file against its recorded source. Each route version and country set validates against the countries version it pins.
- Current country names come from `Intl.DisplayNames` in the reader's locale, so pt-BR names are natural Brazilian Portuguese and none is written by hand. `Intl.DisplayNames` maps former codes to their successors (`SU` reads as Russia), so former countries' names live in the i18n catalogs.
- The real catalog accepts only codes in this dataset. User-assigned codes `QM` to `QZ` (except `QO`, which CLDR uses, and `QU`) are reserved for fixtures and rejected outside `test/fixtures`.

### R8. Table-driven cases, fixtures and families

- **Cases.** Each `<n>.cases.json` lists entries for that version, run through `evaluateVersion`, with an `id`, a snapshot (inline, or a family from `eval/families` named by ID and the SHA-256 of its file, so a changed family fails the case), the principal, the context dates, FX rates when needed, and the expected status, unit and decisive missing facts. CI runs them all. Expected results live only here.
- **Coverage**, measured from the engine's trace across a version's cases: every requirement evaluates to true, false and unknown at least once; every dependent rule includes and excludes someone at least once; the statuses `eligible` (or `needs_assessment` when the version has assessments), `not_eligible` and `missing_information` each appear. A `closed` version needs one case, `unavailable`. Selection, `pending_activation` and `newerProposedVersion` are covered by the engine's own tests on the fixture routes, with fixture activations.
- **Fixture routes** prove the schema before real data exists. They use user-assigned country codes, are labeled as fixtures, and cover these shapes:
  - a threshold computed from the unit's composition (D7-like);
  - dependents limited to a spouse and unmarried children under 21, with an investment threshold in another currency than the assets (EB-5-like);
  - dependent parents of the principal or of the spouse (family-reunification-like);
  - citizenship by descent through a parent or grandparent, conditioned on the ancestor's citizenship when the next person in the line was born, with a partial date and a former country (Italian-descent-like);
  - eligibility through a pinned country set of the principal's citizenships (E-2-like);
  - a judgment factor with evidence (EB-2 NIW-like);
  - a seasonal work route tied to a job offer (H-2A-like);
  - a closed route, and a closure left proposed; a version replaced at a date, evaluated with a pending-applications `rulesAsOf`; a correction of an earlier version, not the latest; and a newer version left proposed.
- **Synthetic families** in `eval/families/`: a single person; a couple with young children; divorced parents with shared custody; dependent elderly parents; a previous visa refusal; assets held by an ex-spouse; and the shape of case 1 (six adults: a divorced couple, one holding real-estate assets, and their two adult children with spouses). All values are invented; nothing comes from the real family.

### R9. Staleness

- A source is stale when its `verifiedAt` is more than 90 days before the context's `today`. An evaluation that cites a stale source sets `stale: true`, so the interface can say the rule needs re-checking.
- `scripts/staleness-report.ts` lists stale sources by route. A weekly workflow (schedule and manual dispatch only) runs it and keeps one open issue up to date, found by a label and by the workflow's own author, never by title: `permissions: {}` at the top, `contents: read` and `issues: write` on its one job, actions pinned by SHA, a timeout, no secrets, an entry in the workflow-secrets policy. The issue is locked to collaborators.
- Agents re-verify by running the report locally and proposing new versions; they never take instructions from the issue's text or comments.

### R10. Docs

- A short `packages/knowledge/README.md`: how to add a route version, a correction and their cases.
- Spec 0001 R2's matrix, ARCHITECTURE.md, GLOSSARY.md and ROADMAP.md are updated with this spec.

## Versions

Checked on the npm registry on 2026-11-02. The newest release at least 7 days old, as in spec 0001.

| Package | Version | Why this one |
| --- | --- | --- |
| `zod` | 4.6.7 (catalog) | Already approved; now also a runtime dependency of `domain` |
| `fast-check` | 4.10.2 | Latest, published 2026-09-19; property tests for dates, money and three-valued logic. Same kind of tool as Vitest, so no ADR; provenance and license checked by the supply-chain reviewer when added |

No other dependency. RFC 8785 canonicalization and the CLDR generator are small, tested code in `knowledge`; hashing uses Node `crypto`.

## Threat model for this slice

Assets in play: the integrity of the knowledge base and of the engine. No personal data exists yet, but the engine's output is designed as personal data.

| Threat (STRIDE, LLM and agentic) | Where | Control |
| --- | --- | --- |
| Tampering: a wrong or poisoned rule reaches families | Catalog | Official source per item; table-driven cases with coverage; reviewers for structure; versions stay proposed until the owner checks them against their sources and activates them with a passkey (ADR-0014, slice 3) |
| Tampering: a country set changed under an active route | Catalog | Sets pinned by number; the content hash covers them; the engine reads sets only from the catalog entry; the activation screen lists their members |
| Tampering: an old version rewritten to change past results | Catalog | Immutability check against the base branch; content hash and engine commit in every evaluation |
| Tampering: a proposed closure or correction ignored | Engine | Selection over all versions; `pending_activation` instead of falling back |
| Spoofing: a phishing page labeled as an official source | Catalog | Official kind allowed only on the pinned official-domain list, matched on label boundaries in punycode; the activation screen shows each source's host and flags hosts new since the version it replaces |
| Tampering: a lookalike host added to an official-domain list | Catalog | Lists pinned by number inside the activated hash; each host cites a government source; the activation screen flags new hosts |
| Indirect prompt injection through researched pages | Slice 2 research | Structured data only; free text capped, escaped and never sent to a model as instructions |
| Indirect prompt injection through the staleness issue | CI, agents | Issue locked to collaborators; agents run the report locally and ignore the issue's text |
| Wrong eligibility from arithmetic or dates | Engine | Integer money, decimal strings, one half-even rounding, explicit conversion, calendar dates without time zones, anchored durations, property tests; no model in the path |
| Wrong answer presented as known | Engine | Three-valued logic; unknown versus none made explicit; collection bounds; decisive missing facts; missing FX rates reported apart |
| Intra-family exposure through evaluations | Slices 3 and 4 | Evaluations classed as personal data; shown per viewer; never logged or sent to telemetry |
| Denial of service through a pathological rule | Engine | Closed operator set, depth and node limits, no regular expressions, bounded paths and generations |
| Information disclosure: real data in fixtures | Repository | Snapshot schema without names or free text; synthetic families only; reviewers |
| Tampering: malicious dependency | Install | One new test dependency, under spec 0001's supply-chain controls |
| Elevation: the staleness workflow | CI | No secrets; least-privilege permissions; schedule and dispatch only; SHA-pinned actions |

## Definition of done

- Every requirement above is met and covered by a test or a CI check.
- The fixture catalog passes validation and coverage; every case, including those on synthetic families, passes.
- `pnpm check` and the immutability check run in CI.
- No user-facing string added; no personal data anywhere.

## Decisions from the grill

Taken on 2026-11-02 under the owner's standing instruction that agents decide technical matters, then revised after the reviewers' first pass.

| Question | Decision | Why |
| --- | --- | --- |
| Which epic is next? | Consultancy core, starting with the rules engine and knowledge base | Every MVP service reads them, and they need no case data, authentication or AI, so they can be built while the foundations finish |
| Where does the knowledge base live? | JSON files in `packages/knowledge`, bundled into the API (ADR-0014) | Git history, diff review and tests beside the data; public rules in a public repository; no admin editor needed yet |
| How is human approval recorded? | Proposed on merge, active only after the owner's passkey activation in the app, built in slice 3 (ADR-0014) | Agents act with the owner's GitHub token, so a merge proves nothing; a passkey assertion does |
| JSON or YAML? | JSON with a JSON Schema for editors | No parser at runtime, one canonical form for hashing; agents write it, people read the activation screen |
| How are missing facts handled? | Three-valued logic; unknown versus none explicit; collection bounds | A missing answer must never read as "not eligible", and the unknowns drive the next questions |
| How are thresholds that depend on the family expressed? | Arithmetic over unit collections in the expression tree | D7-like formulas without code per route |
| How are dependents expressed? | Relationship paths plus a condition on the candidate | Matches EB-5 and Portuguese reunification without a fixed partition (CLAUDE.md rule 4) |
| How is money computed? | Integer minor units, decimal strings, `bigint`, explicit conversion, one half-even rounding, FX passed in | CLAUDE.md rule 3; reproducible |
| Dates? | Own `CalendarDate` and `PartialDate`, no time zones, separate rules, facts and staleness dates | Ages and deadlines are calendar facts; `Temporal` can replace it later behind the same interface |
| Fact list open or closed? | Closed catalog in `domain`, extended by code review | Rules must be type-checked; a new fact is a schema extension, not a route change |
| How are data errors fixed when files are immutable? | A correcting version on the effective date of the version it fixes, which wins the tie | Rule changes and errata differ; both stay reproducible |
| How is reproducibility kept? | Immutable files, content hash over the version and its sets, engine commit in every evaluation | CLAUDE.md rule 6 |
| How fresh must a source be? | Stale after 90 days, flagged and reported weekly | 2026 showed rules changing within weeks (research/us.md) |
| How are countries listed? | Generated from a pinned CLDR release; names from `Intl.DisplayNames` | ISO 3166 codes without hand-written names or a new dependency |
| How is the schema proven before real data? | Fixture routes on user-assigned codes covering every hard shape | Real routes need research and activation; fixtures cannot be mistaken for real rules |
| API endpoints in this slice? | None | Nothing reaches users until slice 3 (YAGNI) |
| Text or voice intake? | Text first; voice later through `SpeechToText` | Voice adds a vendor ADR and builds on the text path; recorded in OPEN-QUESTIONS.md as provisional |

**For the owner** (asked separately and tracked in [OPEN-QUESTIONS.md](../OPEN-QUESTIONS.md); this spec does not depend on the answers):

1. Who activates rules before the app uses them: the owner alone, or the owner plus a destination lawyer for the routes the family chooses.
2. Which countries slice 2 researches first.

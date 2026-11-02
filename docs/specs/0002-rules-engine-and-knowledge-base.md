# Spec 0002: Rules engine and knowledge base

- Status: Ready for tickets
- Date: 2026-11-02
- Epic: consultancy core ([ROADMAP.md](../ROADMAP.md#phase-1--family-mvp-web)), slice 1
- Decisions: [ADR-0014](../adr/0014-knowledge-base-as-reviewed-data.md), [ADR-0002](../adr/0002-rules-as-versioned-data.md), [ADR-0004](../adr/0004-ai-providers-behind-ports.md), [ADR-0010](../adr/0010-stack-revised.md)

## Goal

The deterministic core that every consultancy service reads: a rule schema that can express any route, a pure evaluation engine that applies a route version to a case snapshot, unit computation per route, and a knowledge catalog of versioned, sourced, tested route data. After this slice, adding a route is a data change: a JSON file and its cases.

## Scope

**In:** calendar dates and money in `packages/domain`; the case snapshot and the fact catalog; the rule schema; the evaluation engine and unit computation; `packages/knowledge` with the country dataset, country sets, the catalog loader, validation, content hashes and the immutability check; fixture routes and the synthetic families corpus; the staleness report.

**Out:** real route data (slice 2); storing cases, intake and any AI (slice 3); ranking, routes chained to citizenship and the activation screen (slice 4); documents, steps and action points (slice 5); retrieval (slice 6); FX rate feeds and the simulator (slice 7); any API route or UI.

**No case data.** Every snapshot in this slice is synthetic, and the snapshot schema has no names, document numbers or free text.

## The epic: consultancy core

Each slice gets its own spec when it starts. Order and dependencies:

| Slice | Delivers | Depends on |
| --- | --- | --- |
| 1. Rules engine and knowledge base (this spec) | Schema, engine, units, catalog | Foundations scaffold (merged) |
| 2. Knowledge seed | Route versions for the first countries, from official sources, with cases | Slice 1 schema (R4); the owner's choice of countries |
| 3. Case model and text intake | Case tables under forced row-level security, free-text intake through the `Extractor` port, playback and correction, decisive questions, permissions per person and unit, audit log | Slice 1; the foundations identity and data-protection slice (passkeys, synthetic `development` branch, deletion and export, retention, incident runbook, observability with scrubbing); an Anthropic API budget |
| 4. Comparison and recommendation | Destination comparison weighted per person, ranking of route combinations, routes chained to citizenship, the activation screen (ADR-0014) | Slices 2 and 3 |
| 5. Checklist and plan | Documents, steps, action points, execution modes | Slice 4 |
| 6. On-call assistant | Answers with cited sources over the knowledge base | Slice 2; an `Embedder` vendor ADR |
| 7. Assets and currency | Tax and FX simulator, source-of-funds trail, official FX rates | Slices 1 and 3 |

Intake is text first. Voice joins later through the `SpeechToText` port, with its own vendor ADR.

## Layout

```text
packages/
  domain/
    src/calendar/     CalendarDate and Duration
    src/money/        Money, Decimal, FX conversion
    src/case/         CaseSnapshot schema and the fact catalog
    src/rules/        rule schema, expression evaluator, engine, unit computation
  knowledge/
    data/countries.json               ISO 3166-1 alpha-2 codes, generated (R7)
    data/country-sets/<id>/<n>.json   versioned country sets with sources
    data/routes/<route-id>/<n>.json   one file per route version
    data/routes/<route-id>/<n>.cases.json
    test/fixtures/routes/             fixture routes on user-assigned codes (R8)
    src/                              loader, validation, hashing, catalog index
    scripts/                          country dataset generator, staleness report
eval/
  families/           synthetic case snapshots shared with later AI evaluation
```

## Requirements

### R1. Packages and boundaries

- New package `@arca/knowledge`. The boundary matrix (spec 0001 R2, `tooling/scripts/src/check-boundaries.ts`) changes to: `@arca/knowledge` may depend on `@arca/domain`; `@arca/api` may also depend on `@arca/knowledge`. Nothing else changes.
- `@arca/domain` gains `zod` (already in the catalog) as its only runtime dependency. It stays pure: the domain lint rules of spec 0001 R2 apply unchanged, so no clock, no I/O, no hashing.
- `fast-check` joins the catalog for property tests in `domain` and `knowledge` (see [Versions](#versions)).

### R2. Calendar dates and money

- **Dates.** `CalendarDate` is an ISO 8601 calendar date (`YYYY-MM-DD`) with no time or time zone. Operations: parse and validate, compare, add a `Duration` (years, months, days; month ends clamp, so 2024-02-29 plus one year is 2025-02-28), whole years and months between two dates, and age at a date (a person born on 29 February turns a year older on 28 February in common years). `Duration` is ISO 8601 `PnYnMnD`. The engine takes `asOf` as an argument; nothing reads the clock. When `Temporal.PlainDate` is available on the runtime and in TypeScript's library, it can replace the implementation behind the same interface.
- **Money.** `{ amount, currency }`: `amount` is an integer in minor units (a safe integer), `currency` an ISO 4217 code with its minor-unit exponent from a table in the package. No floating point anywhere in money or rates.
- **Decimals.** Multipliers, shares and FX rates are decimal strings (up to 12 fractional digits), computed with `bigint` scaled arithmetic. Rounding to minor units is half-even, once, at the end of each operation.
- **FX.** Conversion takes an `FxTable` supplied by the caller: rates with their date and source. The engine never fetches a rate. A missing rate makes the comparison unknown, with the missing pair reported.
- Property tests cover: date arithmetic round trips and month-end clamping, age around birthdays and leap days, money addition and comparison, and conversion rounding.

### R3. Case snapshot and fact catalog

- **`CaseSnapshot`** is the engine's only view of a case, a Zod schema in `packages/domain/src/case`. People carry opaque IDs and structured facts only: birth date, citizenships (country, acquired and lost dates, basis), country of residence, education (ISCED 2011 level), languages (BCP 47 language, CEFR level), income (active or passive, monthly amount, source country), assets (kind, owners with shares, value with its valuation date, liquidity), immigration history (country, event kind such as a visa refusal, date), financial dependence on another person, and whether the person is studying. Relationships are typed edges (`spouse`, `partner`, `parent`, with dates and, for parenthood, kind and custody), so separations, common-law unions and custody are expressible. Ancestors are people in the same graph who are not case members.
- Every field is optional. An absent field is **unknown**, never false.
- The schema has no free-text fields, names or document numbers. A snapshot is data that cannot carry instructions.
- **Fact catalog.** Rules read facts by key (for example `person.ageYears`, `person.citizenships`, `unit.liquidAssets`). The catalog in `packages/domain` maps each key to its value type, its scope (`principal`, `candidate`, `unit`, `person` inside a collection) and the pure function that derives it from the snapshot and the evaluation context. Derived facts such as age at `asOf` or the unit's liquid assets are computed here, in code.
- A rule that names a key outside the catalog, or compares it with a value of the wrong type, fails validation. Adding a fact is a reviewed code change in `domain`; adding a route never is.

### R4. Rule schema

Zod schemas in `packages/domain/src/rules`, exported as JSON Schema for editors (`z.toJSONSchema`), with `schemaVersion: 1` on every file. The schema evolves additively; a breaking change adds a schema version that the engine supports alongside the old one, so old versions still evaluate.

- **Route.** `id` (`<country code in lowercase>-<slug>`, for example `pt-d7`), country, tags (free strings such as `work`, `investment`, `descent`, `seasonal-work`; never an enumeration in code) and a version list.
- **Route version.** Route ID, number (contiguous from 1), `effectiveFrom` (a `CalendarDate`), `status` (`open` or `closed`), `sources`, `requirements`, `assessments`, `dependents`, `costs` and `durations`. A version applies from its `effectiveFrom` until the next version's; a `closed` version records that the route stopped (for example, an abolished golden visa).
- **Sources.** Each has an ID, an `https` URL, a title, a kind (`official` or `secondary`) and `verifiedAt`. Every requirement, assessment, dependent rule, cost and duration cites at least one `official` source by ID. Secondary sources may be added beside it, never instead.
- **Expressions.** A JSON tree with a closed set of operators, evaluated without `eval`, regular expressions or user code:
  - Values: boolean, integer, decimal, money, date, duration, country code, string enum from the fact catalog, country set reference (`{ "countrySet": "us-e2-treaty" }`).
  - Comparisons: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `intersects`.
  - Logic: `all`, `any`, `not`.
  - Arithmetic: `add`, `sub`, `mul` (by a decimal), `min`, `max`, so a threshold can depend on the unit (Portugal D7 shape: a base amount, plus a share per adult dependent and per child).
  - Dates: elapsed duration since a date fact, compared with a duration.
  - Collections: `count`, `sum`, `some` and `every` over people collections (`unit.members`, `unit.dependents`, the principal's ancestors up to a generation), with a condition per person.
  - Limits checked by validation: depth at most 16 and at most 500 nodes per version.
- **Logic is three-valued** (Kleene): true, false or unknown. Unknown propagates through comparisons and arithmetic; `all` is false if any operand is false, `any` is true if any operand is true.
- **Requirements** are named expressions on the principal and the unit, each with sources. **Assessments** model judgment calls (for example, national importance in an EB-2 NIW petition) as named factors with the evidence facts that support them, never as pass or fail (ADR-0002).
- **Dependents.** Rules of the form *relationship path from the principal* (`spouse`, `partner`, `child`, `parent`, or a composition of up to three steps such as `spouse.parent`) *plus a condition on the candidate* (for example, unmarried and under 21 at `asOf`; or financially dependent on the principal). This expresses U.S. EB-5's spouse and unmarried children under 21 and Portuguese family reunification's dependent parents of the resident or spouse, without a fixed family partition.
- **Costs.** Kind (`fee`, `capital`, `proof_of_means`), an amount expression in the route's currency, who it applies to (`principal`, `each_dependent`, `unit`), an optional condition, and sources.
- **Durations.** Named stages (for example, to a decision, to residence) as a `Duration` range with sources.
- **Country sets** (for example, E-2 treaty countries, Mercosur members) are versioned like routes, with sources and effective dates, and are referenced by ID.

### R5. Evaluation engine and unit computation

Pure functions in `packages/domain/src/rules`, with no I/O and no model calls:

- `selectVersion(versions, asOf)` returns the version in effect at `asOf`, or none. Callers pick `asOf`: today, or a filing date when a route says pending applications keep the old rules.
- `computeUnit(snapshot, version, principalId, context)` returns the dependents the version covers (included), the ones it might cover pending unknown facts (possible, with those facts), and everyone else with the reason they are out. Units are computed, never stored.
- `evaluate(snapshot, version, principalId, context)` returns an `Evaluation`: route ID, version number, content hash, `asOf`, principal, unit, a status, each requirement's result with its sources and a trace, each assessment with evidence present and missing, the decisive missing facts, costs per item with totals per currency, durations, and a `stale` flag (R9). The context carries `asOf`, the `FxTable`, the resolved country sets and the engine's commit (for reproducibility, ADR-0014).
- **Status**, first match wins: `unavailable` (no version in effect, or a `closed` one), `not_eligible` (a requirement is false), `missing_information` (a requirement is unknown), `needs_assessment` (all requirements hold and the route has assessments), `eligible`.
- **Decisive missing facts** are the unknown facts whose value could change the status, per person. Slice 3 turns them into "only the questions that change the answer".
- Engine performance: linear in the size of the expressions times the number of people; a test bounds a 12-person snapshot against the full fixture catalog.

### R6. Knowledge catalog

- **Files** as in [Layout](#layout). The loader reads every file, validates it against R4, checks references (sources, country sets, route ID prefix against the country) and builds an index by route.
- **Content hash:** SHA-256 over the RFC 8785 canonical JSON of each version file, computed by the package build (Node `crypto`), never by `domain`. Integers only in JSON numbers, so canonicalization has no floating-point cases.
- **Built artifact:** the build writes the validated catalog with hashes into `dist`; `@arca/api` imports it. Nothing reads the data directory at runtime.
- **Proposed and active** (ADR-0014): the package exposes `activeVersions(catalog, approvals)`, which keeps only versions with an approval for their exact hash. In this slice there are no approvals, so nothing is active outside tests. When a route has a newer proposed version than its active one, evaluations say so.
- **Immutability check** (`pnpm check:knowledge-immutable`, run in CI on pull requests): fails when a version file or country-set version on the base branch is modified, renamed or deleted, or when an existing entry of a cases file (matched by its `id`) changes or disappears. New files and new case entries pass.
- **Validation in `pnpm check`:** every version validates; version numbers are contiguous; `effectiveFrom` increases with the version number; every requirement, assessment, dependent rule, cost and duration cites an official source; `verifiedAt` is not after the build date; every version has a cases file that meets R8's coverage.

### R7. Countries

- `data/countries.json` holds every ISO 3166-1 alpha-2 country code, generated by `scripts/generate-countries.ts` from a pinned Unicode CLDR release (Unicode License v3), with the CLDR version and the source file's SHA-256 recorded in the file. It is regenerated only on purpose, and the generator's test checks the committed file matches the recorded source.
- No country name is written by hand in code or catalogs: names come from `Intl.DisplayNames` in the reader's locale, so pt-BR names are natural Brazilian Portuguese.
- The real catalog accepts only codes in this dataset. User-assigned codes (`QM` to `QZ`, except `QO` and `QU`) are reserved for fixtures and rejected outside `test/fixtures`.

### R8. Table-driven cases, fixtures and families

- **Cases.** Each `<n>.cases.json` lists entries with an `id`, a synthetic snapshot (or a reference to one in `eval/families`), the principal, `asOf`, FX rates when needed, and the expected status, unit and decisive missing facts. CI runs them all.
- **Coverage:** across a version's cases, every requirement evaluates to true and to false at least once, every dependent rule includes and excludes someone at least once, and every status the version can reach appears. The engine's trace measures it.
- **Fixture routes** prove the schema before real data exists. They use user-assigned country codes, are labeled as fixtures, and cover these shapes: a threshold computed from the unit's composition (D7-like); dependents limited to a spouse and unmarried children under 21 with an investment threshold in another currency (EB-5-like); dependent parents of the principal or spouse (family-reunification-like); citizenship by descent through a parent or grandparent with conditions on the ancestor's citizenship at the child's birth (Italian-descent-like); eligibility through a country set of the principal's citizenships (E-2-like); a judgment factor with evidence (EB-2 NIW-like); a seasonal work route tied to a job offer (H-2A-like); a closed route; and a version replaced at a date with a pending-applications `asOf`.
- **Synthetic families** in `eval/families/`: a single person; a couple with young children; divorced parents with shared custody; dependent elderly parents; a previous visa refusal; assets held by an ex-spouse; and the shape of case 1 (six adults: a divorced couple, one holding real-estate assets, and their two adult children with spouses). All values are invented; nothing comes from the real family. Each family has expected units per fixture route.

### R9. Staleness

- A source is stale when `verifiedAt` is more than 90 days before `asOf`. An evaluation that cites a stale source sets `stale: true`, so the interface can say the rule needs re-checking.
- `scripts/staleness-report.ts` lists stale sources by route. A scheduled weekly workflow runs it and keeps one open issue up to date, using only `GITHUB_TOKEN` with `issues: write`. Agents re-verify from that issue and propose new versions.

### R10. Docs

- ARCHITECTURE.md: `packages/knowledge` in the code layout; the rules flow per ADR-0014.
- GLOSSARY.md: Fact, Requirement, Assessment, Country set, Proposed version, Active version, with pt-BR labels.
- ROADMAP.md: the consultancy core slices above.
- A short `packages/knowledge/README.md`: how to add a route version and its cases.

## Versions

Checked on the npm registry on 2026-11-02. The newest release at least 7 days old, as in spec 0001.

| Package | Version | Why this one |
| --- | --- | --- |
| `zod` | 4.6.7 (catalog) | Already approved; now also a runtime dependency of `domain` |
| `fast-check` | 4.10.x | Latest, published 2026-09-19; property tests for dates, money and three-valued logic. Same kind of tool as Vitest, so no ADR; provenance and license checked by the supply-chain reviewer when added |

No other dependency. RFC 8785 canonicalization and the CLDR generator are small, tested code in `knowledge`; hashing uses Node `crypto`.

## Threat model for this slice

Assets in play: the integrity of the knowledge base and of the engine. No personal data.

| Threat (STRIDE, LLM and agentic) | Where | Control in this slice |
| --- | --- | --- |
| Tampering: a wrong or poisoned rule reaches families | Catalog | Official source required per item; table-driven cases with coverage; reviewers; versions stay proposed until the owner's passkey activates them (ADR-0014, built in slice 4) |
| Tampering: an old version rewritten to change past results | Catalog | Immutability check against the base branch; content hash recorded in every evaluation |
| Indirect prompt injection through researched pages | Slice 2 research | The catalog holds structured data only, no free text that reaches a model as instructions; facts typed by the catalog |
| Wrong eligibility from arithmetic or dates | Engine | Integer money, decimal strings, half-even rounding, calendar dates without time zones, property tests; no model in the path |
| Wrong answer presented as known | Engine | Three-valued logic; absent facts are unknown; decisive missing facts reported |
| Denial of service through a pathological rule | Engine | Closed operator set, depth and node limits, no regular expressions or recursion beyond the three-step relationship path |
| Information disclosure: real data in fixtures | Repository | Snapshot schema without names or free text; synthetic families only; reviewers |
| Tampering: malicious dependency | Install | One new test dependency, under spec 0001's supply-chain controls |
| Elevation: the staleness workflow | CI | No secrets; `GITHUB_TOKEN` with `issues: write` only; on the workflow-secrets policy |

## Definition of done

- Every requirement above is met and covered by a test or a CI check.
- The fixture catalog passes validation and coverage; every synthetic family's expected units match.
- `pnpm check` and the immutability check run in CI.
- No user-facing string added; no personal data anywhere.

## Decisions from the grill

Taken on 2026-11-02 under the owner's standing instruction that agents decide technical matters. Two owner questions are listed after the table.

| Question | Decision | Why |
| --- | --- | --- |
| Which epic is next? | Consultancy core, starting with the rules engine and knowledge base | Every MVP service reads them, and they need no case data, authentication or AI, so they can be built while the foundations finish |
| Where does the knowledge base live? | JSON files in `packages/knowledge`, bundled into the API (ADR-0014) | Git history, diff review and tests beside the data; public rules in a public repository; no admin editor needed yet |
| How is human approval recorded? | Proposed on merge, active only after the owner's passkey approval in the app (ADR-0014) | Agents act with the owner's GitHub token, so a merge proves nothing; a passkey assertion does |
| JSON or YAML? | JSON with a JSON Schema for editors | No parser at runtime, one canonical form for hashing; agents write it, people read the approval summary |
| How are missing facts handled? | Three-valued logic; absent is unknown | A missing answer must never read as "not eligible", and the unknowns drive the next questions |
| How are thresholds that depend on the family expressed? | Arithmetic over unit collections in the expression tree | D7-like formulas without code per route |
| How are dependents expressed? | Relationship paths plus a condition on the candidate | Matches EB-5 and Portuguese reunification without a fixed partition (CLAUDE.md rule 4) |
| How is money computed? | Integer minor units, decimal strings, `bigint`, half-even rounding, FX passed in | CLAUDE.md rule 3; reproducible |
| Dates? | Own `CalendarDate`, no time zones | Ages and deadlines are calendar facts; `Temporal` can replace it later behind the same interface |
| Fact list open or closed? | Closed catalog in `domain`, extended by code review | Rules must be type-checked; a new fact is a schema extension, not a route change |
| How is reproducibility kept? | Immutable files, content hash, engine commit in every evaluation | CLAUDE.md rule 6 |
| How fresh must a source be? | Stale after 90 days, flagged and reported weekly | 2026 showed rules changing within weeks (research/us.md) |
| How are countries listed? | Generated from a pinned CLDR release; names from `Intl.DisplayNames` | ISO 3166 codes without hand-written names or a new dependency |
| How is the schema proven before real data? | Fixture routes on user-assigned codes covering every hard shape | Real routes need research and approval; fixtures cannot be mistaken for real rules |
| API endpoints in this slice? | None | Nothing shows evaluations until slice 4 (YAGNI) |
| Text or voice intake? | Text first; voice later through `SpeechToText` | Voice adds a vendor ADR and builds on the text path |

**For the owner** (asked separately; this spec does not depend on the answers):

1. Who approves rules before the app uses them: the owner alone, or the owner plus a destination lawyer for the routes the family chooses.
2. Which countries slice 2 researches first.

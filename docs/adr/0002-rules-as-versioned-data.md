# ADR-0002: Immigration rules as versioned data, evaluated deterministically

- Status: Accepted
- Date: 2026-11-01

## Context

Immigration rules change often and without warning. In 2026 alone, U.S. immigrant visa processing for Brazilians was paused in January, the pause was struck down in August, interviews were paused worldwide days later and resumed in September (see [research/us.md](../research/us.md)). A recommendation that cannot say which rule version it used, and since when that version applies, cannot be trusted or audited.

LLMs are good at explaining and extracting, but unreliable at comparing dates, checking thresholds and doing arithmetic.

## Decision

- Each route (for example, "U.S. EB-5, targeted employment area") has immutable **route versions**. A version holds declarative requirements, costs, who it covers as dependents, effective dates, a source URL and a verification date.
- The **evaluation engine** is a pure function: `(case snapshot, route version) → evaluation` (status, missing requirements, estimated cost and time). It contains no I/O and no model calls.
- A rule change creates a new version. Existing evaluations keep pointing at the version they used.
- New or changed versions enter the base only after human approval, whether they came from a person, a research agent or the rule watcher.
- **The catalog is open.** No country, route, visa category or route type is hard-coded. Countries come from a standard dataset (ISO 3166); categories (work, investment, study, family, descent, retirement, digital nomad, humanitarian, seasonal work, and others) are tags on routes, not an enumeration in code. Any legal pathway that can be expressed in the rule schema can be added as data; when one cannot, the schema is extended generically rather than special-cased.

Example of a version (shape, not final schema):

```json
{
  "route": "us-eb5-tea",
  "effectiveTo": "2026-12-31",
  "requires": [
    { "fact": "unit.investableUsd", "gte": 800000 },
    { "fact": "unit.sourceOfFundsDocumented", "eq": true }
  ],
  "dependents": ["spouse", "unmarried child under 21"],
  "sourceUrl": "https://www.uscis.gov/working-in-the-united-states/permanent-workers/eb-5-immigrant-investor-program",
  "verifiedAt": "2026-10-31"
}
```

## Consequences

- Every recommendation is reproducible and explainable down to the rule and its source.
- Rule versions get table-driven tests; a regression in eligibility is caught before deploy.
- Someone has to maintain the base. The rule watcher and research agents reduce that work but do not remove the approval step.
- Requirements that are genuinely judgment calls (for example, "national importance" in an EB-2 NIW petition) are modeled as factors with evidence, not as pass/fail rules.

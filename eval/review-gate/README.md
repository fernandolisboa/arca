# Review gate canary

Known-bad and injected changes that the review gate must fail ([spec 0001, R10](../../docs/specs/0001-foundations-scaffold.md#r10-review-gate), [ADR-0013](../../docs/adr/0013-review-gate-canary-and-model-pins.md)). The files here are fixtures: every one ends in `.canary`, so no tool in the repository parses, lints or runs them. They hold insecure code and text aimed at reviewers on purpose.

## Layout

- `payloads/<reviewer>/`: one known-bad change per reviewer, with `payload.json` naming the reviewer and the category it must block for. Each payload is also a case of its own, `known-bad-<reviewer>`.
- `cases/<id>/case.json`: one case.
  - `expect`: `block`, or `prepare-rejects` when the change must be refused before any model runs.
  - `payloads`: payloads to include, or `"must-pass"` for every must-pass reviewer's payload.
  - `targets`: more reviewers and the category each must block for.
  - `commitMessage`, `appendToBase` (text added to a file on main before the change, such as an injected line in a reference doc) and `symlinks`.
- `cases/<id>/files/`: the files the change adds or replaces, each with the `.canary` suffix.

## How a case runs

`tooling/scripts/src/review-gate/cli.ts canary-plan` builds each case as two commits on top of `main` in a scratch worktree. It then prepares the review input exactly as the gate does for a pull request. Each target reviewer runs in its own job.

A run passes only when that reviewer's own verdict blocks with a blocking finding of the expected category. Invalid output, an unassessed entry or an unrelated finding does not count, so one reviewer cannot hide a weakened one.

A failed run is retried once. `pnpm check` runs a test that plans the whole corpus with no model, so a malformed case fails CI.

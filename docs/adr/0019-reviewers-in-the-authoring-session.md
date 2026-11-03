# ADR-0019: Reviewers run in the authoring session, not in CI

- Status: Accepted
- Date: 2026-11-03
- Supersedes: [ADR-0011](0011-reviewers-in-ci.md), [ADR-0013](0013-review-gate-canary-and-model-pins.md)
- Amends: [ADR-0012](0012-automation-first-setup.md) (the review gate section), spec 0001 R10

## Context

ADR-0011 and ADR-0013 run the reviewer subagents in CI as a required `review-gate` check, with a canary suite that proves the reviewers still catch known-bad changes. The reviewers run on the owner's Claude subscription. Three things happened on 2026-11-02:

- **Usage.** A day of gate changes and pull request rounds used up the subscription's per-model limit. A full canary costs about 85 model runs, and every change to the gate needs a new one. Until the limit reset, no canary could pass, so every pull request's gate failed.
- **Upkeep.** The gate grew to three workflows, a composite action, about 4,000 lines of scripts and tests, and a corpus of injected cases. Most of the agents' time went into the gate itself, not into the product.
- **Purpose.** The owner said the app exists to help his own family's immigration, and asked why the project carries this machinery. The gate defends against outside contributors, and against agents weakening it in a way that leaves no evidence. Those threats are real for a product with many contributors. They are not worth the cost here.

## Decision

- The session that writes a change runs the reviewer subagents in `.claude/agents/` on the diff, in parallel, before it opens a pull request and again before it merges. Verdict rules stay as in [REVIEW.md](../REVIEW.md).
- CI keeps only deterministic checks: types, lint, tests, build, the policy checks, CodeQL, dependency advisories and secret scanning. These stay the required checks.
- Removed:
  - `review-gate.yml`, `review-canary.yml` and `review-canary-push.yml`;
  - the `run-reviewer` action;
  - the gate scripts in `tooling/scripts/src/review-gate`;
  - the canary corpus in `eval/review-gate`;
  - `docs/review-acceptances.md`.

  A medium finding a change accepts is recorded with its reason in the pull request description, and in an ADR when it is a lasting trade-off.
- No model provider receives code from CI. The Anthropic CI row leaves the data-flow table.

## Consequences

- No subscription usage in CI, and nothing for the owner to configure or keep running.
- Nothing a branch rule can check proves that the reviewers ran. A session that skips them, or an agent steered by injected text into weakening an agent definition, is not caught by CI. Two things limit this:
  - the deterministic checks still run on every pull request;
  - changes to `.claude/agents/` and `docs/REVIEW.md` still need a PASS from the security, architecture and supply-chain reviewers, and an entry in the REVIEW.md change log.
- Reviewer prompts are no longer tested against a canary corpus. A weakened reviewer would show up only as missed findings.
- Optional cleanup for the owner, in the repository settings:
  - the `review` environment and its `CLAUDE_CODE_OAUTH_TOKEN` secret;
  - the Dependabot secret of the same name;
  - any `REVIEW_MODEL_*` variables.

  None of these is read any more.
- Revisit this decision if the project gains contributors outside the owner's own sessions. The removed code is in the history at commit `6214a6a`.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Keep the CI reviewers, drop the canary | Still spends subscription usage on every pull request, and without the canary nothing shows that the reviewers still work |
| Keep everything | Blocked by the subscription limit, and costly to maintain for a single-family app |

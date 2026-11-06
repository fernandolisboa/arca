# ADR-0019: Reviewers run in the authoring session, not in CI

- Status: Accepted, amended by [ADR-0024](0024-mattpocock-skills-flow.md) (the reviewers it runs)
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
- CI keeps only deterministic checks: types, lint, tests, build, the policy checks, CodeQL, dependency advisories and secret scanning. These stay the checks the `main` ruleset will require (spec 0001 R8).
- Removed:
  - `review-gate.yml`, `review-canary.yml` and `review-canary-push.yml`;
  - the `run-reviewer` action;
  - the gate scripts in `tooling/scripts/src/review-gate`;
  - the canary corpus in `eval/review-gate`;
  - `docs/review-acceptances.md`.

  A medium finding a change accepts is recorded with its reason in the pull request description, and in an ADR when it is a lasting trade-off.
- No model provider receives code from CI. The Anthropic CI row leaves the data-flow table.

## Consequences

- No subscription usage in CI and nothing to keep running, after the one-time cleanup below.
- Nothing a branch rule can check proves that the reviewers ran. Residual risks, accepted:
  - A session can skip the reviewers.
  - Injected text in a diff, doc, commit message or fetched page can steer a local reviewer to a false PASS. The removed canary tested exactly this, and nothing tests it now.
  - Local reviewers can run commands with the session's credentials, including the owner's GitHub token ([ADR-0012](0012-automation-first-setup.md)). CI reviewers could only read files, so injected text that reaches a reviewer can now do more.
  - (Since [ADR-0024](0024-mattpocock-skills-flow.md), such changes need the security and supply-chain reviewers instead.) The reviewers load the branch's own agent definitions and `CLAUDE.md` files. A change that weakens a reviewer is judged by the weakened reviewer, so the rule that `.claude/agents/` and `docs/REVIEW.md` changes need a PASS from the security, architecture and supply-chain reviewers is attested by the same session.
  - `ci.yml` runs the branch's own copy; of the pull request checks, only `policy.yml` runs its definition from `main`.

  What still limits this:
  - the deterministic checks on every pull request, required by the spec 0001 R8 ruleset (applied 2026-11-03);
  - the owner's GitHub token is fine-grained, limited to this repository and expiring;
  - no case data exists yet. Revisit this decision before the first real case data is stored.
- Reviewer prompts are no longer tested against a canary corpus. A weakened reviewer would show up only as missed findings.
- **Required cleanup by the owner**, since agents cannot write these settings:
  - delete the `review` environment and its `CLAUDE_CODE_OAUTH_TOKEN` secret;
  - delete the Dependabot secret of the same name;
  - delete any `REVIEW_MODEL_*` variables.

  The token is a live one-year subscription credential that nothing reads any more. Once this change merges, the workflow secrets lint refuses it in every workflow. The `main` ruleset (spec 0001 R8), applied on 2026-11-03, does not list a `review-gate` check.
- Revisit this decision if the project gains contributors outside the owner's own sessions. The removed code is in the history at commit `6214a6a`.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Keep the CI reviewers, drop the canary | Still spends subscription usage on every pull request, and without the canary nothing shows that the reviewers still work |
| Keep everything | Blocked by the subscription limit, and costly to maintain for a single-family app |

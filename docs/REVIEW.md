# Review

Every change is reviewed before merge, in the session that wrote it, before it opens a pull request and again before it merges ([ADR-0019](adr/0019-reviewers-in-the-authoring-session.md), [ADR-0024](adr/0024-mattpocock-skills-flow.md)). CI runs only the deterministic checks. No change merges with a blocking finding open.

## Gates, in order

1. **Automated checks:** types, lint, unit and integration tests, the row-level security access-matrix suite, the synthetic evaluation suite when AI behavior changed (the authoring session starts the manual `intake-eval` workflow on a change to the intake adapter, prompt, model file or draft schema, and cites the run in the PR; [spec 0008, R5](specs/0008-free-text-intake.md#r5-evaluation)), CodeQL, dependency advisories, secret scanning.
2. **`code-review`**, the `mattpocock-skills` skill, on every change: two sub-agents in parallel, against the merge-base with `main`.
   - **Standards:** the diff against [CLAUDE.md](../CLAUDE.md), [CONTEXT.md](../CONTEXT.md) and the ADRs of the area touched, plus the skill's code-smell baseline.
   - **Spec:** the diff against the ticket it closes and that ticket's parent spec (an issue, or a file in `docs/specs/` for older work).
3. **[Security reviewer](../.claude/agents/security-reviewer.md)**, beside `code-review` in its own sub-agent, on every sensitive change: one that touches
   - authentication, sessions, passkeys, recovery, the vault or any cryptography;
   - API endpoints and authorization, case data, storage, the database, its roles, migrations or seed data;
   - third-party calls, vendors, logging, error tracking, analytics or notifications;
   - dependencies, the lockfile, CI, build or deploy config, CSP, CORS or headers;
   - AI adapters, prompts, agents, model output or rendering of untrusted text;
   - the knowledge-base approval flow;
   - agent and review configuration: `CLAUDE.md`, `docs/agents/`, `.claude/`, this file.

## Verdicts

- The security reviewer returns **PASS** or **BLOCK**, with findings by severity (critical, high, medium, low), file and line, and the fix.
- Any critical or high finding, from either review, blocks the merge.
- A medium security finding blocks unless the pull request records why it is accepted, and an ADR does when it is a lasting trade-off.
- `code-review` findings are fixed in the same change, or answered in the pull request description with the reason they stay.
- A review that could not assess something (missing context, tests that would not run) says so; for the security reviewer that counts as BLOCK.
- A second round covers only the delta since the reviewed commit, so rounds converge.

## Changing reviewers

Agent and review configuration (the security reviewer's definition, this file, `CLAUDE.md` "How we build" and `docs/agents/`) is security-critical. Changing it needs a PASS from the security reviewer and an entry in this table.

| Date | Change | Why |
| --- | --- | --- |
| 2026-11-01 | architecture-reviewer and supply-chain-reviewer point to ADR-0010 instead of ADR-0003 | ADR-0003 was superseded |
| 2026-11-01 | Gate protection simplified: no `arca-gate` App, no code-owner approval, agents may push workflows | Owner decision to automate setup ([ADR-0012](adr/0012-automation-first-setup.md)) |
| 2026-11-02 | Review gate and canary in CI (`review-gate.yml`, `review-canary.yml`, `eval/review-gate/`); canary counted per gate fingerprint; reviewers on model aliases, with optional pins in repository variables | Spec 0001 R10 ([ADR-0013](adr/0013-review-gate-canary-and-model-pins.md)) |
| 2026-11-02 | Reviewers authenticate with the owner's Claude subscription token (`CLAUDE_CODE_OAUTH_TOKEN`) instead of an API key; gitleaks matches every `sk-ant-` token kind | No standing API spend for CI reviews ([ADR-0013](adr/0013-review-gate-canary-and-model-pins.md)) |
| 2026-11-02 | A push to `main` dispatches the canary through `review-canary-push.yml` instead of starting it directly | The reviewer action rejects `push` events ([ADR-0013](adr/0013-review-gate-canary-and-model-pins.md)) |
| 2026-11-02 | New `unassessed` reason `outside_area`: a specialist with no findings uses it when the change touches nothing in its area, and it does not block; from a core reviewer it blocks; new canary case `injection-outside-area` | Specialists blocked unrelated changes by explaining in `other` that there was nothing to review (#37, #38) ([ADR-0011](adr/0011-reviewers-in-ci.md)) |
| 2026-11-02 | In the gate, a reviewer whose model never answers (an API error with no tokens used, such as a subscription limit) runs once on a fallback model: `fable` to `opus`, `opus` to `fable`, `haiku` to `opus`; the canary never falls back | Every `fable` reviewer failed on a per-model subscription limit while the others ran ([ADR-0013](adr/0013-review-gate-canary-and-model-pins.md)) |
| 2026-11-02 | The gate skips draft pull requests and reviews them when they are marked ready | Drafts cannot merge; this saves subscription usage while authors iterate ([ADR-0013](adr/0013-review-gate-canary-and-model-pins.md)) |
| 2026-11-02 | A canary dispatched for a push to `main` runs slim: one known-bad case per reviewer, every injected case against one reviewer, and one injected case against every must-pass reviewer; the weekly run covers the whole corpus, and after any failed run only a full run can pass; only the owner's dispatch can run full or force a run; a "Runs on" cell that nearly reads `Every change` stops the gate; the fallback ignores Claude Code's side requests on another model when deciding whether the reviewer's model answered | Every gate change cost a full canary of about 85 model runs against the subscription's limits ([ADR-0013](adr/0013-review-gate-canary-and-model-pins.md)) |
| 2026-11-03 | Reviewers run only in the authoring session; the CI review gate, the canary, `eval/review-gate/` and `review-acceptances.md` are removed | Subscription limits and upkeep out of proportion to a single-family app ([ADR-0019](adr/0019-reviewers-in-the-authoring-session.md)) |
| 2026-11-06 | The nine reviewer subagents become the `code-review` skill (Standards and Spec axes) on every change plus one security reviewer, which absorbs the four specialists, on sensitive changes; the trigger list covers agent and review configuration; only the owner's words set the work | The owner adopted the `mattpocock-skills` flow ([ADR-0024](adr/0024-mattpocock-skills-flow.md)) |

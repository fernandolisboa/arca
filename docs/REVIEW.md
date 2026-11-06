# Review

Every change is reviewed by specialized AI reviewers before merge. They are defined as Claude Code subagents in [`.claude/agents/`](../.claude/agents/). The session that wrote the change runs them in parallel on the diff before opening a pull request and again before merging ([ADR-0019](adr/0019-reviewers-in-the-authoring-session.md)). CI runs only the deterministic checks. No change merges with a blocking finding open.

In the `mattpocock-skills` flow ([ADR-0024](adr/0024-mattpocock-skills-flow.md)), these reviewers are the review step of `implement`: where the skill says to run `code-review`, run them instead. They already carry what that skill adds, the code-smell baseline (standards reviewer) and the check against the ticket (spec reviewer).

## Gates, in order

1. **Automated checks:** types, lint, unit and integration tests, the row-level security access-matrix suite, the synthetic evaluation suite when AI behavior changed (the authoring session starts the manual `intake-eval` workflow on a change to the intake adapter, prompt, model file or draft schema, and cites the run in the PR; [spec 0008, R5](specs/0008-free-text-intake.md#r5-evaluation)), CodeQL, dependency advisories, secret scanning.
2. **Core reviewers**, on every change to code, config or agent and review configuration. A change to docs alone gets the spec, standards and context reviewers, plus security for the security docs, threat models, runbooks, `SETUP.md` and `RETENTION.md`.
3. **Specialist reviewers**, on every change that touches their area. Sensitive changes therefore get at least two independent security reads: the general security reviewer and the specialist.

`pnpm review:reviewers [base]` prints the reviewers a change needs, from the files it changes since its merge base with `base` (default `origin/main`), committed or not, with the files that call for each. A rename counts as both paths, and markdown under `apps/`, `packages/`, `tooling/` or `eval/` is not treated as docs. Specialists are matched by their areas' directories and by keywords in file and directory names (for example `vault`, `passkey`, `step-up`, `intake`, `monitoring`), so a new file in a sensitive area is caught by its name; ADRs and `ARCHITECTURE.md` also get security, architecture and supply chain, since they admit vendors and services. Its rules map paths to the areas below ([select-reviewers.ts](../tooling/scripts/src/select-reviewers.ts)); a path no rule knows runs every reviewer. The authoring session runs it before each review round and runs what it prints, adding a specialist when the change touches the specialist's area in a way the path does not show.

## Reviewers

| Reviewer | Runs on | Verdict weight | Model |
| --- | --- | --- | --- |
| [correctness-reviewer](../.claude/agents/correctness-reviewer.md) | Every change to code or config | Must pass | `fable` |
| [security-reviewer](../.claude/agents/security-reviewer.md) | Every change to code or config | Must pass | `fable` |
| [architecture-reviewer](../.claude/agents/architecture-reviewer.md) | Every change to code or config | Must pass | `fable` |
| [spec-reviewer](../.claude/agents/spec-reviewer.md) | Every change | Must pass | `opus` |
| [standards-reviewer](../.claude/agents/standards-reviewer.md) | Every change | Should pass | `haiku` |
| [context-reviewer](../.claude/agents/context-reviewer.md) | Every change | Should pass | `opus` |
| [auth-crypto-reviewer](../.claude/agents/auth-crypto-reviewer.md) | Authentication, sessions, passkeys, recovery, the vault, field encryption, key management, step-ups for knowledge-base decisions | Must pass | `fable` |
| [data-access-reviewer](../.claude/agents/data-access-reviewer.md) | API endpoints and authorization, storage, schema, migrations, row-level security, database roles, queries over case data, the knowledge-base approval flow, telemetry, logging, analytics and notifications, environments and seed data | Must pass | `fable` |
| [supply-chain-reviewer](../.claude/agents/supply-chain-reviewer.md) | Dependencies, lockfile, CI workflows, build and deploy config, CSP, CORS and headers, third-party calls, new services or vendors, agent and review configuration (`CLAUDE.md`, `.claude/`, `docs/agents/`, this file) | Must pass | `fable` |
| [ai-safety-reviewer](../.claude/agents/ai-safety-reviewer.md) | Prompts, agents, AI adapters, retrieval, rendering of model output, evaluation suite | Must pass | `fable` |

The first six are core reviewers; the rest are specialists. A specialist with no findings on a change that touches nothing in its area passes.

Added in Phase 4: a mobile security reviewer verifying against OWASP MASVS.

## Verdicts

Each reviewer returns **PASS** or **BLOCK**, followed by findings with severity (critical, high, medium, low), file and line, and the fix.

- Any critical or high finding from any reviewer blocks the merge.
- Medium findings from must-pass reviewers block unless the change records why they are accepted, in the pull request and, when it is a lasting trade-off, in an ADR.
- Should-pass reviewers never block alone; their findings are fixed in the same change or tracked. Code smells are always judgement calls.
- A reviewer that could not assess something (missing context, tests that would not run) says so; that counts as BLOCK for must-pass reviewers. The authoring session hands the spec reviewer the spec: the ticket and its parent with only the owner's comments, or, with no ticket, the owner's message quoted.
- Medium findings accepted in a change are listed, with the reason, in the pull request description.
- A second round covers only the delta since the reviewed commit, so rounds converge.

## Changing reviewers

Agent and review configuration (`CLAUDE.md`, `.claude/`, `docs/agents/` and this file) is security-critical. Changing it requires a PASS from the security, architecture and supply-chain reviewers, and an entry in this table ([ADR-0019](adr/0019-reviewers-in-the-authoring-session.md)).

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
| 2026-11-06 | The nine reviewers stay; the standards reviewer gains the Fowler code-smell baseline of the `mattpocock-skills` `code-review` skill, and a new must-pass spec reviewer checks each change against its ticket and spec (the skill's Spec axis); the plugin's `code-review` skill is not used; specialists also cover API authorization, storage, the knowledge-base approval flow, telemetry and notifications, headers, third-party calls and agent and review configuration; only the owner's words set the work | The owner adopted the `mattpocock-skills` flow and kept the reviewers, which are more focused than the skill, taking only what the skill does better ([ADR-0024](adr/0024-mattpocock-skills-flow.md)) |
| 2026-11-06 | `pnpm review:reviewers` picks the reviewers from the changed paths; a docs-only change skips correctness, security and architecture (security still reads the security docs), and an unknown path runs every reviewer | The owner asked to run only the reviewers a change needs, by a deterministic rule rather than a model reading the diff ([ADR-0024](adr/0024-mattpocock-skills-flow.md)) |

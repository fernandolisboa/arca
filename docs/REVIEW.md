# Review

Every change is reviewed by specialized AI reviewers before merge. They are defined as Claude Code subagents in [`.claude/agents/`](../.claude/agents/). The session that wrote the change runs them in parallel on the diff before opening a pull request, and CI runs them again as the required `review-gate` check ([ADR-0011](adr/0011-reviewers-in-ci.md)). No change merges with a blocking finding open.

## Gates, in order

1. **Automated checks:** types, lint, unit and integration tests, the row-level security access-matrix suite, the synthetic evaluation suite when AI behavior changed, CodeQL, dependency advisories, secret scanning.
2. **Core reviewers**, on every change.
3. **Specialist reviewers**, on every change that touches their area. Sensitive changes therefore get at least two independent security reads: the general security reviewer and the specialist.

## Reviewers

| Reviewer | Runs on | Verdict weight | Model |
| --- | --- | --- | --- |
| [correctness-reviewer](../.claude/agents/correctness-reviewer.md) | Every change | Must pass | `fable` |
| [security-reviewer](../.claude/agents/security-reviewer.md) | Every change | Must pass | `fable` |
| [architecture-reviewer](../.claude/agents/architecture-reviewer.md) | Every change | Must pass | `fable` |
| [standards-reviewer](../.claude/agents/standards-reviewer.md) | Every change | Should pass | `haiku` |
| [context-reviewer](../.claude/agents/context-reviewer.md) | Every change | Should pass | `opus` |
| [auth-crypto-reviewer](../.claude/agents/auth-crypto-reviewer.md) | Authentication, sessions, passkeys, recovery, vault, field encryption, key management | Must pass | `fable` |
| [data-access-reviewer](../.claude/agents/data-access-reviewer.md) | Schema, migrations, row-level security policies, database roles, queries over case data, environment and seed data | Must pass | `fable` |
| [supply-chain-reviewer](../.claude/agents/supply-chain-reviewer.md) | Dependencies, lockfile, CI workflows, build and deploy config, new services or vendors | Must pass | `fable` |
| [ai-safety-reviewer](../.claude/agents/ai-safety-reviewer.md) | Prompts, agents, AI adapters, retrieval, rendering of model output, evaluation suite | Must pass | `fable` |

The review gate reads this table to weigh each reviewer: a row needs the linked reviewer name and exactly `Must pass` or `Should pass`, and an agent without a row stops the gate.

Added in Phase 4: a mobile security reviewer verifying against OWASP MASVS.

## Verdicts

Each reviewer returns **PASS** or **BLOCK**, followed by findings with severity (critical, high, medium, low), file and line, and the fix.

- Any critical or high finding from any reviewer blocks the merge.
- Medium findings from must-pass reviewers block unless the change records why they are accepted, in the pull request and, when it is a lasting trade-off, in an ADR.
- Should-pass reviewers never block alone; their findings are fixed in the same change or tracked.
- A reviewer that could not assess something (missing context, tests that would not run) says so; that counts as BLOCK for must-pass reviewers. In CI, reviewers cannot run commands; running tests is the job of the required test checks, so not running them there is not a gap to report. CI reviewers report what they could not assess in a separate field, and the gate fails a must-pass reviewer that reports anything there except `tests_not_run`, which the required test checks cover, and `outside_area`, which a specialist reports with no findings when the change touches nothing in its area.
- Medium findings accepted in a change are listed, with the reason, in [review-acceptances.md](review-acceptances.md); the CI gate reads that file.

## Changing reviewers

Reviewer definitions and the review CI workflow are security-critical configuration. Changing either requires a PASS from the security, architecture and supply-chain reviewers, and an entry in this file ([ADR-0011](adr/0011-reviewers-in-ci.md), [ADR-0012](adr/0012-automation-first-setup.md)).

| Date | Change | Why |
| --- | --- | --- |
| 2026-11-01 | architecture-reviewer and supply-chain-reviewer point to ADR-0010 instead of ADR-0003 | ADR-0003 was superseded |
| 2026-11-01 | Gate protection simplified: no `arca-gate` App, no code-owner approval, agents may push workflows | Owner decision to automate setup ([ADR-0012](adr/0012-automation-first-setup.md)) |
| 2026-11-02 | Review gate and canary in CI (`review-gate.yml`, `review-canary.yml`, `eval/review-gate/`); canary counted per gate fingerprint; reviewers on model aliases, with optional pins in repository variables | Spec 0001 R10 ([ADR-0013](adr/0013-review-gate-canary-and-model-pins.md)) |
| 2026-11-02 | Reviewers authenticate with the owner's Claude subscription token (`CLAUDE_CODE_OAUTH_TOKEN`) instead of an API key; gitleaks matches every `sk-ant-` token kind | No standing API spend for CI reviews ([ADR-0013](adr/0013-review-gate-canary-and-model-pins.md)) |
| 2026-11-02 | A push to `main` dispatches the canary through `review-canary-push.yml` instead of starting it directly | The reviewer action rejects `push` events ([ADR-0013](adr/0013-review-gate-canary-and-model-pins.md)) |
| 2026-11-02 | New `unassessed` reason `outside_area`: a reviewer with no findings uses it when the change touches nothing in its area, and it does not block | Specialists blocked unrelated changes by explaining in `other` that there was nothing to review (#37, #38) ([ADR-0011](adr/0011-reviewers-in-ci.md)) |

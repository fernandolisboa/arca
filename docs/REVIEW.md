# Review

Every change is reviewed by specialized AI reviewers before merge. They are defined as Claude Code subagents in [`.claude/agents/`](../.claude/agents/), and the session that wrote the change runs them in parallel on the diff. No change merges with a blocking finding open.

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

Added in Phase 4: a mobile security reviewer verifying against OWASP MASVS.

## Verdicts

Each reviewer returns **PASS** or **BLOCK**, followed by findings with severity (critical, high, medium, low), file and line, and the fix.

- Any critical or high finding from any reviewer blocks the merge.
- Medium findings from must-pass reviewers block unless the change records why they are accepted, in the pull request and, when it is a lasting trade-off, in an ADR.
- Should-pass reviewers never block alone; their findings are fixed in the same change or tracked.
- A reviewer that could not assess something (missing context, tests that would not run) says so; that counts as BLOCK for must-pass reviewers.

## Changing reviewers

Reviewer definitions are security-critical configuration: changing one requires a PASS from the security reviewer and the architecture reviewer, and an entry in this file.

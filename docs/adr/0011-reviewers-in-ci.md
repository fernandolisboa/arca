# ADR-0011: Reviewer subagents run in CI as a required check

- Status: Accepted
- Date: 2026-11-01

## Context

[REVIEW.md](../REVIEW.md) makes the reviewer subagents in `.claude/agents/` the gate for every merge, with the owner out of the loop. It says the authoring session runs them; [ROADMAP.md](../ROADMAP.md) says CI runs the multi-reviewer pass. A run inside the authoring session leaves no evidence a branch rule can check, so the gate depends on the author remembering to run it and reporting it truthfully.

The repository is public ([ADR-0010](0010-stack-revised.md)), so anyone can open a pull request from a fork. A pull request's diff, description and comments are untrusted input to any model that reads them.

## Decision

- A CI workflow runs the reviewers on every pull request with the Claude Code GitHub Action (`anthropics/claude-code-action`), pinned by commit SHA.
- It runs the core reviewers on every change, and each specialist when the diff touches its area, using the triggers in REVIEW.md, mapped to path patterns kept in the workflow.
- The job produces one required status, `review-gate`. It passes only when every reviewer that ran returned PASS with no open critical or high finding. A missing, malformed or unparsable verdict fails the check (fail closed).
- Findings are posted as one pull request comment by a separate step that holds the `GITHUB_TOKEN`; the model step never holds a token that can write.
- **Isolation of the model step:**
  - Triggered by `pull_request` only, never `pull_request_target`. Pull requests from forks receive no secrets, so the gate fails for them; a maintainer re-creates such a change on a branch of this repository before it can merge.
  - Runs only for pull request authors with write access (the action's default check) and an explicit `allowed_bots` list: the Claude GitHub App and Dependabot, never `*`. Dependabot pull requests read the API key from Dependabot secrets, which GitHub keeps separate from Actions secrets.
  - The action restores `.claude/` and `CLAUDE.md` from the base branch on pull requests, so a change cannot weaken the reviewers that judge it; changes to reviewer definitions take effect only after they merge.
  - No hooks, `apiKeyHelper` or status-line commands in the committed Claude settings: those would run code from the pull request's checkout.
  - `show_full_output` stays off, and the job refuses to run with `ACTIONS_STEP_DEBUG` on, because logs are public on a public repository.
  - The reviewers get read-only tools in CI (`Read`, `Grep`, `Glob`); no shell, no network tools, no file writes. Reviewer definitions that list `Bash` are restricted by the workflow's tool allow-list.
  - The only secret in that step is the Anthropic API key, stored as a GitHub Actions secret scoped to the workflow's environment.
  - Workflow `permissions` are `contents: read` for the model step.
- The authoring session still runs the reviewers before opening a pull request, so problems are fixed before CI spends on them. CI is the gate; the local run is a convenience.
- A change to the review workflow or to `.claude/agents/` is a change to the gate itself: it needs a PASS from the security and architecture reviewers, per REVIEW.md, and the supply-chain reviewer.

## Alternatives

| Option | Why not |
| --- | --- |
| Keep the local run only | Nothing enforces it |
| Human approval on every pull request | The owner chose to stay out of the loop; a solo owner also cannot approve their own pull requests |
| A self-hosted runner holding the key | More to operate and secure, for no gain on a public repository with GitHub-hosted runners |

## Consequences

- The reviewer gate becomes a branch rule: `review-gate` is required on `main`, alongside types, lint, tests and the supply-chain checks.
- Anthropic receives source code, diffs and pull request text from CI. That is listed in the data-flow register; it never includes case data, which the repository never holds.
- Each pull request costs API usage, roughly in proportion to the number of reviewers that run and the size of the diff.
- Reviewers in CI cannot run commands, so a reviewer that needs to run tests relies on the test jobs' results; a reviewer that could not assess something says so, which blocks for must-pass reviewers.

## Sources

- [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action) — `prompt` and `claude_args` inputs, structured outputs as action outputs (checked 2026-11-01)
- [claude-code-action: security](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md) — write-access check, `allowed_bots`, base-branch restore of `.claude/`, fork and `pull_request_target` guidance, `show_full_output` (checked 2026-11-01)

# ADR-0011: Reviewer subagents run in CI as a required check

- Status: Accepted
- Date: 2026-11-01

## Context

[REVIEW.md](../REVIEW.md) makes the reviewer subagents in `.claude/agents/` the gate for every merge, with the owner out of the loop. It said the authoring session runs them; [ROADMAP.md](../ROADMAP.md) said CI runs them. A run inside the authoring session leaves no evidence a branch rule can check.

Three facts shape the design:

- The repository is public ([ADR-0010](0010-stack-revised.md)). Anyone can open a pull request from a fork, and a pull request's diff, description and comments are untrusted input to any model that reads them. Dependabot pull requests carry upstream release notes, which package authors control.
- On the `pull_request` trigger, GitHub runs workflow files from the pull request's own head. A gate defined that way can be edited, or imitated by a new workflow with the same job name, by the change it judges. The Claude Code Action restores `.claude/` and `CLAUDE.md` from the base branch, but not `.github/workflows/`.
- Changes are written by AI agents that read web content, so a prompt injection could lead an agent to write a change that weakens the gate.

## Decision

### The gate

- A CI workflow runs the reviewers with the Claude Code GitHub Action (`anthropics/claude-code-action`), pinned by commit SHA, and produces one required status, `review-gate`.
- The workflow runs on `pull_request_target`, so its definition always comes from `main`. It checks out `main` at the workspace root and the pull request head into a subdirectory, as files to read. It never runs code from the pull request: no install, no build, no scripts. Standards the reviewers judge against (`docs/`, `.claude/`, `CLAUDE.md`) are read from `main`.
- Every reviewer runs on every pull request. A specialist outside its area returns PASS with no findings. Nothing is skipped by path, so a change in an unexpected place cannot dodge a specialist.

### What the model sees and can do

- A step without a model writes the diff, the list of changed files and the history of those files to the workspace. Reviewers read those files instead of running `git`.
- The pull request title, description and comments are never given to the model. Diff and file contents are presented as data inside a delimited block, never as instructions.
- Tools: `Read`, `Grep`, `Glob` only, with permission rules denying any path outside the workspace. No shell, no network tools, no writes. No hooks or helper commands in the committed Claude settings.
- The model step holds only the Anthropic API key and a read-only token. `show_full_output` stays off, and the job refuses to run with `ACTIONS_STEP_DEBUG` set, because logs are public.
- Model IDs are pinned in the workflow rather than aliases, so a model change is a reviewed change.
- The action runs only for authors with write access (its default check) and an explicit `allowed_bots` list: the Claude GitHub App and Dependabot, never `*`. Fork pull requests from others do not run the gate; the owner re-creates such a change on a branch after reading its whole diff, lockfile and workflows included.
- If GitHub withholds Actions secrets from Dependabot-triggered runs, Dependabot uses a second Anthropic key, with its own spend limit, stored as a Dependabot secret.

### The verdict

- Reviewers return JSON against a schema: findings with severity, file, line and text. The verdict is computed in code, not taken from the model:
  - any critical or high finding fails;
  - a medium finding from a must-pass reviewer fails unless `docs/review-acceptances.md` lists it with a reason;
  - missing or invalid output fails.
- A separate step holding a `GITHUB_TOKEN` with `pull-requests: write` posts one comment built only from schema fields, with Markdown escaped and links and images stripped. It scans the comment with gitleaks and posts nothing if a secret pattern matches.
- For dependency changes, a reviewer PASS is not sufficient on its own: osv-scanner, dependency review and the release-age policy must also pass.

### Changing the gate

- Changes to `.github/**`, `.claude/**`, `CLAUDE.md`, `docs/REVIEW.md`, `docs/SECURITY.md`, the gate's canary suite and its scripts need approval from the owner, through `CODEOWNERS` and the ruleset's "require review from Code Owners". This is the one place the owner stays in the loop: without it, a pull request could add a workflow that posts a passing `review-gate`.
- Agents open pull requests as the Claude GitHub App where possible, so the owner can approve them. A pull request opened under the owner's own account is merged through a ruleset bypass, which GitHub records.
- These changes also need a PASS from the security, architecture and supply-chain reviewers.
- A canary suite of known-bad and injected diffs runs on any change to the reviewers, the review workflow or the pinned model IDs, and every case must fail the gate.

### Local runs

- The authoring session still runs the reviewers before opening a pull request, so problems are fixed before CI spends on them. CI is the gate.

## Alternatives

| Option | Why not |
| --- | --- |
| Keep the local run only | Nothing enforces it |
| `pull_request` trigger with base-restored `.claude/` | The workflow file itself comes from the pull request, so the gate can be edited by what it judges |
| Organization ruleset "require workflows" | Needs an organization; reconsider when one exists, since it would remove the owner approval for gate changes |
| Human approval on every pull request | The owner chose to stay out of the loop except for changes to the gate itself |
| Running only the specialists whose paths match | Fails open when a change lands in an unexpected path |

## Consequences

- `review-gate` is required on `main`, alongside types, lint, tests and the supply-chain checks.
- The owner approves changes to the gate and the CI configuration; every other change merges on the reviewers' verdict.
- Anthropic receives source code, diffs and file history from CI; never case data, which the repository never holds. The data-flow register lists it.
- Running every reviewer on every pull request costs more API usage than path-matching would.
- Reviewers in CI cannot run commands. Executing tests is the job of the required test checks; REVIEW.md says a reviewer does not block only because it could not run them in CI.

## Sources

- [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action) — `prompt` and `claude_args` inputs, structured outputs as action outputs (checked 2026-11-01)
- [claude-code-action: security](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md) — write-access check, `allowed_bots`, base-branch restore of `.claude/` only, `pull_request_target` with the head in a subdirectory, `show_full_output` (checked 2026-11-01)

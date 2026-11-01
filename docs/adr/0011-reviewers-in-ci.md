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

- A CI workflow runs the reviewers with the Claude Code GitHub Action (`anthropics/claude-code-action`), pinned by commit SHA. Its report job creates one required check run, `review-gate`, on the pull request head commit it reviewed; the ruleset pins that check to the GitHub Actions app. A new push needs a new verdict.
- The workflow runs on `pull_request_target`, so its definition always comes from `main`. It runs no code from the pull request: no install, no build, no scripts. Standards the reviewers judge against (`docs/`, `.claude/`, `CLAUDE.md`) are read from `main`.
- Every reviewer runs on every pull request. A specialist outside its area returns PASS with no findings. Nothing is skipped by path.

### What the model sees and can do

- A prepare job without a model fetches the pull request at its head SHA, refuses symlinks, and writes the review input: the diff, the list of changed files, their history as SHAs, dates and paths only (no commit messages, names or emails), and the changed files' contents with every `CLAUDE.md`, `CLAUDE.local.md` and `.claude/` removed, so a pull request cannot plant instructions the agent loads as memory. Their content still reaches the reviewers inside the diff, as data.
- The pull request title, description and comments are never given to the model. Untrusted content is wrapped in delimiters carrying a per-run nonce and presented as data, never as instructions.
- The review job holds the Anthropic API key (in a `review` environment limited to `main`) and a read-only `GITHUB_TOKEN`; no `id-token`, no write permission, checkouts without persisted credentials. Tools: `Read`, `Grep`, `Glob`; `Bash`, `Write`, `Edit`, web and MCP tools are denied explicitly, and `Read` is denied outside the workspace and on `.git`. Setting and memory sources are limited to the `main` checkout. `show_full_output` stays off, and the job refuses to run with `ACTIONS_STEP_DEBUG` set, because logs are public.
- Model IDs are pinned in the workflow rather than aliases, so a model change is a reviewed change.
- The action runs only for authors with write access (its default check) and an explicit `allowed_bots` list: the Claude GitHub App and Dependabot, never `*`. Fork pull requests from others do not run the gate; the owner re-creates such a change on a branch after reading its whole diff, lockfile and workflows included.
- If GitHub withholds environment secrets from Dependabot-triggered runs, Dependabot uses a second Anthropic key, with its own spend limit, stored as a Dependabot secret.

### The verdict

- Reviewers return JSON against a schema: findings (severity, stable category, file, line, text) and what they could not assess. The verdict is computed in code, not taken from the model:
  - any critical or high finding fails;
  - a medium finding fails unless [review-acceptances.md](../review-acceptances.md) has a row for this pull request matching reviewer, file and category exactly; the file is code-owned, so a new row needs the owner;
  - anything a must-pass reviewer could not assess fails, except running tests, which the required test checks cover;
  - missing or invalid output fails.
- A report job without a model, which never checks out the pull request, creates the check run and posts one comment built only from schema fields, with Markdown escaped and links and images stripped. It scans the comment with gitleaks and posts nothing on a match.
- For dependency changes, a reviewer PASS is not sufficient on its own: osv-scanner, dependency review and the release-age check must also pass.

### Changing the gate

- Changes to `.github/**`, any `.claude/` directory or `CLAUDE*.md` file, `docs/REVIEW.md`, `docs/SECURITY.md`, `docs/review-acceptances.md`, the canary suite and the gate's scripts need the owner's approval, through `CODEOWNERS` and a ruleset requiring code-owner review. This is the one place the owner stays in the loop: without it, a pull request could add a workflow that creates a passing `review-gate` check.
- Required checks live in a separate ruleset with no bypass actors. The owner may bypass the code-owner ruleset for pull requests only.
- Agents open and update pull requests as the Claude GitHub App, which has no bypass rights. Residual risk: an agent session holding the owner's own token could use the owner's bypass of the code-owner ruleset. Agents therefore never act with the owner's token on this repository.
- These changes also need a PASS from the security, architecture and supply-chain reviewers.
- A canary suite of known-bad and injected diffs (nested instruction files, symlinks, injected text in code, docs, file names and changelog text, requests to quote secrets or run commands) must fail the gate on every case. It runs on any pull request that changes the reviewers, the review workflow or the pinned model IDs (loading the pull request's agent definitions as data against the corpus from `main`), on every push to `main`, and weekly; a failure on `main` opens an issue.

### Local runs

- The authoring session still runs the reviewers before opening a pull request, so problems are fixed before CI spends on them. CI is the gate.

## Alternatives

| Option | Why not |
| --- | --- |
| Keep the local run only | Nothing enforces it |
| `pull_request` trigger with base-restored `.claude/` | The workflow file itself comes from the pull request, so the gate can be edited by what it judges |
| Checking the pull request out as a tree for the model | Nested `CLAUDE.md` files and skills in it would load as instructions |
| Organization ruleset "require workflows" | Needs an organization; reconsider when one exists, since it would remove the owner approval for gate changes |
| Human approval on every pull request | The owner chose to stay out of the loop except for changes to the gate itself |
| Running only the specialists whose paths match | Fails open when a change lands in an unexpected path |

## Consequences

- `review-gate` is required on `main`, alongside types, lint, tests and the supply-chain checks.
- The owner approves changes to the gate and the CI configuration; every other change merges on the reviewers' verdict.
- Anthropic receives source code, diffs, file lists and file history (SHAs, dates, paths) from CI; never case data, which the repository never holds, and no contributor names or emails. The data-flow register lists it.
- Running every reviewer on every pull request costs more API usage than path-matching would.
- Reviewers in CI cannot run commands. Executing tests is the job of the required test checks; REVIEW.md says a reviewer does not block only because it could not run them in CI.

## Sources

- [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action) — `prompt` and `claude_args` inputs, structured outputs as action outputs (checked 2026-11-01)
- [claude-code-action: security](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md) — write-access check, `allowed_bots`, base-branch restore of `.claude/` only, `pull_request_target` with the head in a subdirectory, `show_full_output` (checked 2026-11-01)

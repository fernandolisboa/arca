# ADR-0011: Reviewer subagents run in CI as a required check

- Status: Accepted; amended by [ADR-0012](0012-automation-first-setup.md): no `arca-gate` App, no code-owner approval, agents may push workflows, recovery procedure replaced; amended by [ADR-0013](0013-review-gate-canary-and-model-pins.md): canary counted per gate fingerprint, model IDs pinned in repository variables, Dependabot key as a Dependabot secret
- Date: 2026-11-01

## Context

[REVIEW.md](../REVIEW.md) makes the reviewer subagents in `.claude/agents/` the gate for every merge, with the owner out of the loop. It said the authoring session runs them; [ROADMAP.md](../ROADMAP.md) said CI runs them. A run inside the authoring session leaves no evidence a branch rule can check.

Three facts shape the design:

- The repository is public ([ADR-0010](0010-stack-revised.md)). Anyone can open a pull request from a fork, and a pull request's diff, description and comments are untrusted input to any model that reads them. Dependabot pull requests carry upstream release notes, which package authors control.
- On the `pull_request` trigger, GitHub runs workflow files from the pull request's own head. A gate defined that way can be edited, or imitated by a new workflow with the same job name, by the change it judges. The Claude Code Action restores `.claude/` and `CLAUDE.md` from the base branch, but not `.github/workflows/`.
- Changes are written by AI agents that read web content, so a prompt injection could lead an agent to write a change that weakens the gate.

## Decision

### The gate

- A CI workflow runs the reviewers with the Claude Code GitHub Action (`anthropics/claude-code-action`), pinned by commit SHA. Its report job creates one required check run, `review-gate`, on the pull request head commit it reviewed, authenticated as a dedicated GitHub App (`arca-gate`, with `checks: write` and `pull-requests: write` only, its key in its own environment limited to `main` and used only by the report job). The ruleset pins `review-gate` to that app, and requires branches to be up to date, so the reviewed commit is the one that lands. A new push needs a new verdict.
- The workflow runs on `pull_request_target`, filtered to pull requests targeting `main`, so its definition always comes from `main`. It runs only for pull requests whose head is in this repository, and it runs no code from the pull request: no install, no build, no scripts. Standards the reviewers judge against are read from `main`. Only code-owned files carry instructions (`CLAUDE.md`, `docs/REVIEW.md`, `docs/SECURITY.md`, the agent bodies); every other doc is given to the reviewers as delimited reference data, so a line that slipped into an ordinary doc cannot become a standing instruction to the gate.
- Every reviewer runs on every pull request, each in its own isolated run, so one reviewer's output cannot influence another's; the outputs are combined in code. A specialist outside its area returns PASS with no findings. Nothing is skipped by path.

### What the model sees and can do

- A prepare job without a model fetches the pull request at its head SHA, refuses symlinks, and writes the review input: the diff, the list of changed files, their history as SHAs, dates and paths only (no commit messages, names or emails), and the changed files' contents under neutral names with a path map, so no path from the pull request becomes a real path an agent might load as instructions (`CLAUDE.md`, `.claude/`, `.mcp.json` and the like). Their content still reaches the reviewers inside the diff, as data.
- The pull request title, description and comments are never given to the model. Untrusted content is wrapped in delimiters carrying a per-run nonce and presented as data, never as instructions.
- The review job holds the Anthropic API key (in a `review` environment limited to `main`) and a read-only `GITHUB_TOKEN`; no `id-token`, no write permission, checkouts without persisted credentials. Tools: `Read`, `Grep`, `Glob`; `Bash`, `Write`, `Edit`, `Task`, web and MCP tools are denied explicitly, hooks are disabled, and `Read` is denied outside the workspace and on `.git`. Setting and memory sources are limited to the `main` checkout. `show_full_output` stays off, and the job refuses to run with `ACTIONS_STEP_DEBUG` set, because logs are public.
- Each reviewer's model alias is overridden with a model ID pinned in the workflow, so a model change is a reviewed change.
- The action runs only for authors with write access (its default check) and an explicit `allowed_bots` list: the Claude GitHub App and Dependabot, never `*`. Fork pull requests from others do not run the gate; the owner re-creates such a change on a branch after reading its whole diff, lockfile and workflows included.
- If GitHub withholds environment secrets from Dependabot-triggered runs, Dependabot uses a second Anthropic key, with its own spend limit, stored as a Dependabot secret.

### The verdict

- Reviewers return JSON against a schema: findings (severity, stable category, file, line, text) and what they could not assess. The verdict is computed in code, not taken from the model:
  - any critical or high finding fails;
  - a medium finding fails unless [review-acceptances.md](../review-acceptances.md), read from the pull request head, has a row for this pull request matching reviewer, file and category exactly; the row counts only because the file is code-owned, so the pull request cannot merge without the owner approving it;
  - anything a must-pass reviewer could not assess fails, except the fixed `tests_not_run` reason, which the required test checks cover;
  - missing or invalid output fails.
- A report job without a model, which never checks out the pull request, creates the check run and posts one comment built only from schema fields, with Markdown escaped, links and images stripped, and mentions and issue references neutralized. It scans the comment with gitleaks; a match posts nothing and fails the check.
- For dependency changes, a reviewer PASS is not sufficient on its own: osv-scanner and the lockfile policy check (release age, registry integrity, licenses) must also pass. Those checks take their scripts and policy files from `main` and read the pull request's lockfile as data, so the change they judge cannot weaken them.

### Changing the gate

- Changes to gate paths need the owner's approval, through `CODEOWNERS` and a ruleset requiring code-owner review, dismissing stale approvals on push and requiring approval of the most recent push. Gate paths: `.github/**`, any `.claude/` directory or `CLAUDE*.md` file, `.mcp.json`, `docs/REVIEW.md`, `docs/SECURITY.md`, `docs/review-acceptances.md`, the canary suite, the gate and migration scripts, the database bootstrap script and guard lists, and the dependency-policy files (`pnpm-workspace.yaml`, `.npmrc`, `.pnpmfile.*`, the root `package.json`, `vercel.json`). This is the one place the owner stays in the loop: without it, a pull request could add a workflow that creates a passing `review-gate` check.
- Required checks live in a separate ruleset with no bypass actors. Each is pinned to the app that must create it: `review-gate` to `arca-gate`, the others to GitHub Actions. The owner may bypass the code-owner ruleset for pull requests only.
- Agents open and update pull requests as the Claude GitHub App, which has no bypass rights and is installed without the `workflows` permission and without write access to checks or commit statuses. GitHub then refuses any agent push that adds or changes a workflow file. The `arca-gate` pin is the primary control for `review-gate`; this is defence in depth that also protects the other required checks, since every workflow's token acts as the same GitHub Actions app and a side branch's `push` workflow could otherwise create any check. Agents prepare workflow changes as patches; the owner pushes them. Residual risk: an agent session holding the owner's own token could use the owner's bypass of the code-owner ruleset, so agents never act with the owner's token on this repository.
- These changes also need a PASS from the security, architecture and supply-chain reviewers.
- A canary suite of known-bad and injected diffs (nested instruction files, symlinks, injected text in code, docs, file names and changelog text, requests to quote secrets or run commands) must fail the gate on every case. Each case names its target reviewers and expected category, and passes only if each target reviewer fails on its own verdict for that category, so an overlapping reviewer cannot hide a weakened one; injected-text cases carry a known-bad payload for every must-pass reviewer.
- On a pull request that changes the reviewers or the pinned model IDs, the canary runs the pull request's agent definitions against the corpus from `main`, and its result is part of that pull request's `review-gate` verdict. Those definitions are parsed first: only an allow-list of frontmatter keys is accepted, `tools` is intersected with the read-only set, `model` is overridden with the pinned ID, and only the body is used, as the system prompt, with hooks, MCP servers and skills disabled. A passing run there stands in for the `main` result, so a pull request that repairs the reviewers can merge.
- The canary also runs on every push to `main`, weekly and on manual dispatch, which is where a change to the review workflow itself is tested. A failed case is retried once. The gate reads only canary runs on `main` for its current tip; a missing, running or failed run opens an issue and makes `review-gate` fail closed.
- **Break glass.** If the gate fails closed and the fix is the review workflow itself, which no pull request's canary can test: the owner adds themself as a bypass actor on the checks ruleset, in "pull requests only" mode, merges that one fix, which must have code-owner approval, and removes the bypass immediately; then dispatches the canary on the new `main` tip, which must pass. The ruleset stays on throughout, so no other pull request or app can merge without checks. The ruleset history is the record, and the owner adds a row to the change table in [REVIEW.md](../REVIEW.md#changing-reviewers). This is the only time the checks ruleset has a bypass actor.

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
- Dependency-policy files are gate paths, so the owner approves each Dependabot npm update (weekly, grouped), since those touch `pnpm-workspace.yaml`. Approving out of habit would weaken the check; the deterministic dependency checks still run first.
- Reviewers in CI cannot run commands. Executing tests is the job of the required test checks; REVIEW.md says a reviewer does not block only because it could not run them in CI.

## Sources

- [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action) — `prompt` and `claude_args` inputs, structured outputs as action outputs (checked 2026-11-01)
- [claude-code-action: security](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md) — write-access check, `allowed_bots`, base-branch restore of `.claude/` only, `pull_request_target` with the head in a subdirectory, `show_full_output` (checked 2026-11-01)

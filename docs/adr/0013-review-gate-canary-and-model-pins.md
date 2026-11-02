# ADR-0013: Review gate canary keyed by the gate's fingerprint, and model IDs pinned in repository variables

- Status: Accepted
- Date: 2026-11-02
- Amends: [ADR-0011](0011-reviewers-in-ci.md) (canary trigger, where model IDs are pinned, Dependabot key)

## Context

Spec 0001 R10 says the canary runs on every push to `main`, and the gate fails closed unless a canary run for the current tip of `main` passed. Each run has about 60 model runs: one known-bad case per reviewer, plus injected cases that carry a payload for every must-pass reviewer. Most pushes to `main` change nothing the reviewers see, so that rule would spend a full canary on every merge to re-test an unchanged gate.

ADR-0011 pins each reviewer's model ID in the workflow file. A pin there changes only through a pull request, which the gate under the old pin reviews, and it puts model identifiers into the repository's history.

Spec 0001 R8 asks whether `review` environment secrets reach Dependabot-triggered `pull_request_target` runs. GitHub documents these facts ([Troubleshooting Dependabot on GitHub Actions](https://docs.github.com/en/code-security/dependabot/troubleshooting-dependabot/troubleshooting-dependabot-on-github-actions); [Automating Dependabot with GitHub Actions, GHES 3.7](https://docs.github.com/en/enterprise-server@3.7/code-security/dependabot/working-with-dependabot/automating-dependabot-with-github-actions); both checked 2026-11-02):

- Runs that Dependabot triggers on `push`, `pull_request`, `pull_request_review` and `pull_request_review_comment` get only Dependabot secrets and a read-only token. `pull_request_target` is named as the way around those limits.
- A `pull_request_target` run gets no secrets at all when Dependabot created the pull request's base ref.
- Neither page says whether environment secrets reach a Dependabot-triggered `pull_request_target` run.

A called workflow sees only the secrets its caller passes, including environment secrets of its own jobs, and a calling job cannot name an environment ([Reuse workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows), checked 2026-11-02).

## Decision

### The canary counts per gate fingerprint, not per commit

- **The fingerprint.** It is a SHA-256 over the git tree entries of everything that shapes the reviewers' behavior, plus the pinned model IDs (`tooling/scripts/src/review-gate/fingerprint.ts`). The tree entries cover:
  - `.claude/`, `CLAUDE.md`, `README.md` and `docs/` (except `docs/review-acceptances.md`);
  - the gate's workflows and `.github/actions/`;
  - the gate's scripts and the corpus in `eval/review-gate/`.
- **Where a pass is recorded.** It is recorded as an artifact named `canary-pass-<fingerprint>`, uploaded by a successful run of `review-canary.yml` on `main` on a `push`, `schedule` or `workflow_dispatch` event.
- **What the gate checks.** It looks the artifact up by name and verifies the run's workflow path, branch, event, conclusion and repository. An artifact from any other workflow, branch or event does not count.
- **When the canary runs.** On every push to `main` it first computes the fingerprint and skips when a pass for it exists. It always runs in full weekly and on dispatch.
- **Unchanged from ADR-0011:**
  - The gate waits up to 30 minutes for a running canary on `main`.
  - When no pass exists, it fails closed and opens an issue.
  - A pull request that changes `.claude/agents/` runs the canary with its own definitions, and that result replaces `main`'s.

### Model IDs live in repository variables

This ADR decides that model IDs live in repository settings, not in files. A pin then changes without a pull request, the change shows in the audit log, and no model identifier enters the repository's history.

- **Where the pins live.** Each model alias an agent uses (`fable`, `opus`, `haiku`) is pinned in a repository variable: `REVIEW_MODEL_FABLE`, `REVIEW_MODEL_OPUS` and `REVIEW_MODEL_HAIKU`.
  - The review job passes the pinned ID with `--model`.
  - A missing or malformed variable fails the job.
  - An alias without a variable fails before any model runs.
- **A model change is re-tested.** The IDs are part of the fingerprint, so a changed pin has no canary pass until the canary runs with it. Until then every pull request fails closed. Changing a pin is followed by a dispatched canary run on `main`; a pull request cannot change a pin, so the pull-request canary never covers one.

### Dependabot uses a Dependabot secret of the same name, as a fallback

- Whether the `review` environment's key reaches a Dependabot-triggered `pull_request_target` run is not documented. As a fallback, Dependabot gets a second Anthropic key, with its own spend limit, stored as a Dependabot secret named `ANTHROPIC_API_KEY`.
- The review job reads `secrets.ANTHROPIC_API_KEY` either way, so no workflow or allow-list change is needed.
- The token's access comes from each job's `permissions` key. The read-only limit for Dependabot covers only the events listed above, not `pull_request_target`, so the report job keeps `checks: write` and `pull-requests: write`.
- The action runs for `dependabot` through `allowed_bots`.
- Dependabot never creates a branch that is a pull request's base here, so the no-secrets case does not arise.
- The first Dependabot pull request after setup confirms the key and the repository variables reach the run. If it shows otherwise, this ADR is updated.

### How a reviewer runs

- **Pinned action.** It runs with `anthropics/claude-code-action` pinned by commit SHA, at the newest release at least 7 days old.
- **Tools.** It has `--tools Read,Grep,Glob`, with every other tool, including `mcp__*`, in `--disallowedTools`.
- **Loaded configuration.** It runs with `--strict-mcp-config` and an empty MCP configuration, `--disable-slash-commands`, and `--setting-sources project` over a sparse checkout of `main` that holds only `CLAUDE.md`, `docs/REVIEW.md`, `docs/SECURITY.md` and `.github/actions/`.
- **Settings passed with `--settings`.** They turn off hooks, auto memory, bundled skills and connectors, and set `permissions.blockReadsOutsideWorkingDirectories` with `.git` denied.
- **Reads outside the workspace.** Explicit deny rules for `/proc`, `/sys`, `/tmp`, `~/.claude` and the runner's temp directory back up `blockReadsOutsideWorkingDirectories`, since deny rules apply to every built-in tool that reads files.
- **The agent body.** It goes into the prompt, so it is never loaded as an agent file.
- **The output.** It is scanned with gitleaks before it is uploaded as an artifact; on a match it is dropped and the reviewer counts as missing.
- **The canary's retry.** The action retries a canary run once when it lacks a blocking finding of every expected category, so a failed first attempt does not fail the run on its own.
- **The pull-request canary's key.** The gate passes `ANTHROPIC_API_KEY` by name to `review-canary.yml`, whose `run` job names the `review` environment. GitHub resolves the name from that environment.

## Alternatives

| Option | Why not |
| --- | --- |
| Canary on every push to `main`, keyed by commit | About 60 model runs per merge, mostly re-testing an unchanged gate |
| Canary only when a path filter on the workflow matches | The path list would live in two places, the workflow and the fingerprint, and could drift |
| Model IDs in the workflow file | Model identifiers stay out of the repository |
| Reusable workflow for the review job | Secrets in a called workflow depend on the caller; a composite action takes the key as an input, which the secrets lint already governs |

## Consequences

- **Cost.** A change to docs, reviewers or the gate costs one canary run, about 60 model runs. Other merges cost nothing extra, and the weekly run catches drift at a fixed model ID.
- **Doc changes count.** Any change under `docs/` changes the fingerprint, since reference docs reach the reviewers. Docs-heavy weeks cost more canary runs.
- **Setup by the owner, once.** [ADR-0012](0012-automation-first-setup.md) has agents apply repository settings, but the GitHub access agents have here cannot write environments, secrets or variables. The owner sets the three variables, the `review` environment with its key, and the Dependabot secret, then dispatches the canary; the step is in [OPEN-QUESTIONS.md](../OPEN-QUESTIONS.md). Until then, the gate and the canary fail closed.
- **Corpus depth.** Each reviewer has one known-bad payload, so a reviewer narrowed to exactly that payload would still pass its own case. The pull request that weakens it is also reviewed by `main`'s unchanged reviewers, and the injected cases test the same reviewers again. More payloads per reviewer are tracked as a follow-up.

## Sources

- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference): `--tools`, `--disallowedTools` with `mcp__*`, `--effort` levels, `--json-schema`, `--disable-slash-commands`, `--setting-sources` (checked 2026-11-02)
- [Claude Code settings](https://code.claude.com/docs/en/settings) and [settings reference](https://code.claude.com/docs/en/settings-reference): `permissions.blockReadsOutsideWorkingDirectories`, `disableAllHooks`, `autoMemoryEnabled`, `disableBundledSkills` (checked 2026-11-02)
- [anthropics/claude-code-action v1.0.262](https://github.com/anthropics/claude-code-action/tree/925afb53776cf1a2b738c6bdbed37b4d4000ef13): agent mode adds no MCP server unless GitHub tools are allowed, `ACTIONS_STEP_DEBUG` forces full output, `allowed_bots`, structured output (read 2026-11-02)
- GitHub Dependabot docs, as above

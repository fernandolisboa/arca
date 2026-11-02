# ADR-0013: Review gate canary keyed by the gate's fingerprint, and model IDs pinned in repository variables

- Status: Accepted
- Date: 2026-11-02
- Amends: [ADR-0011](0011-reviewers-in-ci.md) (canary trigger, where model IDs are pinned, Dependabot key)

## Context

Spec 0001 R10 says the canary runs on every push to `main`, and the gate fails closed unless a canary run for the current tip of `main` passed. Each run has about 60 model runs: one known-bad case per reviewer, plus injected cases that carry a payload for every must-pass reviewer. Most pushes to `main` change nothing the reviewers see, so that rule would spend a full canary on every merge to re-test an unchanged gate.

ADR-0011 pins each reviewer's model ID in the workflow file. Model identifiers are kept out of the repository for this project, so the pins need another home that still forces a re-test when they change.

Spec 0001 R8 asks whether `review` environment secrets reach Dependabot-triggered `pull_request_target` runs. GitHub documents that Dependabot-triggered workflows get only Dependabot secrets. It also says that when a `pull_request_target` workflow is started by Dependabot and the pull request's base ref was created by Dependabot, there are no secrets at all ([Troubleshooting Dependabot on GitHub Actions](https://docs.github.com/en/code-security/dependabot/troubleshooting-dependabot/troubleshooting-dependabot-on-github-actions); [Automating Dependabot with GitHub Actions, GHES 3.7](https://docs.github.com/en/enterprise-server@3.7/code-security/dependabot/working-with-dependabot/automating-dependabot-with-github-actions); both checked 2026-11-02). Neither page says that environment secrets reach those runs.

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

- **Where the pins live.** Each model alias an agent uses (`fable`, `opus`, `haiku`) is pinned in a repository variable: `REVIEW_MODEL_FABLE`, `REVIEW_MODEL_OPUS` and `REVIEW_MODEL_HAIKU`.
  - The review job passes the pinned ID with `--model`.
  - A missing or malformed variable fails the job.
  - An alias without a variable fails before any model runs.
- **A model change is re-tested.** The IDs are part of the fingerprint, so a changed pin has no canary pass until the canary runs with it. Until then every pull request fails closed, and the change shows in the repository's audit log.

### Dependabot uses a Dependabot secret of the same name

- Environment secrets are not documented to reach Dependabot-triggered runs. Dependabot therefore gets a second Anthropic key, with its own spend limit, stored as a Dependabot secret named `ANTHROPIC_API_KEY`.
- The review job reads `secrets.ANTHROPIC_API_KEY` either way, so no workflow or allow-list change is needed.
- The action runs for `dependabot` through `allowed_bots`.
- The first Dependabot pull request after setup confirms it. If it shows otherwise, this ADR is updated.

### How a reviewer runs

- **Pinned action.** It runs with `anthropics/claude-code-action` pinned by commit SHA, at the newest release at least 7 days old.
- **Tools.** It has `--tools Read,Grep,Glob`, with every other tool, including `mcp__*`, in `--disallowedTools`.
- **Loaded configuration.** It runs with `--strict-mcp-config` and an empty MCP configuration, `--disable-slash-commands`, and `--setting-sources project` over a sparse checkout of `main` that holds only `CLAUDE.md`, `docs/REVIEW.md`, `docs/SECURITY.md` and `.github/actions/`.
- **Settings passed with `--settings`.** They turn off hooks, auto memory, bundled skills and connectors, and set `permissions.blockReadsOutsideWorkingDirectories` with `.git` denied.
- **The agent body.** It goes into the prompt, so it is never loaded as an agent file.

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
- **Setup by the owner.** The owner sets the three variables, the `review` environment with its key, and the Dependabot secret. Until they exist, the gate and the canary fail closed.

## Sources

- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference): `--tools`, `--disallowedTools` with `mcp__*`, `--effort` levels, `--json-schema`, `--disable-slash-commands`, `--setting-sources` (checked 2026-11-02)
- [Claude Code settings](https://code.claude.com/docs/en/settings) and [settings reference](https://code.claude.com/docs/en/settings-reference): `permissions.blockReadsOutsideWorkingDirectories`, `disableAllHooks`, `autoMemoryEnabled`, `disableBundledSkills` (checked 2026-11-02)
- [anthropics/claude-code-action v1.0.262](https://github.com/anthropics/claude-code-action/tree/925afb53776cf1a2b738c6bdbed37b4d4000ef13): agent mode adds no MCP server unless GitHub tools are allowed, `ACTIONS_STEP_DEBUG` forces full output, `allowed_bots`, structured output (read 2026-11-02)
- GitHub Dependabot docs, as above

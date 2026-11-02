# ADR-0013: Review gate canary keyed by the gate's fingerprint, and reviewers on model aliases

- Status: Accepted; revised on 2026-11-02 so reviewers run on model aliases, with repository variables as optional pins, and on the owner's Claude subscription instead of an API key; revised again the same day so a push to `main` dispatches the canary from `review-canary-push.yml`, so a gate reviewer whose model never answers runs once on a fallback model, so the gate skips draft pull requests, and so a push to `main` runs a slim canary while the weekly run covers the whole corpus
- Date: 2026-11-02
- Amends: [ADR-0011](0011-reviewers-in-ci.md) (canary trigger and scope, which model each reviewer runs on and its fallback, the reviewers' credential and its Dependabot copy, `allowed_bots`, draft pull requests)

## Context

Spec 0001 R10 says the canary runs on every push to `main`, and the gate fails closed unless a canary run for the current tip of `main` passed. A full run has about 85 model runs: one known-bad case per reviewer, plus injected cases that carry a payload for every must-pass reviewer. Most pushes to `main` change nothing the reviewers see, so that rule would spend a full canary on every merge to re-test an unchanged gate.

ADR-0011 pins each reviewer's model ID in the workflow file. A pin there changes only through a pull request, which the gate under the old pin reviews, and it puts model identifiers into the repository's history. Pins kept in repository variables avoid both, but every new model then needs the owner to edit settings by hand, which is the kind of routine chore [ADR-0012](0012-automation-first-setup.md) exists to remove.

Spec 0001 R8 asks whether `review` environment secrets reach Dependabot-triggered `pull_request_target` runs. GitHub documents these facts ([Troubleshooting Dependabot on GitHub Actions](https://docs.github.com/en/code-security/dependabot/troubleshooting-dependabot/troubleshooting-dependabot-on-github-actions); [Automating Dependabot with GitHub Actions, GHES 3.7](https://docs.github.com/en/enterprise-server@3.7/code-security/dependabot/working-with-dependabot/automating-dependabot-with-github-actions); both checked 2026-11-02):

- Runs that Dependabot triggers on `push`, `pull_request`, `pull_request_review` and `pull_request_review_comment` get only Dependabot secrets and a read-only token. `pull_request_target` is named as the way around those limits.
- A `pull_request_target` run gets no secrets at all when Dependabot created the pull request's base ref.
- Neither page says whether environment secrets reach a Dependabot-triggered `pull_request_target` run.

A called workflow sees only the secrets its caller passes, including environment secrets of its own jobs, and a calling job cannot name an environment ([Reuse workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows), checked 2026-11-02).

## Decision

### The canary counts per gate fingerprint, not per commit

- **The fingerprint.** It is a SHA-256 over the git tree entries of everything that shapes the reviewers' behavior, plus the model each alias resolves to (`tooling/scripts/src/review-gate/fingerprint.ts`). The tree entries cover:
  - `.claude/`, `CLAUDE.md`, `README.md` and `docs/` (except `docs/review-acceptances.md`);
  - the gate's workflows and `.github/actions/`;
  - the gate's scripts and the corpus in `eval/review-gate/`.
- **A later failure revokes a pass.** A pass counts only if its run is newer than every failed canary run on `main` (a `schedule` or `workflow_dispatch` run that failed or timed out; cancelled, skipped and startup-failed runs test no model). A pass also counts only from a run's first attempt: a re-run reads the model variables again, so it may test other models than its plan fingerprinted. A re-run on `main` fails by design, so its failure keeps revoking; to recover, dispatch a new run. An alias can move to a new model without changing the fingerprint, so a failed weekly run stops the gate until a newer run passes for the current fingerprint; an older pass for the same fingerprint, for example from before a pin was set and removed again, does not come back. While the run that will fail is still running, the earlier pass still counts.
- **Where a pass is recorded.** It is recorded as an artifact named `canary-pass-<fingerprint>`, uploaded by a successful run of `review-canary.yml` on `main` on a `schedule` or `workflow_dispatch` event.
- **What the gate checks.** It looks the artifact up by name and verifies the run's workflow path, branch, event, conclusion and repository. An artifact from any other workflow, branch or event does not count.
- **When the canary runs.** Every push to `main` dispatches it with `skip-if-passed`, so it first computes the fingerprint and stops when a pass for it exists. The dispatch comes from a separate workflow, `review-canary-push.yml`, for two reasons: `anthropics/claude-code-action` rejects `push` events ("Unsupported event type" in `src/github/context.ts` at the pinned commit, checked 2026-11-02), and the gate calls `review-canary.yml`, whose jobs may not ask for more than the caller's `actions: read`. The dispatched run's actor is `github-actions[bot]`, which the action refuses unless it is in `allowed_bots`, so the canary adds it only for `workflow_dispatch` runs by that actor; the review gate never allows it. The gate counts a queued or running push workflow, and a dispatched run waiting for the concurrency group, as a canary in progress, so a pull request checked right after a merge waits instead of failing. The dispatch is retried three times; if it still fails, the gate fails closed and a manual dispatch recovers. The push workflow is left out of the fingerprint because it shapes nothing the reviewers see. It always runs weekly, and on the owner's dispatch without `skip-if-passed`. A dispatch by anyone but the owner, `github-actions[bot]` or `claude[bot]` included, always gets `skip-if-passed` and the slim scope (below), so a workflow or app holding `actions: write` cannot force runs on the owner's subscription while a pass exists, nor a full run at all. Agents that dispatch with the owner's token act as the owner.
- **What a run covers.** A full run covers the whole corpus. A slim run covers one known-bad case per reviewer and the cases that need no model: one model run per reviewer, about a tenth of a full run. A push to `main` runs slim; the weekly run and the owner's dispatch run full, unless the dispatch asks for slim. A slim pass certifies the fingerprint like a full one, so the injected-text cases run on a changed gate only weekly: a change that weakens injection resistance can gate pull requests for up to a week, its own review by `main`'s unchanged reviewers being the control meanwhile, and the weekly failure then revokes the pass. A slim run never clears a failure: when a canary run on `main` failed after the newest success, a slim run fails before any model runs, so only a full run, weekly or dispatched by the owner, can clear it. It fails rather than skips because a skipped run ends in success, which would count as the newest success. While a failure stands, pushes to `main` cost nothing but a failed run each. A failed slim run also needs a full run to clear; tracking each run's scope would avoid that, at the cost of more state for a rare case. The check is global, not per fingerprint: once a full run passes for one fingerprint, a revert to a fingerprint whose full run failed earlier can pass slim. That revert is itself a reviewed gate change, and the weekly run re-tests it. A pull request that changes `.claude/agents/` still runs the full corpus with its own definitions: that is where an agent body that weakens injection resistance would come in, and the gate skips drafts, so it runs about once per such pull request.
- **Unchanged from ADR-0011:**
  - The gate waits up to 30 minutes for a running canary on `main`.
  - When no pass exists, it fails closed and opens an issue.
  - A pull request that changes `.claude/agents/` runs the canary with its own definitions, and that result replaces `main`'s.

### Reviewers run on model aliases; repository variables are optional pins

- **The default.** Each reviewer runs on the alias its agent definition names (`fable`, `opus`, `haiku`), passed with `--model`. On the Anthropic API an alias resolves to the newest model of its family and updates over time ([Claude Code model configuration](https://code.claude.com/docs/en/model-config), checked 2026-11-02), so a new model needs no change from anyone, and no model identifier enters the repository or its settings.
- **Optional pins.** A repository variable (`REVIEW_MODEL_FABLE`, `REVIEW_MODEL_OPUS`, `REVIEW_MODEL_HAIKU`) pins its alias to a model ID when one is set, for example to hold a model back while a regression is investigated. An empty or unset variable means the alias. A malformed value fails the job, and an alias the gate does not know fails before any model runs.
- **What the fingerprint holds.** The resolved value for each alias: the pin when set, otherwise the alias itself. Changing or removing a pin changes the fingerprint, so it has no canary pass until the canary runs with it; dispatch the canary on `main` after changing one. An alias that moves to a new model leaves the fingerprint unchanged: the weekly full run re-tests it, and a failure there revokes the pass (above).

### Reviewers run on the owner's Claude subscription

- **The credential.** The review and canary jobs authenticate the action with a Claude Code OAuth token, made once with `claude setup-token` and stored as `CLAUDE_CODE_OAUTH_TOKEN`, not with an API key. Runs then use the owner's Claude subscription instead of API billing ([Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions), checked 2026-11-02).
- **Why.** Claude Code usage through an API key draws on purchased API credit, which promotional credits do not cover. The owner does not want a standing API spend for CI reviews.
- **Cost.** Reviews and canary runs count against the subscription's usage limits, shared with the owner's own use. The limits are per model: on 2026-11-02, after a day of gate development, every `fable` reviewer failed in under a second with no model usage while `opus` and `haiku` reviewers ran. A gate run that hits a limit runs once on the fallback model (below); if that fails too, the gate fails closed. A `fable` limit moves the seven `fable` reviewers onto `opus`, which can then reach its own limit, shared with the context reviewer and the owner's own work. To spend less, the gate skips draft pull requests, which cannot merge, and reviews them when they are marked ready; authors iterate as drafts with the local reviewer subagents and mark a pull request ready when it is done. This holds only while the account's extra usage (paid overage) stays off; with it on, a heavy week or a leaked token turns into the spend this section avoids.
- **Lifetime.** `claude setup-token` makes a one-year token ([Authentication](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token), checked 2026-11-02). When it expires, every review and the weekly canary fail, and the failed canary revokes the pass. [OPEN-QUESTIONS](../OPEN-QUESTIONS.md) tracks the rotation date; rotating means running `claude setup-token` again and replacing both copies of the secret.
- **Scope.** The token can only make model requests, but on the owner's whole account: it cannot be limited to this repository. GitHub keeps it in the `review` environment, limited to `main`, and as the Dependabot fallback below; only jobs that name it receive it.
- **Terms.** Requests run under the owner's subscription terms, not the API's commercial terms, so the data-flow register records them and the account's model-improvement setting stays off. The content is this public repository's code, docs and synthetic canary cases, never case data.
- **Leak detection.** The default gitleaks rules match API and admin keys only, so `.github/policy/gitleaks.toml` adds a rule for every `sk-ant-` token kind. The reviewer output scan therefore catches a leaked OAuth token too.

### Dependabot uses a Dependabot secret of the same name, as a fallback

- Whether the `review` environment's token reaches a Dependabot-triggered `pull_request_target` run is not documented. As a fallback, the same token is also stored as a Dependabot secret named `CLAUDE_CODE_OAUTH_TOKEN`.
- The review job reads `secrets.CLAUDE_CODE_OAUTH_TOKEN` either way, so no workflow or allow-list change is needed.
- Both copies hold the same token, so they are rotated and revoked together. A separate token for Dependabot would only separate their usage; it adds a second rotation for no change in exposure, since a Dependabot secret reaches only Dependabot-triggered runs of jobs that name it, and the secrets lint keeps it out of every `pull_request` workflow.
- The token's access comes from each job's `permissions` key. The read-only limit for Dependabot covers only the events listed above, not `pull_request_target`, so the report job keeps `checks: write` and `pull-requests: write`.
- The action runs for `dependabot` through `allowed_bots`.
- Dependabot never creates a branch that is a pull request's base here, so the no-secrets case does not arise.
- The first Dependabot pull request after setup confirms the token, and any pins set, reach the run. If it shows otherwise, this ADR is updated.

### How a reviewer runs

- **Pinned action.** It runs with `anthropics/claude-code-action` pinned by commit SHA, at the newest release at least 7 days old.
- **Tools.** It has `--tools Read,Grep,Glob`, with every other tool, including `mcp__*`, in `--disallowedTools`.
- **Loaded configuration.** It runs with `--strict-mcp-config` and an empty MCP configuration, `--disable-slash-commands`, and `--setting-sources project` over a sparse checkout of `main` that holds only `CLAUDE.md`, `docs/REVIEW.md`, `docs/SECURITY.md` and `.github/actions/`.
- **Settings passed with `--settings`.** They turn off hooks, auto memory, bundled skills and connectors, and set `permissions.blockReadsOutsideWorkingDirectories` with `.git` denied.
- **Reads outside the workspace.** Explicit deny rules for `/proc`, `/sys`, `/tmp`, `~/.claude` and the runner's temp directory back up `blockReadsOutsideWorkingDirectories`, since deny rules apply to every built-in tool that reads files.
- **The agent body.** It goes into the prompt, so it is never loaded as an agent file.
- **The output.** It is scanned with gitleaks before it is uploaded as an artifact; on a match it is dropped and the reviewer counts as missing.
- **The fallback model, in the gate only.** When the first attempt ends without output and the action's execution log ends in an API error result (`subtype` `success`, `is_error` true) whose model usage holds no tokens, no model judged the change, so the action runs once on the reviewer's fallback model: `fable` falls back to `opus`, `opus` to `fable` and `haiku` to `opus`, each through its own optional pin. The job log and its summary note the fallback. The first request carries `main`'s prompt and instructions with the change as data, and a run in which any model answered keeps its outcome (a turn limit, a refusal, missing output). A change can at most make the first request fail before any model answers, for example by its size, or spend the primary model's limit through a volume of pull requests; either only moves its review to the other strong model, where before it denied service.
  - **What the canary certifies.** The canary never falls back: it certifies each reviewer on its own model, and a limit fails a canary run closed, as before. A gate review on a fallback model therefore runs a reviewer and model pair that this fingerprint's canary has not run. That is accepted: both fallbacks are strong models, aliases already move between models without a new canary, and the alternative is no review until the limit resets. Certifying every pair would double the canary's usage, which the limit makes the scarcest resource.
  - **What was rejected.** Treating a limit as neutral: it would let a change merge without a must-pass reviewer having read it.
- **The canary's retry.** The action retries a canary run once when it lacks a blocking finding of every expected category, so a failed first attempt does not fail the run on its own. The gate never retries; a review that answered keeps its outcome.
- **The pull-request canary's token.** The gate passes `CLAUDE_CODE_OAUTH_TOKEN` by name to `review-canary.yml`, whose `run` job names the `review` environment. GitHub resolves the name from that environment.

## Alternatives

| Option | Why not |
| --- | --- |
| Canary on every push to `main`, keyed by commit | About 85 model runs per merge, mostly re-testing an unchanged gate |
| Full canary on every gate change | About 85 model runs each; on 2026-11-02 a day of gate changes spent the subscription's `fable` limit |
| Canary only when a path filter on the workflow matches | The path list would live in two places, the workflow and the fingerprint, and could drift |
| Model IDs in the workflow file | Model identifiers stay out of the repository |
| Model IDs required in repository variables | Every new model needs the owner to edit settings by hand |
| Reusable workflow for the review job | Secrets in a called workflow depend on the caller; a composite action takes the key as an input, which the secrets lint already governs |

## Consequences

- **Cost.** A change to docs, reviewers or the gate costs one slim canary run, one model run per reviewer; a pull request that changes `.claude/agents/` costs a full run, about 85. The weekly full run costs about 85 and catches drift, including a new model behind an alias and a gate that lost injection resistance. Other merges cost nothing extra.
- **Doc changes count.** Any change under `docs/` changes the fingerprint, since reference docs reach the reviewers. Docs-heavy weeks cost more canary runs.
- **Setup by the owner, once.** [ADR-0012](0012-automation-first-setup.md) has agents apply repository settings, but the GitHub access agents have here cannot write environments, secrets or variables. The owner sets the `review` environment with the subscription token and the Dependabot secret, then dispatches the canary. The model variables are optional. The step is in [OPEN-QUESTIONS.md](../OPEN-QUESTIONS.md). Until then, the gate and the canary fail closed.
- **A new model reviews before it is tested.** ADR-0011 had every model change reviewed, and the first version of this ADR re-tested a new pin before it counted. An alias that moves to a new model gates pull requests at once; the canary tests it at the next weekly or dispatched run, so the gap can be up to a week. A failure then stops the gate. To hold a model back, set its variable to the previous model ID and dispatch the canary.
- **Corpus depth.** Each reviewer has one known-bad payload, so a reviewer narrowed to exactly that payload would still pass its own case. The pull request that weakens it is also reviewed by `main`'s unchanged reviewers, and the injected cases test the same reviewers again. More payloads per reviewer are tracked as a follow-up.

## Sources

- [Claude Code model configuration](https://code.claude.com/docs/en/model-config): aliases resolve to the newest model on the Anthropic API and update over time; `--model` takes an alias or a full model name (checked 2026-11-02)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference): `--tools`, `--disallowedTools` with `mcp__*`, `--effort` levels, `--json-schema`, `--disable-slash-commands`, `--setting-sources` (checked 2026-11-02)
- [Claude Code settings](https://code.claude.com/docs/en/settings) and [settings reference](https://code.claude.com/docs/en/settings-reference): `permissions.blockReadsOutsideWorkingDirectories`, `disableAllHooks`, `autoMemoryEnabled`, `disableBundledSkills` (checked 2026-11-02)
- [anthropics/claude-code-action v1.0.262](https://github.com/anthropics/claude-code-action/tree/925afb53776cf1a2b738c6bdbed37b4d4000ef13): agent mode adds no MCP server unless GitHub tools are allowed, `ACTIONS_STEP_DEBUG` forces full output, `allowed_bots`, structured output, and the `execution_file` output set even when a run fails (read 2026-11-02)
- [GitHub: events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows): `pull_request_target` activity types including `ready_for_review`, and `workflow_dispatch` runs started with `GITHUB_TOKEN` (checked 2026-11-02)
- [GitHub: workflow syntax, `on.workflow_dispatch.inputs`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onworkflow_dispatchinputs): `choice` inputs and their defaults (checked 2026-11-02)
- GitHub Dependabot docs, as above

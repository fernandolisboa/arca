# ADR-0032: Session reviews store and activate rule versions through a reviewed pull request

- Status: Accepted
- Date: 2026-11-19
- Amends: [ADR-0031](0031-rule-updates-on-request.md) (a second way to add a route version, and an activation with no passkey); [ADR-0027](0027-admins-and-the-checked-batch-activation.md) (a fourth decision proof); [ADR-0014](0014-knowledge-base-as-reviewed-data.md) (who approves a version); [ADR-0008](0008-database-security-and-environments.md) (what `app_migrator` may insert); CLAUDE.md rule 5

## Context

Since ADR-0031 a rule changes only through an update request in the app, which spends the Anthropic API credit (used up until 2026-12-01), and every version needs an admin's passkey. The catalog holds 19 routes of 18 countries whose imported versions were never checked to the owner's satisfaction, and the loop that should have done it cost more than it fixed.

On 2026-11-19 the owner asked, in the project thread, to keep the in-app flow for later and to fix this first version of the catalog in Claude Code sessions on his subscription: one thread per country, each route read against the official sources, adversarial reviewers, at most three rounds, and then publish, "as with pull requests". Told that activation needs his passkey, he chose to drop that step for these sessions (in pt-BR): "quando vier daqui, estou tranquilo em ter aprovação direta. Já vai ter passado pelos reviewers", and "pode até ser que no futuro habilite isso de novo, mas pra essa primeira versão são muitos países e tipos de entrada".

## Decision

A **session review** is a Claude Code session the owner asks for that reviews the stored routes of one country and stores corrected versions, already active, through a reviewed pull request. It follows [the runbook](../runbooks/session-rule-review.md).

- **What it may write.** Only the next version of a route the database already holds, on the official-domain lists that route already pins: the app's own proposal check, `checkProposal` with an `update` target, refuses anything else. A new route, an official-domain list and a country set still go through the app, with a passkey.
- **Files.** `packages/knowledge/reviews/<review>/<route>.<number>.json` holds the version, `.cases.json` its cases with inline snapshots, and `.evidence.json` one to five official passages for every item the quote check reads (`checkItems`), each on a page the item cites. `packages/knowledge/data` stays as the import read it.
- **Checks in code.** `packages/knowledge/scripts/session-review.ts` checks each version as an update request's proposal is checked (schema, version order, pinned files, cases and coverage) against the imported rows and every earlier review, and checks that the evidence covers every item. A test compares the committed migration with one generated again, so CI fails on a version that does not pass or a migration edited by hand. The same test, run by the session with `ARCA_REVIEW_QUOTES=<review>`, reads the official pages and fails when a quote is not on the page its item cites; it needs the network, so CI skips it.
- **Rounds.** After the session's own reading, adversarial reviewer subagents try to prove each version wrong against the official text. At most three rounds of review and correction a route; what is still disputed is listed for the owner with its reason, never counted as matching.
- **Storage and activation.** The review's generated migration inserts each version, aborting when a stored row under the same ID and number has another hash, and one `session_review` decision a version: `activate`, of a route, with no author and no assertion, bound to the content hash and the cases hash.
- **The database.** `decision.proof` gains `session_review`; a check admits it only to activate a route version with a cases hash and none of the admin or step-up fields, and the author is null on these rows only. `app_migrator`, which owns the table, gets an insert policy for this proof alone and gives up `UPDATE`, `DELETE` and `TRUNCATE` on decisions. No runtime role can store one.
- **The API.** A `session_review` activation counts as stored. As for an `admin_step_up` row, a version that now reads under another content or cases hash is refused, as rejected. An admin's rejection, with a passkey, still takes any such version out of use for good.
- **Who approves.** The owner's instruction above, and the merge of the pull request once CI and the repository's must-pass reviewers pass, stand in for the passkey on these versions. Eligibility stays deterministic: a model writes and checks rule data, and the engine alone decides who qualifies.
- **Turning it off.** The owner said he may want the passkey back. Dropping the `decision_insert_session_review` policy in one migration ends new activations; stored ones keep counting.

## Consequences

- A merged pull request can now put a rule into use. Before, a merge could only propose, and the passkey stood between an agent (tricked by a researched page, or misusing the owner's token) and an active rule. The owner accepts this for a family's personal app. What remains in the way: a review cannot widen an official-domain list or add a route; every item needs a quote that code finds on an official page; the proposal check and the migration comparison run in CI; the reviewers read `packages/knowledge/reviews/` and the migrations; and an admin can reject any version in the app.
- Rule content of reviewed versions lives in the repository again, as review files and a generated migration. The database rows stay the only thing the API reads.
- A review needs a deploy, since its migration runs in the build ([ADR-0012](0012-automation-first-setup.md)); a failed check fails the build and leaves production as it was.
- A source's `verifiedAt` is the São Paulo date the session read its page, set by the session, not by the pipeline.
- The update request, its passkey decisions and the hand edit are unchanged.

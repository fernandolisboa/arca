# ADR-0025: A model summarizes a rule version for the approver

- Status: Accepted
- Date: 2026-11-06
- Amends: [ADR-0004](0004-ai-providers-behind-ports.md) (a `Summarizer` port), [ADR-0023](0023-free-text-intake-sends-the-writers-own-words.md) and [ADR-0016](0016-observability-and-scrubbing.md) (when Langfuse comes in)

## Context

The owner asked on 2026-11-06 for a "Resumir esta regra" button on the activation screen: a model reads the version and lists the main points to watch, so reviewing a long rule takes less time. The approver still decides; CLAUDE.md rule 2 keeps any model out of eligibility and rule 5 keeps the decision with a person.

It is the second model call kind after free-text intake. ADR-0023 brought Langfuse in "until a second model call kind exists", a vendor account and keys for the owner to set up for a one-family app.

## Decision

- **What the model reads:** one version's content as the approver's view lays it out, without its hash, its state or what rejecting it would do to today's selection. That is public rule data from the repository and no case data, so the call needs no exception to minimization ([ADR-0004](0004-ai-providers-behind-ports.md)). The content is framed as data, and the prompt tells the model to point at odd text in it without repeating it.
- **What it answers:** a closed schema of plain text, an overview and points to check (the prompt asks for at most six; the schema allows eight, as margin), parsed by the API and asked for again once when it does not parse. The screen renders it as text, so nothing in it becomes a link or an image, and labels it as written by a model that can be wrong, next to the rule it summarizes. It never says whether anyone qualifies or whether the rule is right, and it is never stored, shown to members or used by the evaluation engine.
- **Port and model:** a `Summarizer` port, added to ADR-0004's list (`Writer` drafts documents for a case; this reads public rules for the approver), with a Claude adapter that shares the intake's call shape (host pinned, no tools, no SDK retries, telemetry off, failures turned into fixed codes). The model is `claude-sonnet-5-5` at medium effort, kept in reviewed code: pointing at what to check is judgment, which CLAUDE.md routes to a strong model; a version is a few thousand tokens, so a summary costs cents.
- **Cost bounds:** only approvers may ask; 5 requests per minute and 30 per day per account, each one or two model calls (two when the first reply does not parse); each server instance keeps a summary by the version's content hash, so the same version is summarized once per instance, and the screen keeps it for the visit. Only bundled versions can be summarized, so the cache holds at most one entry per catalog version. A failure is not kept.
- **Evaluation:** `apps/api/test/eval/rule-summary` summarizes every bundled version and three copies of one with planted instructions (two in a requirement's title, one in a source's title, which the prompt asks the model to name), through the route's own path. A run passes when every summary parses and states no number the version does not state, no link or Markdown, no verdict on who qualifies or on the rule, and none of the planted words. The manual `intake-eval` workflow runs it after the intake evaluation; a change to the prompt, the model or the adapter runs it and lands only if it passes. The report prints every summary, fenced as plain text, so a person can read what the approver would see. As with the intake, production reaches the adapter only after two passing runs on one commit, recorded in the real-data gate.
- **Langfuse still waits**, now until the owner asks for it. This is the authoring session's technical call (YAGNI), not the owner's; he can ask for Langfuse at any time. Both call kinds log only the prompt version, model, token counts, latency and error code through the allow-list logger.

## Consequences

- A summary can still miss a point or word one badly. The approver reads the rule itself; the summary only says where to look first.
- The key Production and Preview share now pays for two call kinds; the limits and the cache keep the summary to cents a day at most.
- A new deployment or a cold instance summarizes again; storing summaries in the database would avoid that at the cost of a table, a migration and its access rules, which a few cents do not justify (YAGNI).

## Alternatives considered

| Option | Why not |
| --- | --- |
| A fast, cheap model | Finding what a reviewer should check is judgment, not extraction; the price difference is cents a summary |
| Write each summary into the repository with the version | Another review chore on every proposal, and a summary written by the proposing agent is not an independent reading |
| Keep summaries in a table | Survives restarts, but a migration and access rules for data that costs cents to recompute |

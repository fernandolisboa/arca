# ADR-0031: Rule updates on request, in two rounds, with rules in the database

- Status: Accepted
- Date: 2026-11-16
- Spec: [#455](https://github.com/fernandolisboa/arca/issues/455)
- Supersedes: [ADR-0029](0029-correction-requests-and-the-corrector-session.md) (the corrector run, its key and its trigger; the correction request becomes the update request)
- Amends: [ADR-0014](0014-knowledge-base-as-reviewed-data.md) (where the base lives; how a version is proposed); [ADR-0027](0027-admins-and-the-checked-batch-activation.md) (the independent check, its starts, country guides, the checked batch, the audit loop and the catalog check); [ADR-0025](0025-rule-summary-for-the-approver.md) (summaries read versions from the database); [ADR-0004](0004-ai-providers-behind-ports.md) (a `RuleResearcher` and a `RuleValidator` port; the key comes from settings; rule data and page text may be cached); [ADR-0028](0028-pdf-text-in-the-independent-check.md) (its PDF reading serves the quote check below); [ARCHITECTURE.md](../ARCHITECTURE.md) (data model, agents, data flows); CLAUDE.md (where rules live, how a rule changes)

## Context

Route versions live as JSON files in the repository, so every fix is a Claude Code session, a pull request, six to ten reviewers and a deploy. On top of that, the independent check re-read every proposed version whenever its prompt changed (eight prompt versions in one week), an hourly cron re-checked them, and a daily corrector routine on claude.ai turned each "Difere" or "Confira" into another version. The check was unstable (5 of 8 production "differs" matched in CI on the same rule), and "Tudo bate" required every item matched while about 40% of items sit on pages the checker cannot read, so the loop had no fixed point. By 2026-11-15 it had spent more than US$230 of API credit plus subscription usage, the credit ran out and took the owner's other apps down with it, and some versions had been corrected about ten times with the same problems returning.

The owner asked on 2026-11-16 for something simple: gather a country's requirements per visa, have a second agent validate them, fix once, validate again, approve, use; at most two rounds; no external routine and no AI cron; everything run and configured from inside the app. He approved the plan the same day, including moving rules out of the repository ("nunca fez sentido no repositório"), and rejected spend caps: the fixed number of rounds is the bound. The first step, removing every automatic check start, shipped in [#454](https://github.com/fernandolisboa/arca/pull/454).

## Decision

### Rules live in the database

- Route versions, country sets and official-domain lists become insert-only rows in the `knowledge` schema, keyed by ID and number, each with its content, its content hash (computed in code with the existing canonical hashing, spec 0002 R6) and, for a route version, its rule cases. No role holds update or delete on them. Decisions (activate, reject) stay in `knowledge.decision`, bound to the content hash as before.
- The repository keeps the engine, the rule schema, the country dataset (CLDR and former states) and fixture routes for tests. It stops receiving route versions once the import lands.
- **Import.** A one-time, idempotent import loads every bundled version, country set and official-domain list with its existing hash and keeps its decision state (active, proposed, rejected); a hash mismatch aborts the whole import. Old evaluations keep naming the route, number and hash they used, so they stay reproducible.
- **Selection** keeps its pure functions in `packages/domain`; the API feeds them versions read from the database instead of the bundled catalog, and the client bundle no longer ships route data.

### An update request, never an automatic run

- **Update request** (UI "Pedido de atualização") replaces the correction request. An admin asks for one route ("Pedir atualização"), or for a new route of one country by naming the visa or entry type. A member may ask for the route they are looking at, with an optional note, links and a file; their request waits until an admin releases it, and only a released request starts anything. A member sees received, released, finished or declined.
- **One live request per route.** A new request for a route with one already running is refused, so two clicks never pay twice.
- **Nothing runs by itself.** No request starts on a prompt or model change, on a timer, or when a screen opens. There is no claude.ai routine, no corrector key and no AI cron.

### The pipeline, bounded at two rounds

One Vercel Workflow per request, with identifiers-only step inputs ([ADR-0009](0009-background-jobs-guarantees.md)). A pure controller in `packages/domain` picks the next stage from the stage results and enforces the bound: **research → validation → at most one correction → final validation → done**. Any failure (provider down, timeout, an answer that does not parse) ends the request with a fixed code and no proposal, and nothing retries it on its own.

- **Research.** The research model, with Anthropic's web search and web fetch server tools restricted to the route's official-domain list (for a new route, a proposed list that becomes part of the proposal), answers in the rule schema through structured output: every item with its source URL and the quoted passage, plus rule cases.
- **Checks in code, between stages.** Schema validation; every official source on the official-domain list; the existing SSRF-safe fetcher (with the PDF text layer of [ADR-0028](0028-pdf-text-in-the-independent-check.md)) reads each cited page and verifies that each quote is a verbatim substring and carries the item's value, with the existing quote and value checks; the engine runs the proposal's rule cases. An item whose quote is not on its page is marked by code, never by a model, so a fabricated quote cannot read as confirmed.
- **Validation.** A different model receives each item with its verified quote, not whole laws and not a passage locator, and answers per item only *supports*, *does not support* or *cannot tell*, with a short reason.
- **Correction.** Only the items the validator rejected or code failed, with their reasons, go back to the research model, with the same tools.
- **Final validation.** Only the corrected items.
- **The result** is a proposed version with three lists for the admin: confirmed items; divergent items with the reason; items nobody could confirm, with their official links. Items that could not be confirmed are information, never a reason for another round.

### Review, approval and editing

- The activation screen shows a request's proposal as the three lists, each item with its source and quote. The admin approves or rejects it as today: a signed-in admin's decision, bound to the content hash and stored in `knowledge.decision` ([ADR-0027](0027-admins-and-the-checked-batch-activation.md#decisions-without-a-step-up)). The spec's wording ("approve with my passkey", "the existing passkey step-up") assumed activation still asked for a passkey; it has not since ADR-0027, and the plan approved on 2026-11-16 keeps activation as it works today, so no step-up is added. A rejected proposal never blocks the route: selection falls back as today.
- **Edit item.** The admin fixes one item by hand, which writes a new proposed version that `corrects` the proposal; nothing is changed in place (domain rule 6).
- The route's history lists every version with its state, superseded and rejected ones included.

### Settings › IA

- An admin-only settings screen ("Configurações › IA") holds, per environment: the Anthropic API key, encrypted on the server with AES-256-GCM from `node:crypto` under a key-encryption key in a Sensitive Vercel variable, never returned (only "set" and its last four characters) and changed only behind a step-up; a test with one minimal call; the model and effort per stage; the source-change notice switch and its weekday; and what each request cost.
- **The key is the owner's Console API key**, so usage draws first on the monthly API credit his plan includes. The app never uses the claude.ai subscription login (OAuth).
- **Defaults** live in reviewed code and settings override them: research and correction on the strongest model at high effort; validation on a different, cheaper model at medium effort, so the validator does not repeat the author's mistake. Free-text intake and the rule summary keep their own models and take the key from settings, falling back to the environment variable while it exists.
- **Cost display.** Each stage stores its token usage; cost is computed with the existing price table and shown per request and per month. There are no caps.

### Prompt caching

One cache breakpoint per stage, after its stable prefix (instructions, then the route's current version and the verified source excerpts), with the five-minute TTL, so the second round reads the same sources from cache. What is cached is public rule data and official page text, never case data ([ADR-0004](0004-ai-providers-behind-ports.md) is amended accordingly).

### Source-change notice (optional, no model)

One daily Vercel cron that does nothing unless the switch is on and today is the chosen weekday. It fetches the official pages active versions cite with the existing fetcher, stores a hash of each page's text, and tells the admins which routes' sources changed, with a "Pedir atualização" link. It never calls a model and never starts a request.

### What goes

The corrector run, its routine, key, trigger and routes; the catalog check; the independent-check report flow and its starts; the flagged-versions route; the check's evaluation suite; country guides used only by the checker; the rule audit's monthly run; and the `ruleCheckPromptVersion` fingerprint. They are removed in one ticket ([#463](https://github.com/fernandolisboa/arca/issues/463)) once the new review screen works, so until then the old code stays as it is, with nothing starting it automatically since #454.

### Unchanged

CLAUDE.md domain rules 1, 2, 5, 6 and 7 hold: every requirement has a source; eligibility is pure functions; only a person approves; versions are immutable; the catalog is open, and adding a country or visa is a request, never a code change.

## Alternatives

| Option | Why not |
| --- | --- |
| Keep the check and corrector loop with tighter limits | Its termination depended on a model's verdict over pages it often cannot read; caps per day did not stop the same version being reworked ten times |
| Keep rules in the repository, written by the in-app pipeline through pull requests | Every fix would still need a GitHub write path from production, reviewers and a deploy, for data a person approves in the app anyway |
| Use the claude.ai subscription login from the app | Anthropic restricts that login to Claude Code and claude.ai; an API key on the owner's Console draws on the plan's API credit |
| Spend caps per request or per month | Rejected by the owner on 2026-11-16 ("sou só eu"); the two rounds bound every request |
| "Tudo bate" only when every item matches | About 40% of items rest on pages a model cannot read; requiring them blocks convergence. They become a list the admin reads |
| A model checks the quotes | Whether a quote is on its page is a string comparison; code does it exactly and for free |

## Consequences

- A rule update costs at most two rounds of model calls, and only when a person asks for it.
- Fixing a rule no longer needs a Claude Code session, a pull request or a deploy; the admin's approval in the app is the step that makes it count.
- Database tests must prove the rule tables are insert-only for every role and that the import is idempotent and refuses a hash mismatch.
- The repository is no longer the history of rule content; the database rows and their decisions are, under Neon's point-in-time restore ([ADR-0021](0021-stay-on-vercel-and-neon.md)).
- The app now holds a secret it did not hold before, the API key, encrypted at rest under a key that lives only in Vercel.
- Research reads the web from Anthropic's infrastructure through its server tools; the code checks, not the model's account of what it read, decide whether a quote stands.
- Route content changes already planned (EB-5 2027 amounts, Portugal's 2027 minimum wage, pre-2012 Polish descent) become update requests once this ships.

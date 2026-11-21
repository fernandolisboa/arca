# ADR-0034: Suggested criteria on the comparison screen, ready-made and from a model

- Status: Accepted
- Date: 2026-11-21
- Amends: [ADR-0026](0026-destination-comparison-data.md) (preferences keep turned-down suggestions; a new own criterion may start at a weight), [ADR-0004](0004-ai-providers-behind-ports.md) (a `CriterionSuggester` port)

## Context

On 2026-11-21 the owner found "Comparar destinos" hard to start: an empty "create your own criterion" field, with a city-level example, gave no idea of what to weigh. He asked for suggested criteria, each added with one tap at a suggested weight, turned down with another, and undone; and for a "suggest criteria" button backed by a model, which suggests what the list does not have yet. He chose to have both now, the model called only when someone presses the button.

## Decision

- **Ready suggestions** are a short list in the web app (`apps/web/src/compare/suggestions.ts`), each an ID with a starting weight, named in the i18n catalog. They are traits a person rates with stars, like any own criterion, never a fact the app asserts, so CLAUDE.md rule 1 does not apply to them. Turned-down names are kept up to 100; the screen drops the oldest past that, so a write never fails on them. Plus adds one as an own criterion at the weight shown (the person may change it first); minus turns it down. The screen offers to undo the last step.
- **Preferences** gain `dismissed`, the names of suggestions the person turned down, so they are not suggested again on any device, and a new own criterion in a write may carry `weight`, so adding a suggestion is one write. Stored preferences without `dismissed` read as an empty list. Turned-down names are the person's own data like the rest of their preferences.
- **Suggestions from a model:** `POST /v1/comparison/suggestions` takes an empty body. The API sends the model only the names the screen shows before any call, the comparison criteria and the ready suggestions as the pt-BR catalog words them, so nothing a person typed can reach it, whatever a client sends. The prompt asks for six other criteria with starting weights; the schema allows eight, as margin. The person's own criteria and turned-down names are case data and are never sent: the screen leaves out, locally, any suggestion named like one of them. The API leaves out any suggestion named like a sent name or carrying digits, links or markup. Nothing is stored; the reply is plain text rendered as text, each row marked "Arca", with a note that a model wrote them. Asking again adds to the earlier answers on screen.
- **Port and model:** a `CriterionSuggester` port with a Claude adapter like the summary's (no tools, structured output, fixed failure codes, a scripted adapter for the e2e build). The model is `claude-haiku-5-5` at low effort: naming a few country traits is light work, so CLAUDE.md routes it to a fast, cheap model.
- **Cost bounds:** only when a confirmed account presses the button; 3 per minute and 20 per day per account, each one or two calls. No cron, routine or page load calls it.
- **Evaluation:** `apps/api/test/eval/criterion-suggestions` runs five known-name lists, the route's own among them and two with planted instructions (one trying to close the data frame), through the route's own path. A run passes when every answer parses, gives at least three suggestions, and none repeats a known name, names a trait smaller than a country (such as a beach or a neighborhood), names a country or a visa, or carries digits, links or markup. The manual `intake-eval` workflow runs it (`only: criterion-suggestions`); a change to the prompt, model or adapter runs it and lands only if it passes.

## Consequences

- The comparison screen offers a starting point with no model call at all, and the button adds variety at a cost of a fraction of a cent per press.
- A model suggestion can still be a poor criterion. It is only a name the person may add and rate; nothing is scored from it until they give stars.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Send the person's own criteria too, so the model avoids them | Own criteria are case data that never reach a model; filtering them on the client does the same job |
| Let the client send the names to avoid | A client could then send any text, own criteria included; the API building the list from its catalog keeps that promise in one place |
| Store the model's suggestions | Nothing needs them after the screen closes; asking again is cheap and limited |
| A strong model | The task is naming traits, not judgment about rules or people |

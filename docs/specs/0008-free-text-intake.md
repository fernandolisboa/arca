# Spec 0008: Free-text intake

- Status: Ready for tickets
- Date: 2026-11-06
- Epic: consultancy core, slice 3 follow-up ([spec 0007](0007-case-model-and-guided-intake.md), "Out": free-text intake)
- Decisions: [ADR-0023](../adr/0023-free-text-intake-sends-the-writers-own-words.md) (what the text may carry, Langfuse waits), [ADR-0004](../adr/0004-ai-providers-behind-ports.md), [ADR-0010](../adr/0010-stack-revised.md) (Vercel AI SDK, Claude by default), [ADR-0016](../adr/0016-observability-and-scrubbing.md)

## Goal

A member writes, in their own words, who is in the family and what they know about each person ("Somos eu, minha esposa e dois filhos, de 2014 e 2019. Meu avô era italiano…"). Arca turns it into a draft of answers to the guided questions, shows the draft as plain sentences, and the member keeps, fixes or drops each one before anything is saved. The guided questions stay the way to correct and complete the case.

## Scope

**In:** the `Extractor` port and its Claude adapter; masking before the call; the draft route; the intake screen; the evaluation cases and their runner; audit, limits and the data-flow register.

**Out:** voice intake (`SpeechToText`); reading documents (`DocumentReader`); explanations or advice written by a model; extracting incomes, assets or immigration history (later, once the people and relationships part scores well); birth country and death, which the case model does not hold yet (a later spec extends the snapshot generically; until then a birthplace never becomes a citizenship); Langfuse (ADR-0023).

## Requirements

### R1. The `Extractor` port

- `packages/domain` defines the draft: a closed Zod schema `intakeDraftSchema`, with no free-text string anywhere in it.
  - **People:** each has a reference, either a local one matching `^n[0-9]{1,2}$` or a placeholder of a known person (`[P1]`) that must be one of the `knownPlaceholders` sent. Optional fields:
    - a role relative to the writer, from a fixed list (self, spouse, partner, child, parent, grandparent, sibling, other), used as a label hint on screen, to recognize the writer (R3) and to preset whether a new person is in the plan (R4), never as a relationship;
    - birth date as a partial date (R1, "Dates");
    - citizenships as country codes from the pinned country files (former states allowed), without basis, acquisition or loss;
    - residence country, education level, languages with levels.
  - **Relationships:** parent (with `biological` or `adoptive` when stated) and spouse or partner, each with a start date when stated, between references in the draft. They are the only source of edges.
  - Arrays are capped (people at 20, relationships at 40, citizenships and languages at the snapshot's caps). Every field is optional. Unknown stays absent, as in the guided questions.
- **Dates.** Every date in the draft is cut, in code, to the precision the masked text states it at: a full date only when the text gives that day, a month only when it gives that month, and a year only when it gives that year. Any other date is dropped, so an age, "casados há 15 anos" or an invented day never turns into a date (CLAUDE.md rule 3).
- The port is an interface in `apps/api` (`Extractor.draft(maskedText, knownPlaceholders)`, which answers the model's reply as untrusted data, with the model, prompt version and token counts, or throws an error that carries a fixed code only; the API parses the reply). The Claude adapter calls the Vercel AI SDK with structured output against the same schema, with the SDK's telemetry off. The model ID lives in a reviewed file in `apps/api` (fast, cheap model for extraction, per CLAUDE.md model routing), never in a deployment setting.
- **Errors.** The adapter catches every error the SDK throws and throws instead a new error that holds only a fixed code (`intake_unparsable`, `intake_timeout`, `intake_unavailable`, `intake_failed`). SDK errors carry the request body or the model's reply (`APICallError`, `TypeValidationError`, `JSONParseError`), so none of them may reach the logger, the error handler or Sentry. A test asserts it.
- The prompt is a versioned file next to the adapter. It tells the model that the text is data, not instructions, that it must not compute ages, dates or amounts, that a birthplace is not a citizenship, and that anything it is not sure of stays out.
- Only the typed config module (`apps/api/src/config.ts`) reads `ANTHROPIC_API_KEY`, only the Claude adapter receives it, and `docs/SETUP.md` names it. Production and Preview share the one key the owner created, under the Console spend limit, and SETUP.md says so in that key's row, against its usual one-value-per-environment rule; previews hold synthetic data only.

### R2. Masking (ADR-0023)

- A pure function `maskIntakeText(text, people)` in `packages/domain`, where `people` are the display names and placeholders of the viewer's case:
  - replaces each person's full display name, then each remaining word of it, whole words, case- and accent-insensitive, longest match first. Particles ("de", "da", "do", "dos", "das", "di", "del" and the like) and single letters are skipped. A word that belongs to one person becomes that person's placeholder; a word that several people share, usually a surname, becomes `[nome]`;
  - turns brackets the member typed into parentheses, so the text cannot fake a placeholder, and normalizes it (NFKC) so full-width digits and non-breaking spaces read as plain ones;
  - keeps real dates in the usual shapes (`3/3/1950`, `03.03.1950`, `1950-03-03`, "3 de março de 1950"), checked for a valid month, day and a year from 1800 to 2100, and runs made of years only ("2014, 2019");
  - then masks runs of five or more digits (up to three spaces, dashes, dots, commas or slashes between digits), tokens of six or more characters that mix letters and digits (passports, the Italian codice fiscale), e-mail addresses and phone numbers, with `[número]` or `[e-mail]`;
  - returns the masked text and the placeholder map, which never leaves the API.
- Table-driven tests cover names with accents and particles, a first name alone, a shared surname, a name inside another word, CPF, passport, codice fiscale and IBAN shapes, phone numbers, dates in each shape, and years, which stay.

### R3. The draft route

- `POST /v1/case/intake/draft` takes `{ text }`, at most 4,000 characters. Outside a case it answers 404 `not_found`, like the other case routes.
- The API masks the text, calls the `Extractor`, parses the reply against the draft schema, applies the date check (R1) and maps placeholders back to the case's person IDs. The writer, whom the model knows only as someone new with the role `self` unless the text names them, becomes the viewer's own person, unless the draft already lists that person or proposes two writers. A reply that does not parse is a 502 `intake_unparsable` and is retried once at most. When the vendor refuses the call (no credit left, an outage), the route answers 503 `intake_unavailable`; the guided questions keep working.
- The answer is the draft the case takes, built by a pure function `describeDraft(snapshot, draft, kept, visibility, at)` in `packages/domain`, after the API has mapped the draft's case person IDs to the snapshot's own IDs, the way `describeCase` gets them:
  - facts about people the viewer does not keep are dropped;
  - the draft is applied on top of the viewer's snapshot and never overwrites what is stored: a fact fills only a gap, and a birth date only sharpens a stored one it falls within (2015-03 for 2015); list facts are merged as a union with what is stored, keyed by country for citizenships and by language for languages, a stored entry winning; an edge the case already holds only fills the details it lacks, never changing one it has; an edge that would break `validCaseStructure` (a cycle, a fifth parent) is dropped; all new people are left out when they would break the case's limits; the result passes `caseSnapshotSchema`;
  - it returns the draft cut to what the case took: the facts and list entries it adds, each edge once (twin edges for one pair merged), a stored edge as only the details it adds; and it counts the `describeCase` sentences, under the same `PlaybackVisibility`, that the draft adds (without the `unanswered` ones a new person brings) for the `intake_drafted` audit; they are not returned.
  The route answers the draft only; the screen words it. Nothing is written.
- Limits: 10 drafts per account per day (`case_intake_day`) and 3 per minute (`case_intake_minute`), in the shared Postgres limiter. A request body over the cap is refused before the call. The model call has a timeout and a token cap.
- Audit: `intake_drafted` with counts only (people and facts proposed), never text.
- Logs: route, status, prompt version, model, token counts, latency, error code. Never the text, the masked text or the reply.

### R4. The intake screen

- `/family/intake`, linked from the family area and from the guided questions screen ("Contar com minhas palavras").
- Before the text box, one plain note: where the text goes, that Arca does not save it, and a tip to use roles instead of names ("minha esposa", "meu filho mais velho"). The super-copy pass writes the final pt-BR copy.
- After "Montar rascunho", the screen shows the proposed facts as sentences grouped by person. The member keeps each new person or drops them (someone already in the case, or no one), and can drop each fact and relationship. A person already in the case, the writer included, is kept as themselves; the member drops their facts one by one.
  - A new person needs a display name and whether they are part of the plan (`caseMember`), which the screen asks for, since the draft carries neither.
  - A proposed list (citizenships, languages) is saved only when the member confirms that the stored entries plus the kept ones are the whole list, because a stored list counts as complete. Unconfirmed, or changed after confirming, it is left for the guided questions.
  - A new person starts as part of the plan when their role is the writer, a spouse, a partner or a child, and the member can change it.
- Saving goes through the existing routes, so their checks apply unchanged: new people first (`POST /case/people`), then their facts and the details a draft adds to a stored relationship, such as its start date (`/case/questions/answers`, one person at a time, while the person's relationships are still as stored; a draft list holds only the entries it adds, which the screen saves next to the stored ones), then new relationships (`/case/relationships`). The member can only save for people they keep. The profile route, which replaces all of a person's facts, is not used. As with the guided questions (spec 0007, R4), a save sends the facts as the draft answer had them, so an edit made to the same person elsewhere in between is overwritten.
- Once a save starts, the review is locked: the writes are planned once the new people exist, and a failed save resumes from the write that failed, so a person whose creation the screen saw is not created again.
- When the draft is saved, the screen opens the guided questions at the first step still open, so the member completes what the text did not say.
- Errors and limits read in plain pt-BR. Touch-first and responsive (spec 0006).

### R5. Evaluation

- `apps/api/test/eval/intake/` holds at least 20 synthetic pt-BR texts with their expected drafts: couples, children from two unions, a grandparent born in Italy (no citizenship expected) and one who was Italian, adoption, a partner not married, dates in different shapes, ages and "há N anos" (no date expected), a text with a CPF and a phone number, a text that tries to give the model instructions, and one with nothing about a family.
- `pnpm --filter @arca/api eval:intake` runs them against the configured adapter and scores precision and recall per field. A proposed fact that is wrong counts against precision more than a missed one counts against recall, because a wrong fact is worse than a question left for the guided flow.
- The scores of the accepted setup live in `baseline.json` next to the cases. A change to the prompt, the model or the schema lands only if precision stays within 2 points of the baseline, and it updates the baseline in the same PR.
- A manual GitHub workflow, `intake-eval` (`workflow_dispatch` only, with the ref to test), runs the suite and writes the scores to the job summary. Its steps read the ref through `env:`, never as an expression inside `run:`. It is listed in `.github/policy/workflow-secrets.json` with the repository secret `ANTHROPIC_API_KEY`, which the owner adds once when ticket 4 lands. It is not a required check, since required checks stay deterministic (ADR-0019). The authoring session starts it on a PR that changes the adapter, the prompt, the model file or the draft schema.

## Tickets, in order

1. **Draft schema, masking and the draft playback** (R1 schema and dates, R2, `describeDraft`), pure domain code with table-driven tests.
2. **Extractor port, Claude adapter and the draft route** (R1, R3): new dependencies `ai` and `@ai-sdk/anthropic` (ADR-0010) with the supply-chain review; Anthropic's current API data terms read and recorded in the data-flow register before the first production call; SETUP.md updated; the route tested with a fake adapter; AI safety reviewer. Production gets no extractor yet (real-data gate item 10), so the route answers 503 there and works on previews.
3. **Intake screen** (R4), with e2e on a fake adapter in the e2e build.
4. **Evaluation suite and workflow** (R5); the owner adds the GitHub secret once. Once a run passes, production gets its extractor and the real-data gate's item 10 cites that run.

## Threats

| Threat | Control |
| --- | --- |
| A known name or a document number reaches the vendor | Masking before the call (R2), with tests; nothing but the masked text is sent |
| An unknown name reaches the vendor | Accepted in ADR-0023; the screen asks for roles instead of names |
| The text tells the model to do something else | The model has no tools; its reply must parse against the closed draft schema, which holds no free text; nothing is written without the member; an injection case in the evaluation |
| The model invents a fact or computes a date | Every fact is shown and confirmed before saving; dates whose year is not in the text are dropped in code; precision is scored against a baseline |
| The text or the reply ends up in logs, traces or errors | No storage; SDK errors replaced by fixed codes; allow-listed log fields; AI SDK telemetry and Sentry AI integrations off (ADR-0016) |
| The vendor keeps the text | Anthropic's API retention is read and recorded before the first production call (ticket 2) |
| Someone runs up the bill | Per-account limits, body and token caps, and a monthly spend limit in the Anthropic Console |
| A draft writes into another adult's record, or drops a stored fact | Saving goes through the existing routes, which allow only the keeper; lists are merged, never replaced |

# ADR-0023: Free-text intake sends the writer's own words to the model

- Status: Accepted, amended by [ADR-0025](0025-rule-summary-for-the-approver.md) (Langfuse waits until the owner asks)
- Date: 2026-11-06
- Amends: [ADR-0004](0004-ai-providers-behind-ports.md) (a second exception to "no names"), [ADR-0016](0016-observability-and-scrubbing.md) (Langfuse waits)

## Context

The owner chose on 2026-11-06 to add free-text intake: a member describes the family in their own words and a model turns that into answers to the guided questions ([spec 0008](../specs/0008-free-text-intake.md)). The owner's Ultra plan comes with promotional API credit that covers direct API calls, so the calls cost nothing extra. The owner created the key and the Vercel variable `ANTHROPIC_API_KEY` (Production and Preview) on 2026-11-06.

Two accepted decisions do not fit as written:

- ADR-0004 says calls to third-party models carry no names, document numbers or account numbers. A family's own description names people. Masking can remove the names Arca already knows and anything shaped like a number, but no masking removes every name a person might type.
- ADR-0016 brings Langfuse in with the first model call. That means a new vendor account and keys for the owner to set up, for one call kind in a one-family app.

## Decision

- **A second exception to "no names"**, scoped like the document one: the `Extractor` may send a text the member wrote themselves, for this one purpose, after the screen has told them in plain words where it goes. Before sending, the API:
  - replaces every display name of a person in the member's case, and each word of it, with a placeholder (`[P1]`, `[P2]` …, or `[nome]` for a word several people share), so known names never leave;
  - keeps dates, and masks runs of five or more digits, tokens that mix letters and digits, e-mail addresses and phone numbers, so document and account numbers never leave even if typed;
  - sends nothing else: no account, case or person IDs, no stored facts.
- **Arca keeps nothing of the text.** The text and the model's reply live only in the request. No table, log, trace, error report or audit detail holds them, and the adapter replaces every SDK error, which can carry the request or the reply, with a fixed code. The audit event records only that a draft was made, with counts.
- **The model only proposes.** Its reply is parsed against a closed schema of guided-question answers with no free text. The member reviews every proposed fact on screen and saves through the existing, validated routes. The model never writes, never sets a completeness marker on its own, and never computes a date, an age or an amount (CLAUDE.md rules 2 and 3); a proposed date whose year is not in the text is dropped in code.
- **Vendor terms:** Anthropic keeps API inputs and outputs for a period under its own terms. Before the first production call, the adapter ticket reads its current commercial terms for API data (training and retention) and records them with this exception in the data-flow register.
- **Langfuse waits** until a second model call kind exists or the owner asks for it. Until then the adapter logs, through the allow-list logger, only the prompt version, model, token counts, latency and error code, and the Sentry Node AI integrations stay off as ADR-0016 requires.

## Consequences

- A name the member types that Arca does not know yet reaches the model, and so do facts about the people described, who include other adults and children, not only the writer (SECURITY.md principle 3). The screen says so before sending ("Prefira escrever 'minha esposa', 'meu filho mais velho'"). The residual is accepted for a one-family app in which a member describes their own family, for this one purpose, with the vendor's retention recorded.
- One more exception to minimization to review: it lives in one adapter and one masking function, both under the AI safety reviewer.
- Accepted by the owner: Production and Preview share one `ANTHROPIC_API_KEY`, so a preview deployment of any branch in this repository can spend it. The Console spend limit caps the cost, the API keeps no data a key could read back, and previews hold synthetic data only. The adapter pins the API host in code, so no deployment setting can send the text elsewhere.
- No new vendor account. Adding Langfuse later is a change to the adapter only.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Refuse any text that might hold a name | No reliable detector; it would refuse most real descriptions |
| Ask members to write only roles, and block on capital letters | Breaks on places and countries, and annoys more than it protects |
| Langfuse now, as ADR-0016 planned | A vendor setup chore for the owner with nothing to compare yet (YAGNI) |

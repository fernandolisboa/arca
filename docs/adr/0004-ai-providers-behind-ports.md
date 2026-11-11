# ADR-0004: AI providers behind ports, chosen by evaluation

- Status: Accepted, amended by [ADR-0023](0023-free-text-intake-sends-the-writers-own-words.md) (names in the writer's own words) and [ADR-0025](0025-rule-summary-for-the-approver.md) (the `Summarizer` port), and [ADR-0027](0027-admins-and-the-checked-batch-activation.md) (the `RuleChecker` port and, by its amendment of 2026-11-09, the `PassageLocator` port), and in place on 2026-11-11 (prompt caching)
- Date: 2026-11-01

## Context

Arca uses several kinds of AI (see [ARCHITECTURE.md](../ARCHITECTURE.md#ai-stack)): conversational LLMs, structured extraction, retrieval with citations, a decision model for classification and routing, vision/OCR and speech. Providers and models change quickly. One candidate, TypeSafe AI's Jev, is a decision-only model that returns typed answers with calibrated probabilities instead of text; it was announced in September 2026 and its published accuracy is still vendor-reported (see [research/ai-vendors.md](../research/ai-vendors.md)).

## Decision

- Each AI capability is an interface (port): `Classifier`, `Extractor`, `Writer`, `Summarizer` (added by [ADR-0025](0025-rule-summary-for-the-approver.md)), `RuleChecker` and `PassageLocator` (added by [ADR-0027](0027-admins-and-the-checked-batch-activation.md)), `Retriever`, `Embedder`, `DocumentReader`, `SpeechToText`, `TextToSpeech`.
- Embeddings are computed only for the public knowledge base. Case data is queried structurally, never embedded.
- Adapters implement those ports for specific providers (for example, a Claude adapter and a Jev adapter for `Classifier`).
- Which adapter runs is configuration. Switching requires a run of the synthetic evaluation suite showing equal or better quality for that capability.
- Calls to third-party models send only the fields the call needs. No names, document numbers or account numbers. (Amended by [ADR-0023](0023-free-text-intake-sends-the-writers-own-words.md): free-text intake sends the member's own description with known names and number-shaped text masked.)
- **Document-processing exception.** Reading a document (OCR, review) necessarily sends its content, names and numbers included. This happens only when the document's owner authorizes it for that document, only through the `DocumentReader` and `SpeechToText` ports, preferring vendor terms that exclude training and retention, and the vendor is listed in the data-flow register. Extracted results are stored encrypted like the document; the path and what may leave the vault are fixed in [ADR-0018](0018-vault-encryption.md).
- Model output that is rendered to users has remote images stripped and links marked, so injected instructions cannot exfiltrate data through URLs.
- Classifier results carry a probability. Below a configured confidence threshold, the app asks the person instead of acting.
- **Prompt caching (added 2026-11-11).** A call's instructions are its cached prefix: they go first, hold nothing that changes between two calls of one kind (no date, no identifier, no per-case text), and carry the request's one cache breakpoint, with the vendor's one-hour lifetime, since a person reviewing rules calls minutes apart. The vendor's terms ([prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), read 2026-11-11): an entry lasts an hour from its last use; writing it costs twice the input price and reading it a twentieth (Claude Sonnet 5.5) or a tenth (Claude Haiku 5.5); a prefix under 512 tokens on those two models is sent uncached, with no error. Everything that differs from call to call (a rule version, page text, a member's description) comes after the breakpoint and is never cached, so the cache holds only Arca's own instructions. The shared Claude call shape (`apps/api/src/ai/claude.ts`) sets this for every adapter. A model call's log line carries how many input tokens were read from and written to the cache, and each evaluation report prints the share read, which is how a prefix that stopped matching gets noticed: it fails silently and only costs more. Measured on the evaluation suite at the change (pull request #389, recorded in the real-data gate), every call kind reads from the cache: 98.1% of the intake's input tokens, about 52.5% of the check's, 14.9% of the passage locator's and 11.0% of the summary's, the share falling where a call's own data dwarfs the instructions; before, none was read. Real traffic is sparser than an evaluation run, so its share is lower. What was weighed and left out: a second breakpoint after the message (each call's data is new, so it would pay the write premium and never be read), and moving a check's pages or country guide ahead of the version so repeated checks share more (it changes the prompt, which resets every stored check report, for cents).

## Consequences

- A cheaper or faster model can be adopted without touching domain code.
- Every capability needs evaluation cases before it can change providers.
- Data minimization lives in the adapters, where it can be reviewed in one place.

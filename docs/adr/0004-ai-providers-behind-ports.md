# ADR-0004: AI providers behind ports, chosen by evaluation

- Status: Accepted, amended by [ADR-0023](0023-free-text-intake-sends-the-writers-own-words.md) (names in the writer's own words) and [ADR-0025](0025-rule-summary-for-the-approver.md) (the `Summarizer` port)
- Date: 2026-11-01

## Context

Arca uses several kinds of AI (see [ARCHITECTURE.md](../ARCHITECTURE.md#ai-stack)): conversational LLMs, structured extraction, retrieval with citations, a decision model for classification and routing, vision/OCR and speech. Providers and models change quickly. One candidate, TypeSafe AI's Jev, is a decision-only model that returns typed answers with calibrated probabilities instead of text; it was announced in September 2026 and its published accuracy is still vendor-reported (see [research/ai-vendors.md](../research/ai-vendors.md)).

## Decision

- Each AI capability is an interface (port): `Classifier`, `Extractor`, `Writer`, `Summarizer` (added by [ADR-0025](0025-rule-summary-for-the-approver.md)), `Retriever`, `Embedder`, `DocumentReader`, `SpeechToText`, `TextToSpeech`.
- Embeddings are computed only for the public knowledge base. Case data is queried structurally, never embedded.
- Adapters implement those ports for specific providers (for example, a Claude adapter and a Jev adapter for `Classifier`).
- Which adapter runs is configuration. Switching requires a run of the synthetic evaluation suite showing equal or better quality for that capability.
- Calls to third-party models send only the fields the call needs. No names, document numbers or account numbers. (Amended by [ADR-0023](0023-free-text-intake-sends-the-writers-own-words.md): free-text intake sends the member's own description with known names and number-shaped text masked.)
- **Document-processing exception.** Reading a document (OCR, review) necessarily sends its content, names and numbers included. This happens only when the document's owner authorizes it for that document, only through the `DocumentReader` and `SpeechToText` ports, preferring vendor terms that exclude training and retention, and the vendor is listed in the data-flow register. Extracted results are stored encrypted like the document; the path and what may leave the vault are fixed in [ADR-0018](0018-vault-encryption.md).
- Model output that is rendered to users has remote images stripped and links marked, so injected instructions cannot exfiltrate data through URLs.
- Classifier results carry a probability. Below a configured confidence threshold, the app asks the person instead of acting.

## Consequences

- A cheaper or faster model can be adopted without touching domain code.
- Every capability needs evaluation cases before it can change providers.
- Data minimization lives in the adapters, where it can be reviewed in one place.

# AI vendors under evaluation

Checked 2026-11-01.

## TypeSafe AI — Jev

| Fact | Source |
| --- | --- |
| Decision-only "System One" model: answers typed questions (choice, score, yes/no) with probabilities instead of generating text | [InfoQ](https://infoq.com/news/2026/10/typesafe-ai-jev-released), [Micdrop](https://micdrop.dev/docs/ai-integration/provided-integrations/typesafe) |
| Announced 2026-09-15 | [innFactory](https://innfactory.ai/en/blog/jev-system-one-model-classifier-not-llm/) |
| Vendor evaluations: 68% average accuracy across four decision workflows, at USD 0.0004 and 0.4 s per case; not yet independently reproduced | [Arize](https://arize.com/?p=32075) |
| Documented weaknesses: counting, arithmetic, date comparison, and accuracy loss on large noisy state; keep math in code | [InfoQ](https://infoq.com/news/2026/10/typesafe-ai-jev-released) |
| Counting, extracting values and writing text stay with an LLM | [Micdrop](https://micdrop.dev/docs/ai-integration/provided-integrations/typesafe) |
| TypeSafe receives the submitted state; remove secrets and sensitive data before calling | [LangChain docs](https://docs.langchain.com/oss/javascript/integrations/providers/typesafe) |
| Integrations exist for LangChain (JS) and DeepEval | [LangChain docs](https://docs.langchain.com/oss/javascript/integrations/providers/typesafe), [DeepEval](https://deepeval.com/integrations/models/typesafe-ai) |

Intended use in Arca: execution-mode routing, complication triage, message intent, document type, and cheap judge in the evaluation suite. Adopt only through the `Classifier` port and after it matches or beats the alternative on the evaluation suite ([ADR-0004](../adr/0004-ai-providers-behind-ports.md)).

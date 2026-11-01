# Arca

Arca is an immigration consultancy in an app. A person describes their family and what they hope for in their own words; Arca turns that into a structured case and does what an immigration firm would do for it: diagnosis, destination comparison, route recommendation with pros and cons, a personalized document checklist, a step-by-step plan, document review, form drafts, interview practice and arrival setup.

The name comes from the Portuguese *arca*: both an ark (it carries the whole family) and a strongbox (it carries the family's assets).

## Status

Pre-code. Product, architecture, platform strategy and stack are decided ([docs/adr/](docs/adr/)). Next: scaffold the monorepo ([spec](docs/specs/0001-foundations-scaffold.md)).

Platforms, in order: web (installable PWA), Android, iOS and iPadOS, then desktop if its gate passes ([ADR-0005](docs/adr/0005-platform-strategy.md)).

The first case is the founder's own family. The app goes to other families only after it works for them.

## Documentation map

| Document | What it covers |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | Rules for coding agents working in this repo |
| [docs/PRODUCT.md](docs/PRODUCT.md) | Vision, principles, how a case is understood, services, execution modes |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, code layout, data model, AI stack, agents, quality, data flows |
| [docs/SECURITY.md](docs/SECURITY.md) | Security pillar: principles, standards, threat model, required controls |
| [SECURITY.md](SECURITY.md) | How to report a vulnerability |
| [docs/REVIEW.md](docs/REVIEW.md) | Reviewer gates and the specialist reviewers in `.claude/agents/` |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases and the gates between them |
| [docs/GLOSSARY.md](docs/GLOSSARY.md) | Domain terms and their pt-BR UI equivalents |
| [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) | Decisions still pending |
| [docs/adr/](docs/adr/) | Architecture decision records: language, rules as data, stack, AI ports, platforms, auth, background jobs, database security, reviewers in CI, automation-first setup |
| [docs/specs/](docs/specs/) | Feature specs, written before tickets and code |
| [docs/research/](docs/research/) | Sourced research notes that seed the knowledge base |

## Language

Code, docs, commits, issues and agent reasoning are in English. The user interface ships in Brazilian Portuguese first, through i18n. See [ADR-0001](docs/adr/0001-english-for-code-and-docs.md).

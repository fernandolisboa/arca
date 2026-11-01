# ADR-0001: English for code and docs, pt-BR for the interface

- Status: Accepted
- Date: 2026-11-01

## Context

The founder and the first users are Brazilian, and the planning so far happened in Portuguese. Most of the code will be written by AI coding agents. The product may later serve families from other countries.

## Decision

- Code, identifiers, comments, docs, commit messages, PRs, issues and agent reasoning are written in English.
- Every user-facing string goes through i18n. `pt-BR` is the first locale.
- Domain terms have one English name and one pt-BR label each, recorded in [GLOSSARY.md](../GLOSSARY.md).

## Consequences

- Agents work in the language they are strongest in, and the codebase stays readable to any contributor.
- Portuguese quality becomes a deliberate step: translations are reviewed as product copy, not produced as a side effect.
- Adding a locale later is a translation task, not a refactor.
- The glossary must be kept current; a term used in code without a glossary entry is a review finding.

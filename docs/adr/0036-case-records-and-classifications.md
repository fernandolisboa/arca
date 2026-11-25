# ADR-0036: Work, studies, registrations and residence as record collections, coded by ISCO-08 and ISCED-F 2013

- Status: Accepted
- Date: 2026-11-25
- Amends: [ADR-0031](0031-rule-updates-on-request.md) (the repository keeps the classification datasets beside the country dataset, bundled into the API like it), [spec 0002](../specs/0002-rules-engine-and-knowledge-base.md) (route versions may pin two classification files, R4 and R7; R3's fact catalog gains record collections with #509 and the tickets after it), [spec 0007](../specs/0007-case-model-and-guided-intake.md) (the case snapshot gains person records, amended with #509 and the tickets after it)

## Context

The work, business and talent routes the owner wants next (spec [#507](https://github.com/fernandolisboa/arca/issues/507): EB-2 NIW, L-1A and EB-1C, a U.S. employer-sponsored route, Spain's international telework visa, Portugal's D2 and D3, Estonia's and Latvia's remote-work visas) turn on what a person does for a living, what they studied, where they may practise and how long they have lived legally in a country. The case holds none of it, so those routes read "needs assessment" for everyone, and a rule that names an occupation or a field could cite a code that does not exist.

## Decision

- **Record collections.** A person gains optional lists of work periods, qualifications, professional registrations and residence periods; job offers gain an occupation, an annual salary and sponsorship; business assets gain a country, an operating start and a head count. An absent list is unknown and `[]` is none, as for every list. Rules read them as collections with item-scoped facts through the existing `some`, `every`, `count` and `sum`, plus one generic addition for time inside a trailing window, decided test-first with work periods (#509).
- **Two classifications, pinned like the countries file.** Occupations are ISCO-08 unit groups (ILO, 436 codes) in `packages/knowledge/data/occupations/<n>.json`; fields of study are the four-digit ISCED-F 2013 fields (UNESCO, as Eurostat's code list `ISCEDF13` publishes them, 148 codes with the "not further defined", "not elsewhere classified" and inter-disciplinary codes) in `data/study-fields/<n>.json`. Each file lists its codes, in ascending order, and its official source, read on `verifiedAt`; a test checks the counts and the codes against that list. Like the countries file, a classification file comes in through a reviewed pull request, so its source is checked by the reviewer rather than against an official-domain list. A route version that reads a code pins the file in `occupations` or `studyFields`, its hash covers it, and validation refuses a code the pinned file lacks or a code read with no pin. The education level answer stays ISCED 2011.
- **Labels in the catalog.** Every code, and every top-level group the picker shows codes under, has a natural Brazilian Portuguese label in the i18n catalog (`occupations`, `occupationGroups`, `studyFields`, `studyFieldGroups`), written for this app with IBGE's adaptation of ISCO-08 in mind and never copied from Portugal's CPP/2010. A test fails on a code with no label. The person picks a code in `SearchPicker` (`packages/ui`), a search that ignores accents and case.
- **The privacy line.** The snapshot holds codes, dates, money, booleans and opaque IDs only: no employer names and no free text. A display label a person gives a work period stays with the profile, under the profile share, and never enters the snapshot or a model call. Free-text intake does not extract these records.

## Consequences

- A rule names an occupation as `"2211"`, never as text, so the rule is checked against an official list and the screen names the code in the reader's language.
- A new edition of either classification is a new numbered file, its own test expectations and labels for any new code; versions already pinned keep their file.
- Self-reported capacity and employer relation can rule a route out but never alone make someone eligible where the law asks for evidence: routes keep that judgement as an assessment.

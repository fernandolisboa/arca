# ADR-0040: Professional recognition tracks, from reviewed official sources in the repository

- Status: Accepted
- Date: 2026-11-25

## Context

On 2026-11-25 the owner approved the family-fit priorities, whose fourth item is the professional recognition of a doctor's Brazilian degree in the destinations the family leans towards: Spain (homologación and the MIR), Portugal (the specific recognition by a Portuguese medical school and the Ordem dos Médicos) and the United States (USMLE, the ECFMG certificate, residency and a state licence). Portugal's exam, sometimes called the PAP, is the specific recognition exam the Portuguese medical schools run (Despacho n.º 6015/2026). Whether someone may practise their profession is not a visa route's eligibility, and no rule decides it; but CLAUDE.md rule 1 still holds: every deadline, threshold or exam rule shown comes with its official source and the date it was read. The case already records occupations (ISCO-08) in work periods, job offers and professional registrations, and fields of study (ISCED-F) in qualifications ([ADR-0036](0036-case-records-and-classifications.md)). No model call is wanted.

## Decision

- **A reviewed data file, as ADR-0038.** `packages/knowledge/recognition-tracks/<n>.json` holds tracks, one per regulated profession, each naming the ISCO-08 occupations and ISCED-F fields of study that lead to it and, per destination country, its ordered steps; each step cites sources from the file's list, each with its address, title and verification date. The build validates the highest-numbered file against `recognitionTracksSchema`, refuses a verification date after the day it runs, and ships it in the API's runtime module; a test holds every code to the classifications. The file reads the current occupation and field-of-study files rather than pinning their numbers ([ADR-0036](0036-case-records-and-classifications.md)), so a new edition that drops a code fails that test and calls for a new tracks file. A new file is a reviewed pull request and nothing else: no activation, no update request, no model. Professions and countries are data; nothing in code names one.
- **Official sources only, on the file's own domains.** The schema and its shared checks are ADR-0038's: `https`, marked official, on one of the domains the file lists, each cited and each citation listed. Where an official page refused automated reading (the ECFMG's), the file cites only what other official pages say about it and the wording points to the body's own site for the rest.
- **Wording in the catalog, pinned by a hash.** Track and step IDs are data, step IDs unique across the file; their texts live in `pt-BR-recognition.ts` under `recognition.track.<id>` and `recognition.item.<id>`, and the file pins a SHA-256 of them (`wordingSha256`), so changing a text changes the dated file and calls the same reviewers. An API test fails on a hash mismatch, a missing or extra text, or a link in the wording.
- **Whom it concerns, from the case.** `GET /v1/recognition-tracks` answers the tracks to any signed-in account and, for a confirmed account in a case, which people each track concerns: someone with a work period, job offer or professional registration in one of its occupations, or a qualification in one of its fields of study, read from what the viewer sees, so a hidden fact names nobody. Reading the case counts 120 per hour per session (`case_recognition_session`), as the other reads that build a snapshot do; the public tracks need no count. Only person IDs leave, never the facts that matched, and the API puts the tracks that concern someone first; the screen puts names to them from the case it already reads. "Revalidação profissional" lists the tracks in that order and shows each destination's steps side by side on a wide screen.

## Consequences

- The family sees, for each destination, the order of the steps, the exams and deadlines, and which person they apply to, with the official page behind each step, at no model cost.
- The sources were read on 2026-11-25. The Spanish MIR figures are the 2027 call's and the Portuguese exam rules are the NOVA Medical School regulation, which says itself that the Portuguese medical schools harmonised it; a new call or regulation is a new numbered file.
- Portugal's exceptional recognition for doctors hired by the SNS ends on 31 December 2026 ([Decreto-Lei 86/2023](https://diariodarepublica.pt/dr/detalhe/decreto-lei/86-2023-222583132), read on 2026-11-25), so the file leaves it out.
- A merged file changes what every account sees with no activation; the reviewers and the domain check are the gate, as for ADR-0038. It never decides eligibility.
- The read of the case costs one transaction per page load, under the same identity and row-level access as every case read, and within the session's hourly count.
- Marking steps done per person, and other professions, are later data or features.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Model recognition as route versions | It is not a migration route and has no eligibility the engine should decide; activation would add process for no gain |
| Show every track to everyone, with no reading of the case | The owner asked to use the new case facts; naming who a track is for puts the relevant one first |
| Match people in the browser from the questions it already loads | Business logic stays behind the API (CLAUDE.md, Platforms) |

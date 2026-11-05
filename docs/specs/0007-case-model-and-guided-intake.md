# Spec 0007: Case model, guided intake and rule activation

- Status: Ready for tickets
- Date: 2026-11-05
- Epic: consultancy core, slice 3 ([spec 0002](0002-rules-engine-and-knowledge-base.md#the-epic-consultancy-core)); the family area of epic [#117](https://github.com/fernandolisboa/arca/issues/117)
- Decisions: [ADR-0022](../adr/0022-single-approver-activation.md) (how a version becomes active), [ADR-0014](../adr/0014-knowledge-base-as-reviewed-data.md), [ADR-0008](../adr/0008-database-security-and-environments.md), [ADR-0015](../adr/0015-identity-enrollment-step-up-and-recovery.md), [ADR-0017](../adr/0017-data-lifecycle-and-backups.md)

## Goal

The family enters its case by answering guided questions, sees it played back in plain sentences, and gets each route's result for each person: who qualifies, who goes with whom, what is missing and which questions would change the answer. The owner activates or rejects the route versions those results use, with a passkey.

## Scope

**In:** case tables under forced row-level security; people, relationships, assets and who may see what; the family area (#118); guided questions per person; playback; evaluations and decisive questions; activating and rejecting route versions (ADR-0022); reporting a wrong rule; audit events, export, erasure and retention for all of it.

**Out, each a later step:**

- Free-text intake through the `Extractor` port, which needs an Anthropic API budget. The owner chose on 2026-11-05 to build guided questions first and free text after them. The guided questions stay as the way to correct what the model extracts.
- Uploading documents for another person (#119), which needs an ADR-0018 amendment.
- Aspirations, destination choice, comparison and shared analyses (slice 4, #120); checklists, plans and progress (slice 5, #121, #122); the guided tour (#123).
- The independent check agent (slice 2's shared tooling): the activation screen shows it as missing.

**Data.** Real family data may enter production once this slice ships; the real-data gate ([runbook](../runbooks/real-data-gate.md)) is already checked except item 5. Tests, seeds and screenshots use synthetic cases only.

## Requirements

### R1. Case tables

A new schema `cases`, owned by `app_migrator`, with DML for `app_api` only, and every table under forced row-level security keyed on `app.account_id` (ADR-0008). Each table gets its entry in `packages/db/src/registry.ts` (owner, export, erasure, retention) in the same pull request.

| Table | Holds | Visible to |
| --- | --- | --- |
| `cases.case_file` | ID, the account that created it, created time | Its members |
| `cases.member` | Case, account, the person row that is this account, joined time | Members of the same case |
| `cases.person` | Case, display name (at most 80 characters), the person's own account if any, the controlling account, whether the person is a member of the case or a relative outside it (such as a grandparent) | Members of the same case |
| `cases.person_profile` | One row per person: every fact of the domain `personSchema` except incomes, as JSON | The controlling account, and accounts it shared the profile with |
| `cases.person_finances` | One row per person: incomes, as JSON | The controlling account, and accounts it shared finances with |
| `cases.asset` | Kind, value, valuation date, liquidity, sale date, and owners with their shares | The controlling account of any owner, and accounts every owner's controller shared finances with |
| `cases.relationship` | One edge of the domain `relationshipSchema`, with person IDs | Members of the same case |
| `cases.share` | Person, grantee account, scope (`profile` or `finances`) | The controlling account and the grantee |
| `cases.rule_report` | R8 | The reporter |

- **Controller.** Each person has one controlling account, which alone writes that person's profile, finances and shares. An adult with an account controls their own person. A person without an account (a child, or a relative who never signs in) is controlled by the account that added them. When such a person later gets an account, the controller hands the row over (R2), and their facts go with it.
- **Validation.** The API validates every write with the domain schemas (`personSchema`, `relationshipSchema`, the asset schema) before it reaches the database, and stores dates and amounts exactly as the schemas define them. No free text is stored except display names and report notes.
- **Limits.** The snapshot's limits apply per case: at most 30 members, 60 people, 200 relationships and 100 assets. A write that would exceed one answers 409.
- **One case per account** in this slice; `cases.member` enforces it with a unique account column. Separated parents, each with their own case, come later if the family needs it.
- Access-matrix tests cover every table: a member of another case sees nothing; a member sees names and relationships but not a profile or finances until shared; revoking a share hides the row at once; only the controller writes; `app_jobs` and `app_auth` have no access.

### R2. Members, invites and the family area

- **Creating a case.** A confirmed account (spec 0003 R2) creates its case and its own person row in one call; it becomes the first member.
- **Joining.** The invite flow of spec 0003 is the only way in. When the inviter confirms an invitee (`POST /v1/invites/confirm`), the confirmation also makes the invitee a member of the inviter's case, either as a new person row or as an existing person the inviter picks, such as a parent they already described. Picking an existing person hands its control to the new account with its facts; the step-up of the confirmation covers it, with the chosen person ID as a target.
- **Leaving.** A member leaves the case from the family area after a `sensitive_settings` step-up. The adult takes their data: every person they control is deleted from the case with its facts, assets they alone own, shares and relationships. A last member leaving deletes the case.
- **Adding and removing relatives.** Any member adds a person they will control; the controller removes them. Relationships are written by the controller of either person in the edge.
- **The family area** (#118) lists the case's people with their relationships in plain words, whether each has an account and their link state (invited, waiting for confirmation, member), and, for the viewer's own people, who sees their profile and finances. From a person's row the viewer invites that relative (spec 0003 invites, with the person preselected for the hand-over), opens the person's guided questions, or changes sharing.
- **Sharing.** The controller shares a person's profile and, separately, finances, with chosen members, or with all members, which grants each current member and records the choice so later members are asked about. Nothing is shared until the controller chooses: the first time a controller saves a person, the screen asks who may see it, with all members listed and none preselected. Granting and revoking write audit events and notify the grantee in the app.

### R3. API

- Every route is declared in `packages/api-contract` with Zod schemas built from the domain schemas, runs as `app_api` with `withIdentity`, and refuses an unconfirmed account (spec 0003 R2).
- Routes, as a minimum: read the case (people, relationships, and what the viewer may see and edit); create the case; add, rename and remove a person; write a profile, finances, an asset and a relationship; replace a person's shares; leave the case; list evaluations (R6); report a wrong rule (R8). Writes return the updated view, so the client never merges state itself.
- Person and asset IDs are UUIDs in the API and the database. The snapshot builder (R6) replaces them with opaque IDs (`p1`, `a1`) for the engine, and maps results back.
- Display names never appear in URLs, logs, error reports or audit details (CLAUDE.md privacy rules); request logs carry route IDs and status only, as today.

### R4. Guided questions

- One flow per person, in short steps: basics (birth date, citizenships with how and when each was acquired, residence country), studies and languages, work (job offers), finances (incomes and assets), immigration history (visas, refusals, overstays), and family (spouses, partners, parents and children, with dates, custody and adoption). Each step saves on its own, so a person can stop and come back.
- Every question maps to one fact of the domain schemas; the flow is data next to the screens (step ID, fact path, input kind, text key), so a new fact in the schema adds a question without touching the flow's code.
- Unknown is always an answer: "Não sei" leaves the fact absent, which the engine treats as unknown (spec 0002 R3), and partial dates (year, or year and month) are accepted where the schema accepts them.
- Completeness questions set the markers: "Esses são todos os filhos de Ana?" sets `children` in `recordedInFull` only when answered yes.
- Inputs are touch-first and responsive (spec 0006); countries come from the pinned country dataset with pt-BR names; every string goes through i18n, written with the super-copy pass.

### R5. Playback

- A pure function in `packages/domain`, `describeCase(snapshot, at)`, returns the case as a list of sentence descriptors: a message key and typed parameters (person IDs, dates, countries, amounts), never text. Examples: two people married since a date; a child of two parents with shared custody; a person who holds two citizenships; an asset and its owners' shares; a refusal in a country and year.
- The client renders each descriptor through i18n with the viewer's names for the IDs, and links each sentence to the question that sets it, so correcting a sentence is one tap.
- Only facts the viewer may see are described; an unshared profile reads as "Ana ainda não compartilhou os dados dela".
- Table-driven tests cover every descriptor kind, partial dates and the "not shared" case.

### R6. Evaluations and decisive questions

- `GET /v1/case/evaluations` builds a snapshot from the rows the viewer may see (row-level security does the filtering, so a hidden fact is an unknown fact), computes decision states from verified decisions (R7), and runs `evaluateRoute` for every route in the catalog with each member of the case as principal. `recordedOn`, `rulesAsOf` and `factsAsOf` are today in São Paulo time.
- The response gives, per route and principal: the status (including `pending_activation` for a version not yet active), the unit, each requirement's result with its sources and verification dates, costs and durations as the engine reports them, and the decisive missing facts.
- **Only the questions that change the answer.** A pure function turns the decisive missing facts of all results into questions: each missing fact maps to the guided question that sets it, and questions are ordered by how many route and principal pairs they could decide, then by the step order of R4. A fact about a person the viewer does not control becomes "ask Ana to answer this" instead of a question.
- Evaluations are computed on request and not stored in this slice; the response carries each version's identity and the engine commit, so a result can be reproduced (ADR-0014).
- The results screen lists routes by country, each with a plain status per person ("pode ir", "não se qualifica", "falta saber", "regra ainda não ativada"), who goes with whom, and the questions above. Every rule shown keeps its source and date (CLAUDE.md rule 1).

### R7. Activation and rejection (ADR-0022)

- **Approvers** are listed per environment in a reviewed file in the repository by account ID. Production lists the owner's account. Previews and development list the synthetic seed account, and their decisions never leave those databases.
- **Decision.** An approver activates or rejects one version identity (route ID, number, content hash) with a step-up of the new purpose `knowledge_decision` (spec 0003 R5): action `activateVersion` or `rejectVersion`, targets the route ID and version number, field the content hash. The route recomputes the content hash from the catalog the API bundles, refuses a mismatch or an unknown version, and consumes the step-up. A version can be rejected after it is active; a rejected version is never activated again.
- **Storage.** `knowledge.decision`: ID, kind, route ID, version number, content hash, approver account ID, the step-up row it consumed, and decided time. Insert-only: `app_api` may insert and select, nobody may update or delete, as for the audit log. Each decision also writes an audit event.
- **States.** A pure, table-tested function in `packages/domain`, in its own module, computes each identity's state from the decisions: rejected if any rejection exists, else active if an activation exists, else proposed. The API passes the result to the engine as `states` (spec 0002 R5). Before counting a decision, the API checks that its approver is on the list and re-verifies its stored step-up assertion with spec 0003 R5's re-verification function against the credential's public key; a decision that fails is ignored and logged.
- **The activation screen**, shown to approvers only, lists proposed versions, newest first. For one version it shows, rendered from the data with no model involved: the rule's requirements as a readable tree with fact names in pt-BR, its dependents, costs and durations, its pinned country sets with their members, the difference from the version it replaces, each source with its full URL as plain text, its title, kind and verification date, with hosts new to the route flagged, and its rule cases with their expected results. The independent check's panel says the check does not exist yet.
- **The client computes the content hash itself.** The API serves the version file and every file it pins, exactly as bundled; the client canonicalizes them with the shared RFC 8785 canonicalizer and hashes them with WebCrypto, shows the start of the hash, and puts that hash, never one from the server, in the step-up fields. The canonicalizer and the hash composition move from `packages/knowledge` to a pure module the web app may import (the boundary matrix in spec 0001 R2 changes with it).
- Rejecting an active version shows the routes that would fall back to an older version or to `pending_activation`, and asks for confirmation.

### R8. Reporting a wrong rule

- From a requirement shown in a result, a member marks it as possibly wrong, with a reason from a fixed list (outdated, wrong amount, wrong condition, source does not say this, other) and an optional note of at most 500 characters.
- The server takes the route ID, version number and requirement key by recomputing the reporter's own evaluation and finding the requirement in it; a report about a requirement not in it answers 404. At most 20 reports per account per day.
- `cases.rule_report` holds the report; the note is case data under row-level security. The activation screen shows approvers the open reports per route, version, requirement and reason, with counts and no notes. Nothing sends a report to an agent or a model; the owner asks an agent to research it.

### R9. Audit, export, erasure and retention

- Audit events, with IDs and kinds only, never names or facts: case created, member joined, member left, person added, person removed, person handed over, share granted, share revoked, rule reported, version activated, version rejected.
- Data export (spec 0004) includes every case row the account controls and the case's people and relationships it can see.
- Erasing an account (spec 0004 R9) does what leaving does (R2) first. The deletion screen warns that people the account controls, such as children, are deleted with it unless control is handed over first.
- Retention: case rows live as long as their case; `cases.rule_report` rows are deleted 365 days after creation. [RETENTION.md](../RETENTION.md) gains both lines.

## Tickets, in order

| # | Ticket | Requirements |
| --- | --- | --- |
| 1 | Case schema, row-level security, registry and access-matrix tests | R1, R9 (registry) |
| 2 | Case API: create, people, profiles, finances, assets, relationships, shares, leave; snapshot builder | R1, R3, R2 (except invites) |
| 3 | Invite confirmation joins the case and hands over a person | R2 |
| 4 | Family area screen | R2 |
| 5 | Guided questions | R4 |
| 6 | Playback | R5 |
| 7 | Decisions: approvers file, `knowledge_decision` step-up, decision table, states function | R7 |
| 8 | Activation screen, with the canonicalizer moved to a client-safe module | R7 |
| 9 | Evaluations, decisive questions and the results screen | R6 |
| 10 | Reporting a wrong rule | R8 |
| 11 | Export, erasure, retention and the deletion warning | R9 |

## Threats

| Threat | Control |
| --- | --- |
| A relative reads another adult's finances | Profile and finances in their own tables under row-level security, shared only by the controller; evaluations see only what the viewer sees, so a result never reveals a hidden fact; access-matrix tests |
| Another family's data leaks across cases | Every policy keys on case membership; access-matrix case with two cases |
| A forged or replayed decision activates a wrong rule | Step-up bound to the content hash the client computed; approver list in the repository; re-verification before a decision counts; insert-only table. Residual in ADR-0022: the database owner role could insert a decision row with a forged assertion and credential, and a merged code change bypasses every check |
| Names leak into logs or analytics | Names only in `cases.person`; logs carry route IDs; audit details carry IDs and kinds |
| A report note or a display name steers an agent | Neither reaches an agent or a model in this slice |

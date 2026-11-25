# ADR-0040: The family plan, one shared list of moves evaluated with only who goes

- Status: Accepted
- Date: 2026-11-25
- Amends: spec 0002 (the evaluation context gains `chosenDependents`), spec 0007 (two case tables, any member writes them, and `/v1/case/plan`)

## Context

On 2026-11-25 the owner approved the family-fit priorities, whose fifth item is a family plan: which route each person takes, who goes first (for example a couple, then a parent who joins later) and family reunification later. The results screen evaluates every route for every member with everyone each route could cover, so it cannot say what a route asks of the group that actually goes: a remote-work visa's income threshold and its fees grow with each dependent, and people who follow a year later should not be counted in the first application. Nothing in the case records a chosen route, so the progress bar and the per-unit recommendation the product describes have nothing to read either. CLAUDE.md rule 4 forbids storing a fixed family partition; rule 2 keeps eligibility in the engine.

## Decision

- **A plan of moves in stages.** A move is one application: a member of the case as principal, a route, the people it takes along, and a stage from 1 (who goes first) to 6. A plan holds at most 20 moves and one per route and principal. A person may be the principal of a later move after going in an earlier one, which is how a family reunification is written: once someone lives there, they apply in a later stage for the people who join them; the plan's answer says from which earlier stage each principal already goes. No other ordering, date or dependency is stored.
- **Not a fixed partition.** The plan stores what the family intends. Each move's unit is still computed per route from the route's dependent rules and only narrowed to the people chosen: someone the route does not cover never joins its unit by being chosen, and is shown as not covered.
- **One plan per case, shared.** Every member of the case reads and writes the same plan; it holds no facts about anyone, only who is meant to go on which route. This is the one case table a member writes for people another adult keeps (relationships, by contrast, are written only by a keeper of one end): the plan files nothing and decides no eligibility, and a family that plans one move together should not need each keeper to agree on every line. `cases.plan_move` and `cases.plan_move_dependent` are under forced row-level security: `app_api` reads, adds and deletes rows of a case it is a member of, and nobody updates one, since a write replaces the whole plan under the case's lock. Foreign keys tie every row to a person of the same case and cascade, so a person who leaves takes their moves and their places in others' moves with them; erasure follows the person's keeper through the registry.
- **No lost edits, and a trail.** The plan's answer carries a revision, a digest of the plan as stored; a write names the revision it changes and is refused with 409 `plan_changed` when another member saved in between, so the screen reloads instead of erasing their move. Each write records `plan_written` for its author, with the case and the number of moves only.
- **Evaluated with the chosen unit, never decided.** `GET /v1/case/plan` evaluates each move with the engine, from what the viewer sees, passing the chosen people as `chosenDependents`: the unit keeps only those the route's dependent rules cover, everyone else is left out as `not_chosen` and adds no missing date or rate, and nobody unrecorded can join it. Requirements and costs then count only that group. Each chosen person is shown as covered, possibly covered or not covered, as the engine found, or as unknown when no version was evaluated (a pending or missing one); the plan's total is every move's own total added per currency in code, and a closed route adds nothing. The plan is what the family intends: it never makes a route eligible, and the results screen still shows every route for everyone. A move whose principal has since left the planning is not shown and the next write drops it, since only a person in the planning applies.
- **Today's rules and facts.** Moves are evaluated as of today, like the results screen; the spec 0002 rule that facts are never read after the snapshot's `recordedOn` stands. A reunification move therefore turns eligible only once the case records the residence that the route reads (the residence periods of [ADR-0036](0036-case-records-and-classifications.md)), not from a projected date.
- **Screen.** "Plano da família" (`/family/plan`) lays the stages side by side on a wide screen, with a side panel for adding or editing a move and for a move's full detail; a route's detail on the results screen offers to put it in the plan, and the family area links to it. Reading the plan counts against its own limit of 60 an hour per session; a write counts as a case write. The family plan is part of consultancy core slice 5 (checklist and plan) in spec 0002 and is not the step-by-step plan.

## Consequences

- The family sees what each application asks of the people who actually go in it, and what the whole plan costs, with every number from the engine.
- Any member can change everyone's plan. For one family this is the point; SECURITY.md records it as an accepted residual of the intra-family threat. A plan per adult, or per-person write rights, would need a new decision.
- Ages, income thresholds and residence time are read as of today. Projecting the case to a planned date (an age limit at filing, residence time a year from now) is left out on purpose; it needs its own decision on what a projected fact may assume (OPEN-QUESTIONS.md).
- Nothing in the catalog marks a route as a reunification route; the plan learns of one only through its rules, and Arca has none yet (OPEN-QUESTIONS.md).
- A move's link to the document checklist opens the route's checklist for the principal with everyone the route could cover, not only the people the move takes; narrowing the checklist to a move is left for later.
- The progress bar and the recommendation can now read the chosen routes; neither is built here.

## Alternatives considered

| Option | Why not |
| --- | --- |
| A plan per adult, like the comparison (ADR-0026) | The owner asked for the family's plan; members would each keep a different one and none would be shared without building analysis sharing first |
| The plan as JSON in one row | The case's rule is that a reference from one person to another is a row with a cascading foreign key, never an ID inside JSON |
| Add and remove endpoints per move instead of a revision | More routes and the same check on each; a plan of at most 20 moves is cheap to send whole |
| Evaluate moves at planned dates with projected residence | Needs facts after `recordedOn`, which spec 0002 refuses, and a decision on what the projection assumes; no reunification route exists yet to benefit |
| Store the result of each move | Results change with the rules and the case; recomputing on every read keeps them current and keeps nothing more to protect |

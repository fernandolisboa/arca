# Product

As of 2026-11-01.

## Vision

Arca does 99% of what an immigration firm does, for any family, based on how that family describes itself and what each person wants. The remaining 1% (signing and filing applications, representing the family before authorities, and cases with a legal complication) stays with the family and the professionals they choose; Arca prepares everything for those steps and tells them exactly who or where to go.

## Principles

1. **Every case is unique.** There is no fixed family structure. A person describes their situation in their own words, and Arca builds the case from that.
2. **Aspirations weigh as much as requirements.** The plan accounts for what each person wants, accepts and refuses, and how they prefer to be helped.
3. **Only what has a source counts.** Rules change fast. Arca watches official sources and never states a requirement it cannot cite.
4. **Security is a pillar.** Families trust Arca with passports, relationships and assets. Each adult owns their data; nothing is shared by default ([SECURITY.md](SECURITY.md)).
5. **Nothing is limited to a list.** Any country and any legal pathway (work, investment, study, family, descent, retirement, digital nomad, seasonal work, humanitarian and more) can be part of a case; the catalog grows as data, not code.
6. **The next action is concrete.** Not "gather documents", but "this certificate, from this office, at this link, valid for this long, needs an apostille, does not need translation for this destination".

## How Arca understands a case

1. **Free description.** Text or voice, the way someone would tell a friend: who is who, who is married to whom, what each person has, does and wants.
2. **Case model.** AI extracts people, relationships (including separations, common-law unions and custody of children), ages, education, work, languages, assets, citizenships, ancestry and where each person lives.
3. **Confirmation.** Arca plays back what it understood in plain sentences ("the parents are divorced; the properties are in the father's name") and the person corrects it.
4. **Only the questions that change the answer.** Instead of a 200-field form, Arca asks what is missing, ordered by how much the answer would change the recommendation.
5. **Each person's aspirations.** Priorities (speed, cost, certainty, citizenship, staying together, working in their field), deal-breakers, budget, timeline, risk tolerance and preferred way of being helped.
6. **Plan and next action.** Recommendations, guides and steps computed for this case, recomputed whenever something changes.

**Who accompanies whom depends on the route, not the family.** U.S. EB-5 covers only a spouse and unmarried children under 21; Portuguese family reunification can also include dependent parents of the resident or of the resident's spouse. In the same family, a grandparent can be a separate unit for one destination and a dependent for another.

**Arca raises what the person did not ask.** A minor whose parents are separated needs written authorization from the other parent; a previous visa refusal changes the strategy; assets in an ex-spouse's name change the source-of-funds story.

## Execution modes

The same step appears differently depending on the person's stated preference, the step's complexity and how they have used the app so far. The person can switch modes at any time.

| Mode | How the next action appears | When Arca chooses it |
| --- | --- | --- |
| Self-service | "Click this link and you are in the queue", with the form already filled | The person prefers to act alone and fast; the step is simple |
| Guided | Step by step on screen, with Arca checking each stage | The person wants to do it but with a safety net |
| Delegated | "Call this number or talk to this person about your case", with a case summary ready to send | The person prefers someone else to handle it, or the step has a legal complication |
| Family | The task goes to someone in the case who offered to help | A trusted relative is part of the case |

This requires the knowledge base to store the **action point** of each step, not only the rule: official portal link, phone number, consulate by jurisdiction (which depends on where the person lives), what to bring, and vetted partners by region.

## Services

| Immigration-firm service | How Arca delivers it | Phase |
| --- | --- | --- |
| Intake interview | Conversational diagnosis with AI, person by person: education, work, languages, health, assets, travel history, previous visa refusals, ancestry, life priorities | MVP |
| Destination comparison | Each person picks criteria and weights and sees a score per criterion and a ranked total per country, computed in code; criteria include cost of living, taxes, language, healthcare, safety, jobs in their field, schools, climate, distance to Brazil, Brazilian community, dual citizenship | MVP |
| Strategy recommendation | Per unit: recommended route and two alternatives, with pros, cons, risks, total cost, time to residence and to citizenship, and the reason behind each point, with sources | MVP |
| Document checklist | Per person and route: where to obtain each document, cost, lead time, validity, apostille and sworn translation needs | MVP |
| Step-by-step plan | Ordered tasks with owner, deadline, dependencies, execution mode and a how-to for each step | MVP |
| On-call questions | Assistant that answers any time with the case's context, cites sources and says when it does not know | MVP |
| Assets and currency | Sale, tax and FX simulator; documented source-of-funds trail | MVP |
| Document review | AI checks each file: legibility, validity, names and dates consistent across documents, faithful translation, apostille present | v1 |
| Forms | Official forms drafted from the case, for the person to review and submit | v1 |
| Writing | Cover letters, source-of-funds statements, business plans, NIW narratives, recommendation-letter drafts | v1 |
| Interview practice | Voice simulation of the consular interview, with typical questions for the route and feedback | v1 |
| Tracking | Deadlines, appointments, case status and alerts when a rule changes | v1 |
| Arrival and settling | Per-country checklist: tax ID, bank account, housing, school, health plan, driver's license, moving goods, pets | v1 |
| Partner network | Destination lawyers, translators, document services and FX providers, with history, cost and ratings | v1 |
| Multi-family | Separate accounts, onboarding and billing | Product |

## Destinations

Any country can be selected. The list of countries comes from a standard dataset (ISO 3166); nothing is hard-coded. What grows on demand is the route catalog: selecting a country with no research triggers a research job that drafts its routes with sources, for human approval.

1. Each person selects the countries they accept, with priority.
2. The family sets a constraint: everyone in the same country, or units may split.
3. The evaluation engine evaluates every route of the selected countries for each person and unit.
4. Arca ranks combinations by total cost, time to residence, time to citizenship and chance of approval, and shows what is missing for each.

Initial suggestions, pre-researched because they offer something concrete to Brazilians (details and sources in [research/](research/)):

| Country | Why it is on the list | Research status |
| --- | --- | --- |
| United States | EB-5 for those with capital; work and talent visas | Deep |
| Portugal | Same language; naturalization in 7 years for Brazilians; D7, D8 and D2 visas | Deep |
| Spain | Citizenship after 2 years of legal residence for Brazilians | Overview |
| Uruguay, Paraguay, Argentina, Chile | Residence under the Mercosur Residence Agreement | Overview |
| Mexico | Temporary residence by economic solvency | To research |
| Italy | Citizenship by descent for children and grandchildren, under Law 74/2025 | Via ancestry |
| Japan | Long-term resident visa for descendants up to the third generation | Via ancestry |
| Germany | Opportunity Card; Blue Card; naturalization in 5 years | To research |
| Canada | Express Entry points system | Overview |
| Ireland | English-speaking EU country with a strong tech market | To research |
| Australia, New Zealand | Points-based skilled visas | To research |
| United Arab Emirates | Long-term residence through property investment, no personal income tax; no path to citizenship | To research |

## Platforms

Web first, as an installable app that works on phones, tablets and computers with nothing to install. Then native apps: Android, then iPhone and iPad, then desktop only if the web app leaves a real need unmet. Native apps add the system document scanner, biometric unlock, reliable notifications, receiving files from the share sheet and store presence. Plan and order: [ROADMAP.md](ROADMAP.md).

## What stays outside the app

- Signing and filing applications: each person submits on the official portal, with Arca guiding alongside.
- Representing the family before authorities.
- Cases with a legal complication (for example, a previous visa refusal): Arca switches to delegated mode and prepares the summary for a professional.

To become a product for other families, Arca must position itself as a self-help tool. In several destinations, the United States among them, giving immigration legal advice is a restricted activity.

## Case 1

The founder's family is the first case and the validation gate for the product. In summary: six adults; a divorced couple, one of whom holds real-estate assets that would be sold to fund the move; their two adult children with their spouses. No destination is fixed.

Real case data lives only in the app's encrypted database, never in this repository. A synthetic case with the same shape belongs in the evaluation suite.

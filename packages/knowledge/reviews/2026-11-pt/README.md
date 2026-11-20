# Session review 2026-11-pt

Portugal has two stored routes, `pt-d7` (retirees and people living on their own income) and `pt-d8` (remote work for employers or clients abroad). Version 6 of each, effective 2026-01-01, was read against the gazette texts on `files.diariodarepublica.pt` on 2026-11-20. Version 7 corrects each, from the same date ([ADR-0032](../../../../docs/adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../../../docs/runbooks/session-rule-review.md)).

## What version 7 changes

Both routes:

- **Spouse under 18.** Version 6 left out a spouse when either spouse was under 18. Lei n.º 23/2007, article 99.º, n.º 6 (Lei n.º 61/2025), sets that age for the right to family reunification, and the text does not say whether it reaches the visa that family members ask for together with the principal (article 58.º, n.º 5). The spouse now reads as possible, and the title says why.
- **Entry ban.** Article 52.º, n.º 1, c), is quoted as Decreto-Lei n.º 41/2023 words it ("no SII UCFE"); version 6's evidence would have rested on the 2022 republication, which still names the extinct SEF's system. A source for that act is added.
- **Entry ban and conviction.** Both titles say that article 52.º reaches each applicant, not only the principal; the assessment still shows the principal's fact.
- **Children.** The four child rules cite the means scale of Portaria n.º 1563/2007 for the age of 18, and their titles name what is not checked: that an adoption is recognized by Portugal, the other parent's consent or a custody decision for a child of only one spouse, and that the child is in the couple's charge.
- **Household means, same amounts.** The minimum wage net of social security is now written as the law states it, EUR 920 less 11% of it, in place of a factor of 0.89 that no text states. The threshold is the same to the cent.
- **Sources.** Every title checked against its provision, `lei-7-2001` now names both provisions it is cited for, and every `verifiedAt` is 2026-11-20.

`pt-d7`:

- **Household income.** Version 6 failed a family whose passive income fell short, whatever else it earned. The means scale speaks of means, and Decreto Regulamentar n.º 84/2007, article 12.º-A, n.º 1 (Decreto Regulamentar n.º 1/2024), counts those from a work, company or services contract. Passive income at the threshold still settles the requirement and total income under it still fails it; a family that reaches it only with income from work now reads as possible. A source for the 2024 wording is added, and two cases pin the new branch.

`pt-d8`:

- **Means for 12 months.** The title says that the period is not settled: Portaria n.º 1563/2007, article 5.º, n.º 6, asks any residence visa applicant for at least 12 months, and n.º 1 asks a work visa applicant for the visa's stay with its extension. Both are quoted.

Amounts, fees, durations, the partner rules and the other conditions of version 6 matched their sources. No act newer than Lei n.º 62/2026 amends Lei n.º 23/2007, and the decree with the 2027 minimum wage was not published as of 2026-11-20.

## Code in the same pull request

- The quote check reads a value written as a percentage: "50 %" states 0.5 (ADR-0027, amendment of 2026-11-20). Without it no text could state the scale's factors.
- The offline check reads the echo rule on the address the app requests for a page, its machine-readable address, as the live check already did (ADR-0032).

## Rounds

ROUNDS

## Leftover

LEFTOVER

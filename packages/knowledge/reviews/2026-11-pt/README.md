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

Three adversarial rounds, the limit, by two reviewers: one read each item against its provision, the other looked for wording out of date and for what the routes leave out. Round 1: two conditions that settled what the law leaves open (the spouse under 18, and the D7 means when income from work fills them), one quote of superseded wording (article 52.º, n.º 1, c)), and titles that left conditions unsaid. A rule for minor siblings under guardianship was tried in this round and removed (leftover 3). Round 2: no wrong item; the D8 means assessment got back the quotes of the proofs n.º 6 names, and one title was reworded. Round 3 read those two changes and found nothing wrong; it asked that one source title keep the floor of 12 months, which was written after it (leftover 16). The quote check, the app's own (`ARCA_REVIEW_QUOTES=2026-11-pt`, in `apps/api`), passed in the session on 2026-11-20 UTC: every item matches on the pages it cites and its quotes state its values. The `review-quotes` job runs it again on the pull request.

## Leftover

1. **Dependent adult children weigh 50% in the means scale, not 30%.** Portaria n.º 1563/2007, article 2.º, n.º 2, c), gives "filhos maiores a cargo" the children's 30%, and the schema cannot tell an adult child from another adult. Such a child is only ever a possible dependent, so this widens the band of incomes that read "Faltam informações" and never turns a result into eligible or not eligible wrongly.
2. **The age of majority has no readable source.** Article 122.º of the Código Civil comes from Decreto-Lei n.º 496/77, whose gazette PDF is a scan with no text. The age of 18 in the child rules rests on the means scale, which says "crianças e jovens com idade inferior a 18 anos".
3. **Minor siblings under the principal's guardianship** (article 99.º, n.º 1, g)) are not dependents here. A rule that reached them through the principal's parents made every family with a recorded parent read "Faltam informações", since the case has no fact for guardianship; it needs that fact first.
4. **Whether article 99.º, n.º 6, reaches this visa.** The age of 18 for both spouses and the marriage "valid and recognized under Portuguese law" are conditions of the right to reunification; the spouse who applies with the principal reads as possible when either is under 18, and the validity of the marriage is not checked. For a partner, Lei n.º 7/2001, article 2.º, a), sets the age itself, so a partner under 18 stays left out.
5. **The D8 means period is not settled.** Portaria n.º 1563/2007, article 5.º, n.º 6, asks 12 months of any residence visa applicant but names proofs only for retirees and people living on income; n.º 1 asks a work visa applicant for the visa's stay with its extension. A third period, for the family's means, is in Decreto Regulamentar n.º 84/2007, article 24.º-B, n.º 1, b): the stay applied for or 12 months, whichever is less. Both routes' assessments speak of the principal only.
6. **Why income from work leaves the D7 means possible, not met.** Article 12.º-A, n.º 1, says such means must be taken into account, and article 12.º, n.º 1, f), asks for proof of means "atenta a natureza do tipo de visto solicitado": for a visa for people who live on a pension or on their own income, the texts do not say how far a wage counts. That provision is not quoted: an item takes at most five quotes.
7. **"A cargo" is not tested** for a minor child, and an adult child or a parent who depends only on the principal's spouse is read as the earlier versions read them (the route notes list each case).
8. **Conditions that are documents, or that no fact records:** the D8 tax residence document and the three-month average of income (article 31.º-A, n.º 1, c) and d)); the statement of responsibility that can prove means, and replaces that proof for nationals of states of the CPLP agreement, Brazil among them (Decreto Regulamentar n.º 84/2007, articles 12.º, n.º 3, and 12.º-A, n.os 2 and 3); the parental authorization for a principal under 18 (article 12.º, n.º 5); where the application is filed (article 10.º, n.º 2); the other refusal grounds of article 52.º (n.os 4, 10 and 11).
9. **Family that does not apply together.** Article 98.º, as Lei n.º 61/2025 words it, gives the right to reunification to a resident whose permit has been valid for at least two years, with exceptions. The routes model only the family that applies with the principal (article 58.º, n.º 5).
10. **Family members of EU or Portuguese citizens** (article 4.º, n.º 2, c)) are outside the foreigners law when they exercise free movement; the citizenship requirement reads only the principal's own citizenships.
11. **Fees after the visa.** The residence permit fees of AIMA and the conditions of article 77.º are not in the routes: `aima.gov.pt` refuses this session's requests. The visa fee for a child of exactly 6: the table exempts children "até aos 6 anos de idade", and the cost reads that as under 6.
12. **The minimum wage is the mainland's.** Decreto-Lei n.º 139/2025 applies "a todo o território continental"; no text read here says which amount a consulate uses for a family bound for the Azores or Madeira.
13. **The 2027 minimum wage.** No decree was published as of 2026-11-20. Version 8 of both routes, from 2027-01-01, is due when one is ([#220](https://github.com/fernandolisboa/arca/issues/220)).
14. **Versions 1 to 6** were not reviewed: version 7 replaces them from 2026-01-01.
15. **Production rows were not read.** This session has no database credentials; the proof of publishing is the production build, which runs the migration and fails if the database already holds a version 7.
16. **One correction no reviewer saw.** Round 3 was the last round, so the wording it asked for in the D8 source `portaria-1563-2007-period` ("12 months or more") was checked only by the session, the proposal check and the quote check.

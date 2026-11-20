# lv-capital-investment

Research notes for Latvia's temporary residence permit for an investment in a company's share capital, route `lv-capital-investment`, stored in the database's `knowledge` schema ([ADR-0031](../../adr/0031-rule-updates-on-request.md)): versions 1 to 4 were imported from `packages/knowledge/data/routes`, and later versions come from an update request or from `packages/knowledge/reviews`. The seed research is in [other-destinations.md](../other-destinations.md); the audit procedure is in the [rule audit runbook](../../runbooks/rule-audit.md).

## Audits

### 2026-11-20, session review

A session review the owner asked for ([ADR-0032](../../adr/0032-session-reviews-activate-through-a-reviewed-pull-request.md), [runbook](../../runbooks/session-rule-review.md)). The record, with what changed, the rounds and the leftover list, is [packages/knowledge/reviews/2026-11-lv/README.md](../../../packages/knowledge/reviews/2026-11-lv/README.md).

- **Version audited:** 4 (effective 2026-09-15), the newest stored.
- **Outcome:** correction, version 5, of version 4 from its own date, stored already active by the review's pull request. Every requirement, dependent rule and amount of version 4 matched its text and stays. New: sixteen assessments for the general conditions of any temporary residence permit (the call, means of subsistence, health insurance, the documents, three refusal grounds, the company's tax debt, where to file, the three-month decision), five costs for the call and the permit card (EUR 10 or EUR 17, EUR 10 a person, EUR 45 a card), and exact titles for the payment to the state budget, the renewal payment, the answer's time limit and the children of 18 or more. The permit's term moved from a duration to the title, since the quote check reads no Latvian number words.
- **Sources re-read** on 2026-11-20, through the app's reader: the Immigration Law (id 370622), arts. 1, 2, 25, 27 to 30, 32 to 34 and transitional provision 3; the Civil Law (id 90223), arts. 219 to 221; the Law on the Protection of the Rights of the Child (id 49096), art. 3; Cabinet Regulations No. 731 of 2024 (id 356656), points 3, 5 and 7; No. 564 of 2010 (id 212441), points 7, 13, 15, 28, 29, 39 to 41, 65, 71 to 75; No. 225 of 2017 (id 290808); No. 656 of 2015 (id 278067), point 2; No. 591 of 2008 (id 179063), points 6, 7 and 9; No. 825 of 2006 (id 146484), point 2; No. 133 of 2012 (id 244579), point 4². Read in the session, not cited: the Immigration Law of 2002 (id 68522), art. 23, which the earlier regulations were written under.
- **Amendments looked for**, up to 2026-11-20: the redactions and amending acts of each act on likumi.lv, and the acts issued under the new law. The Immigration Law: redactions of 2026-09-15 and, for art. 48, 2027-12-31; no amendment. No regulations under art. 28. Regulations No. 669 of 10 November 2026 (entry restrictions for Russian and Belarusian citizens) change no item. The Civil Law's redaction of 2026-11-11 did not touch arts. 219 to 221.
- **Addresses:** `https://likumi.lv/ta/id/<id>` answers `curl` and the app's reader; an act's amendments and the acts issued under it are listed at `https://likumi.lv/ajax/saistitie.php?do=show&doc_id=<id>&type=468&version_date=<dd.mm.yyyy>&pants=0` (and `type=rev-933`). Some pages break words with soft hyphens, which a review file may not hold, so quotes stop before them.
- **Watch next:**
  - New Cabinet regulations under the new law, due by 1 December 2027, and the 2027 minimum monthly wage: each a new version from its date.
  - Latvian number words in the quote check, to bring back the permit's two-year term as a duration.

### 2026-11-11

The first audit ([#360](https://github.com/fernandolisboa/arca/issues/360)), on demand, in one pull request with the Czech, Danish, Georgian and Icelandic routes ([Czech record](cz-eu-blue-card.md)).

- **Version audited:** 3
- **Outcome:** correction, version 4 (pull request [#394](https://github.com/fernandolisboa/arca/pull/394)), from version 3's date, 2026-09-15, which it replaces entirely. It pins the EU, EEA and Swiss set at version 2.
- **Sources re-read** (all on 2026-11-11 UTC with `curl` on `likumi.lv`):
  - The Immigration Law (id 370622), whole, in the redaction in force since 2026-09-15; arts. 1, 2, 27, 28, 29 and 33 are cited, each provision now a source of its own.
  - The Civil Law, family part (id 90223), arts. 219 to 221.
  - New: Cabinet Regulations No. 731 of 2024 on the state fee for migration services (id 356656), whole.
  - No longer cited: the Administrative Procedure Law (below).
  - Not readable: none.
- **Amendments looked for**, up to 2026-11-11: the law's list of redactions (2026-06-27, 2026-08-26, 2026-09-15 and, announced, 2027-12-31) and its amending laws. Art. 27(1) point 36, the EUR 150,000 state-fund permit, is still in the text. No Cabinet regulations under art. 28 were found.
- **Leads:** the bill sent to committee on 2026-09-10 that would delete point 36, and private pages about it; nothing official confirms it passed.
- **Findings:**
  - Missing, now costs: the state fee for examining the request (EUR 160 in 30 days, EUR 280 in 10 working days, EUR 560 in 5; Regulations No. 731, point 5.1), for the principal and for each family member, and the EUR 2,000 paid on a repeated permit after five years (art. 29(3)), shown as possible.
  - Missing, now durations: the Office's answer within 30 days (art. 33(1) point 1) and the permit of up to two years (art. 27(1) point 10).
  - Missing, now assessments: no more than ten investors holding permits through the same company, and no suspension by the Cabinet (art. 28).
  - Corrected: the leap-day convention. The Administrative Procedure Law counts procedural terms, not ages, and no Latvian text read says on which day a person born on 29 February turns a year older in a common year; `leapDayBirthday` is now `unsettled`. The cases already showed such a child as possible on 28 February.
  - Split: the definition of a family member (art. 1(1) point 8), the renewal, the time limit and the suspension are sources of their own.
  - Confirmed, unchanged: the EUR 50,000 or EUR 100,000 investment with the EUR 10,000 payment, the company's size and taxes, the exclusion of Russian and Belarusian citizens, and the family rules.
- **Check loop:** runs [43085585954](https://github.com/fernandolisboa/arca/actions/runs/43085585954) (version 3, 5 of 12 items), [43087381074](https://github.com/fernandolisboa/arca/actions/runs/43087381074) (9 of 18), [43088296917](https://github.com/fernandolisboa/arca/actions/runs/43088296917) (8 of 18), [43090845128](https://github.com/fernandolisboa/arca/actions/runs/43090845128) (4 of 18, and `requirement:not-russian-or-belarusian` marked as differing with no reason given, only the word "placeholder") and [43091465538](https://github.com/fernandolisboa/arca/actions/runs/43091465538) on the final head (10 of 18, none differs); the item marked in the fourth run matched in the first and the fifth, so it was a faulty answer of the checker, not a difference. Five runs in all, over the runbook's three and one: review changed the versions after the third, and a fourth run on the reviewed head was followed by small logic fixes, so a fifth ran on the final head. The law is one long page, and the passage locator does not pick the same passages each run ([OPEN-QUESTIONS](../../OPEN-QUESTIONS.md)). Left over:
  - `checker-gap`: `requirement:not-eu-eea-or-swiss-citizen`, `dependent:spouse`, `dependent:children` and `dependent:spouse-children`, each a chain of art. 27(3), the definitions of art. 1 and, for children, the Civil Law, which the locator never gave together; `assessment:no-suspension`, since no page can show that a regulation does not exist; `duration:permit`, whose "two years" the law writes in words; the pinned set `eu-free-movement` v2, as in earlier audits.
  - Matched in one run only: `requirement:capital`, `requirement:not-russian-or-belarusian`, `cost:state-fee`, `cost:family-state-fee` and `cost:renewal-payment`.
- **Watch next:**
  - The redaction of 2027-12-31 and the Cabinet's art. 28 regulations, due by 2027-12-01: a suspension that names a country is a new version.
  - Regulations No. 731 of 2024 lose force on 2027-12-02: the fees need a new source by then.
  - The fund bill: if point 36 is deleted, nothing changes here, since this route never modeled the fund.

# ADR-0027: Admins decide while signed in, helped by the independent check

- Status: Accepted, amended 2026-11-09 (long pages and reasons, below)
- Date: 2026-11-07
- Spec: [#325](https://github.com/fernandolisboa/arca/issues/325)
- Supersedes: [ADR-0022](0022-single-approver-activation.md) for new decisions (its stored decisions keep counting as it says)
- Amends: [ADR-0014](0014-knowledge-base-as-reviewed-data.md) (the independent check: where it runs, what it reads, its report, and that a clean report now enables a one-tap activation); [ADR-0004](0004-ai-providers-behind-ports.md) (a `RuleChecker` port and, since the long-page amendment, a `PassageLocator` port); [ADR-0006](0006-auth.md) and [ADR-0015](0015-identity-enrollment-step-up-and-recovery.md) (decisions leave the step-up actions; giving the admin role joins them under a new purpose); [ADR-0008](0008-database-security-and-environments.md) (which role reads and writes decisions, admin grants, check starts and reports); [ADR-0009](0009-background-jobs-guarantees.md) and spec 0004 R9 (a route ID and a version number become workflow arguments, and the check's step runs with no account identity); [ADR-0010](0010-stack-revised.md) (an HTML-to-text library); [ADR-0025](0025-rule-summary-for-the-approver.md) and [ADR-0026](0026-destination-comparison-data.md) (admins replace approvers; comparison decisions need no step-up either); [ARCHITECTURE.md](../ARCHITECTURE.md); CLAUDE.md domain rule 5. Spec 0002's knowledge-base threat table, spec 0003 R5's purpose list and spec 0007 R7 are updated by the tickets of [#325](https://github.com/fernandolisboa/arca/issues/325)

## Context

The owner asked on 2026-11-07 why activating a rule asks for a passkey again, and chose, on three decision cards:

1. **An admin role in the app**, given and taken away by an admin, instead of a list of approvers in the repository.
2. **No step-up on a decision**: a signed-in admin activates or rejects with one tap.
3. **An AI analyst checks each rule against its own official sources**, and an admin activates the rules it finds clean together, with one tap; flagged rules are decided one by one.

Facts behind those choices:

- The step-up proves that a person, not an agent holding the owner's GitHub token, made the decision (ADR-0014). Signing in already takes a passkey, and no agent holds an app session, so a signed-in admin proves the same thing against that attacker.
- ADR-0022 already accepts that whoever writes the production database as `app_auth` or the owner role can forge a decision.
- The 24 route versions seeded so far wait for activation, one passkey prompt each. The owner trusts a careful model check over his own reading for this kind of repetitive comparison, and wants his attention only where the check fails.
- The independent check was specified in ADR-0014 and never built, for lack of an API budget. The owner's Ultra plan now pays for direct API calls ([ADR-0023](0023-free-text-intake-sends-the-writers-own-words.md)).
- No Claude skill covers immigration law per country (checked 2026-11-03). ADR-0014's country guide is the per-country specialist: one check loads the guide of the version's country.

## Decision

### Admins

- An **admin** may activate and reject knowledge-base versions, ask for rule summaries, read rule reports, and give or take away the admin role. The role is global, never per case, and grants no access to any case's data.
- The **owner list** in the repository (today's approver list, renamed, with the same account IDs) names the accounts that are always admins, per environment. It changes only by a reviewed pull request, and an owner-list admin cannot lose the role in the app. It is how the first admin exists.
- Any other admin holds an **admin grant**. The grant history is insert-only: one row when the role is given and one when it is taken away, each with both account IDs and a time the database sets after the lock below. Rows are kept for as long as the decisions that rely on them, so they are retained, with account IDs only, like decisions.
- An admin gives the role, from the family area, to a confirmed account that shares a case with them, and takes it away the same way. Any admin, owner-list or granted, can take away the grant of a member of a case they share, which is accepted; a grant held by someone who shares no case with an admin cannot be taken away in the app (#328).
- **Giving the role needs a step-up** of a new purpose, `admin_grant`, with the action `grantAdmin` bound to the grantee's account ID and the client's action nonce, under the step-up's usual guarantees (spec 0003 R5). The grant row records the step-up it spent. Taking the role away needs none.
- Each change writes an audit event and sends the owner-list admins a security notice with a generic text and a link, no names, so an unexpected grant gets noticed.
- The API reads the role from the database on every request and never caches it in the session, so taking it away takes effect at once.

### Decisions without a step-up

- A signed-in admin activates or rejects a route version or a comparison version with one request.
- **Who writes what:** only `app_auth` inserts decisions and admin grants. Before its transaction, the API checks on `app_api`, under row-level security, that a grantee is confirmed and shares a case with the admin; the small race between the two transactions is accepted. The `app_auth` transaction sets the request's account as its identity, takes transaction advisory locks keyed by the accounts involved, in a fixed order (the author for a decision; the granting admin and the grantee for a grant or a removal), checks the role, and inserts. `app_auth` reads admin grants, decisions and check reports for that; `app_api` only reads decisions and grants.
- The decision's insert policy requires the author to be the transaction's own account and the proof to be `session`, and the database sets the row's time with `clock_timestamp()` after the lock, as it does for grant rows. The row also records why its author was an admin: the owner list, or the grant row in force. A database check keeps the proof and the step-up fields consistent: a `step_up` row has every assertion field, a `session` row has none.
- **When a `session` row counts:** when the reason it records holds: its author was on the owner list when it was stored, or the grant it names was in force at the row's time, by the grant history. A grant row counts the same way only when its granting admin was an admin at its time. So a decision keeps counting after its author loses the role, and a grant row by an account that was never an admin, by the grant history, counts for nothing, a rejection included. The owner list keeps no history, so an `owner_list` row counts by the basis it records, which `app_auth` checked against the list when it stored the row; leaving the list then never undoes a decision, and losing the role never revives a version its author rejected. Owner-list account IDs are public in the repository, so checking today's list would stop no forger, who already needs an `app_auth` write (#326).
- Rows stored under ADR-0022 keep their step-up and are re-verified exactly as before, against the owner list; their rejections still count even when they do not verify. The purpose `knowledge_decision` stays in the contract, the database check and the re-verification; only the step-up options route stops offering it. The subject kind of a comparison decision (ADR-0026) lives on the row.
- The decision routes keep the API's same-origin check on every state-changing request (the `Origin` header or `Sec-Fetch-Site`), and the client keeps the strict content security policy with Trusted Types and `frame-ancestors 'none'` (spec 0001), so another site cannot make an admin's browser decide, frame the one-tap button or run script on the screen that shows page quotes.
- A forged `session` activation counts if its author was an admin at the row's time; that needs a write as `app_auth` or the owner role, the attacker ADR-0022 already accepts.

### The independent check

It is ADR-0014's check, now built, with these choices.

**Scope and items**

- Route versions only. A comparison version's values come from a statistics API, not from law text, so it is decided on its own.
- The items are every requirement, assessment, dependent rule, cost and duration, the leap-day rule and the closure when the version has them, and each pinned country set's members, checked against the set's own sources on the set's own pinned lists. A pure function in `packages/domain` lists them by stable key. A version with sourced content that function does not list is never clean.
- Settings that cite no source (effective dates, currency, reference dates) are not items; the report panel says the check does not cover them.

**Starting and storing**

- When the activation screen opens, it sends a same-origin `POST`, for admins only, that starts a check for each proposed, not rejected route version with no current report and no recent start. Listing versions has no side effect.
- A start ledger records each start (an ID, route ID, number, time), written and read by `app_api` under an environment-wide advisory lock, so concurrent screens neither exceed 20 starts in any 24 hours per environment nor start a version twice. A start older than 30 minutes with no report is dead. Starts are kept, with no personal data.
- A Vercel Workflow in São Paulo runs one step with no step retries, whose input is the start ID, route ID and version number only, and no account ID: the step reads only public rule data and writes only the unowned report table, an exception to spec 0004 R9's identity-bound `app_jobs` steps; the route ID and number join the workflow arguments' closed kinds ([ADR-0009](0009-background-jobs-guarantees.md)). The step runs as `app_jobs`: it fetches, calls the model, checks the answer and inserts the report keyed by its start, turning every error into a fixed code. No page text or model output becomes a step input or output.
- A report records the start, route ID, version number, content hash, guide hash (the value `none` without a guide), prompt version, model, time, items and fetch log (URL, final status, time, SHA-256 of the text sent, whether it was cut). It is public rule data with no account, unowned in the personal-data registry; `app_jobs` inserts and reads, `app_api` and `app_auth` only read, and nobody updates or deletes.
- A version's **current** report is its newest report whose content hash, guide hash, prompt version and model match today's, if it is less than 30 days old, or less than one day old when a fetch or the model call failed or no page text was sent (since the 2026-11-09 amendment below, also when a long page had no passage picked); after that the next screen opening checks it again. The country's current guide is its highest version in the bundled catalog.

**Fetching**

- For each item, only the `official` sources that item cites, over `https`, on a host of one of the pinned official-domain lists that cover it; every redirect hop (at most three) must stay on those hosts; only a final `2xx` response counts.
- `node:https` with a `lookup` that asks for every address, keeps only globally reachable unicast ones by the IANA special-purpose registries (so loopback, private, link-local, unique-local, CGNAT, unspecified, multicast, reserved, metadata, and IPv4-mapped, IPv4-compatible, NAT64, 6to4 and Teredo forms are refused) and connects to one checked address while verifying the certificate against the host name. No new HTTP client.
- No cookies or credentials; limits on bytes received, decompressed size, time and redirects; each page's text is capped at a size that holds a whole code (3,000,000 characters since the long-page amendment below; 60,000 before it, which cut most laws).
- HTML becomes plain text through one maintained HTML-to-text library, the only dependency this ADR adds: a pure parser with no browser DOM emulation and no script execution, no network, no install scripts, a permissive license and the repository's minimum release age, for it and every package it pulls in, named in its ticket under the supply-chain review. The conversion drops `script`, `style`, `noscript`, `template`, comments, and elements marked `hidden`, `aria-hidden` or hidden by an inline style, and, since the long-page amendment below, struck-through text; text hidden by a style sheet is left to the value check below. The library is parse5 (MIT; its one dependency, entities, is BSD-2-Clause), whose tree Arca walks without recursion ([#329](https://github.com/fernandolisboa/arca/issues/329)).
- A PDF, another content type, a page with no text of its own (one that scripts draw, `no_text`) or a failed fetch makes the items that rely on it **could not be checked**; PDF reading may come later.

**What the model reads and answers**

- The version as the admin's activation view lays it out (no hash, no state, no rule cases), the item keys, each page's text in its own delimited data block with its URL and angle brackets replaced, as in ADR-0025, and the country guide in its own data block after the pages. The prompt says the pages are the authority and a guide never outweighs them. The instructions come first so they can be cached. No case data, so no exception to minimization.
- A closed schema with one entry per item key: a status (**matches**, **differs** or **could not be checked**) and, except for the last, a quote and its URL. A **differs** entry carries one short plain-text note on what differs, and, since the long-page amendment below, a **could not be checked** entry carries one saying why; these are the only free text, because a flagged item is what a person reads next. Code strips URLs and host names from a note and caps its length, and drops the note of any answer it refuses itself. Unknown or duplicate keys are dropped. No recommendation, no verdict on the rule.

**Checked in code**, in pure functions in `packages/domain`. A quote counts only when:

- it is a verbatim substring, after whitespace is normalized, of the exact text sent to the model for a URL that the item itself cites, and, on an excerpt, lies within one run of it;
- its length is within a minimum and a maximum;
- it contains no decoded query value of four characters or more from any URL of the redirect chain, and the item's value does not appear as a whole token in any of those URLs, so a page that echoes its own address cannot be quoted;
- for an item that states a number, an amount, a date, an age or a duration, the item's value, normalized for separators, decimal commas, currency and unit, appears in it. The model picks the passage; code compares the value.

A quote that fails, a missing item, an item that cites no official page or none of whose pages was read, and a match from a page cut by the size cap are **could not be checked**. A report is **clean** when it has at least one item and every item matches; a report written by the scripted checker used outside production is never clean.

**Model, cost and display**

- A `RuleChecker` port with a Claude adapter on the shared call shape (no tools, no SDK retries, one retry on an unparsable answer). The model is kept in reviewed code; it starts as `claude-sonnet-5-5`, a strong model that differs from the one the authoring sessions write rules with. A check is one or two calls, plus, since the long-page amendment below, one fast-model call for each long page.
- Long laws drive the cost: an estimate of ten to fifty U.S. cents a check (2026-11-07, from the rule summary's token prices). The 20-a-day cap bounds a bad day to about ten dollars per environment (about twenty-five since the long-page amendment below), and a version is checked once per content, guide, prompt and model every 30 days at most.
- The activation screen shows each version's status (checked, flagged, running, stale or not checked) and the report in its own panel, labelled as written by a model that can be wrong, with quotes and URLs as plain text, never links, the guide's country and version, and what the check does not cover. A stale or missing report shows as such; could not be checked never reads as passed. The report is never part of the content hash.
- **A difference opens no research task yet**: no research agent exists. The admin rejects the version or asks for a correction, written in an authoring session like any rule.

### Country guides

- One file per country and version under the knowledge data, immutable and hashed like other knowledge files: the laws and regulations that govern the country's routes (each with a URL on a pinned official-domain list), how they are usually amended, and known pitfalls. A guide never widens what counts as official and is never a source.
- A guide is a trust root: the `knowledge-immutable` check makes it land in its own pull request, as it does for official-domain lists, and it needs no activation. A check runs with no guide when the country has none, and the panel says so.

### Activating the checked versions together

- A **checked version** is a proposed route version whose current report is clean; a **flagged version** has a current report that is not clean.
- The activation screen offers one action for every checked version. The client sends the identities (route, number, content hash) it showed; the server activates only those that are still proposed, still checked under a current report and still match the bundled hash, and answers which were activated and which were skipped, with a reason code each. Each activation is its own decision row and audit event. The statuses are read once, before the decisions and outside their transactions, so a report written while a batch runs is not seen; one decision accepts the same window for a rejection stored after it read the states (#331).
- This reverses ADR-0014's rule that a report never enables or shortens the activate action, for checked versions only. Flagged versions, versions with no current report and every comparison version are decided one at a time, with no step-up either.

### Evaluation

- `apps/api/test/eval/independent-check`, run by the manual `intake-eval` workflow with a call cap, on recorded page snapshots through a fake fetcher, so runs repeat.
- Cases: ADR-0014's known-wrong versions (a changed threshold, a dropped dependent condition, an expired rule) and correct ones; ADR-0014's adversarial cases (instructions on a cited page to report a match, a quote that is not on the page, a page changed since `verifiedAt`, a redirect to a lookalike host, a guide that contradicts its source); and new ones: instructions inside the version's own text, an instruction hidden by a style sheet, a guide that steers toward a match, a page that reflects its query string, and a wrong number whose quote really is on the page.
- A run passes when no known-wrong or adversarial version comes out checked. The share of correct versions that come out checked is reported; the bar is set in the adapter's ticket.
- A change to the check's prompt, model, adapter or schema runs it and lands only after two passing runs on one commit, recorded in the real-data gate, as for the rule summary.
- As built (#330, 2026-11-07): the bar is 3 of the 4 correct cases checked. A run also fails when a wrong or adversarial case lets its target item match, gets no answer from the vendor, or writes a note a page planted; only one correct case may get no answer. The run is capped at 40 calls. A check sends at most `maxCheckPagesText` (200,000) characters of page text, pages kept whole shortest first while they fit and the rest sharing what is left, with at most 12,000 output tokens and 240 seconds a call, and makes no model call when no page was read. A call and its one retry take at most 480 seconds; the workflow function runs at the plan's maximum duration, which `@workflow/nitro` sets for its routes, so a slow check is not cut off by the platform's default. Two passing runs at `4837014` cost about US$0.01 a check (about 3,500 input and 320 output tokens), US$0.18 a run; they are recorded in the real-data gate. The guide comes after the pages in the message, as this ADR orders it. The instructions come first; no cache marker is set, since a check runs at most a few times a day and a cache entry would expire between them.

### Long pages and reasons (amendment, 2026-11-09)

The first day in production left nearly every version flagged, most items at **could not be checked** with no reason a person could act on. A read of the 104 official pages the 31 bundled versions cite, made from an authoring session on 2026-11-08, showed why:

- 27 pages are longer than the 60,000-character cap, some by far (a civil code is over 1,000,000), so the check read only their opening and code refused every match on them;
- 20 pages answer markup with no text, because scripts draw them;
- 10 are PDFs, and 4 answer an access check instead of the page;
- the schema gave the model no way to say why it could not check an item.

Decided:

- **A page is read whole and a long one is sent as an excerpt.** The text cap rises to 3,000,000 characters and the markup cap to the decompressed-size limit. A page of up to 60,000 characters, the old cap, is sent whole, so no page loses the whole reading it had. A longer one is split, in pure code in `packages/domain`, into passages of whole lines that cover it end to end and start at headings, which laws in every language write as short lines; no word of any one language is looked for. A `PassageLocator` port then picks, for each item that cites the page, up to 6 passages from an outline (one line per passage: how it opens and its headings, each on one line and with no bracketed number of its own), given the items and the titles of the version's sources at that URL, which name the articles relied on. Code sends the page's opening, then every item's pick and the passage after each, as verbatim slices in page order with a gap line where text is left out, within an equal share of the check's 200,000 characters and at most 60,000 a page.
- **The locator is a model, not an index.** Its Claude adapter calls `claude-haiku-5-5`, kept in reviewed code, with a closed schema of passage numbers per item key, no tools and no thinking, once per long page, with no retry, for at most 10 long pages a check. Its answer is untrusted: numbers that are not passages of the page are dropped, and all it can do is choose which verbatim passages are sent. When no passage is picked, because the locator failed, did not parse, named none of the page, was not asked, or the budget holds none, the page is sent as its opening with a gap line, marked cut, so no match counts on it and the report is short-lived. Every environment but production uses a scripted locator that picks nothing.
- **A match counts on an excerpt.** The value check is unchanged. A quote counts only within one run of the excerpt, never across a gap line. The prompt tells the model an excerpt is not the whole page: a provision missing from it is **could not be checked**, never **differs**.
- **A table row is one line.** The conversion keeps the cells of a row on the row's line, with a bar between them, so what a fee is for and the fee read as one statement and the digits of two cells never read as one number (a space between digits is a thousands separator to the value check). With each cell on its own line, the evaluation's model kept refusing to quote a fee row it had in front of it.
- **Struck-through text is not page text.** The conversion now drops `del`, `s`, `strike` and text an inline style strikes through. Consolidated laws often keep superseded wording that way beside the new, and before this amendment such pages were cut and could not match. A page that strikes through wording a change not yet in force will replace is read as its future wording alone, so a version written ahead of that change could match early; the version's effective dates and the admin's tap stand against that.
- **Every item that could not be checked says why.** The model gives a note with that status, in Brazilian Portuguese as every note now is, since a report is stored once and the first locale is the admins'. The note filter also drops e-mail addresses, host names in any script and characters that show nothing. Code adds its own reasons for an item that cites no official page (`no_source_cited`) and one none of whose pages was read (`no_page_read`), and the fetch log names a page with no text (`no_text`).
- **A passage must carry the whole item.** The one production match that was read by hand quoted one of the two alternatives its item names; the prompt now says that is not a match.
- The prompt is `rule-check-3`. A report is stored under the check's prompt version and model only, so a change to the locator's prompt or model bumps `rule-check-N` too, which a test pins, and is held to the same two passing runs. The fetch log does not say which pages went as excerpts; its digest is of the text sent.
- **Evaluation:** five cases with an act too long to send whole join the suite: one correct, one wrong, one that still prints the old amount in a schedule far from the section in force, one whose heading tells passage pickers to skip that section, and one whose own source title sends them to the schedule. A sixth new case plants a reassuring note for an item that cannot be confirmed. That makes 24 cases (5 correct, 5 wrong, 14 adversarial); the bar is 4 of the 5 correct ones checked, and a run is capped at 60 calls. A run also fails when a long page was sent cut or without its provision in force, whatever the checker then said, so the locator is judged on its own part, and when the model leaves an item unchecked with no note. A manual `catalog-check` runs the check on the newest version of every bundled route against its live pages and reports matches, reasons and unread pages; it measures and does not gate, is capped at 200 calls, and `all` leaves it out because it costs a few dollars.
- **Cost:** picking is one fast-model call per long page. An outline has at most about 1,500 entries: 20,000 to 100,000 tokens for most laws, a fifth of a cent to a cent at the fast model's list price of US$0.10 per million input tokens, and up to about 150,000 tokens for the largest codes, about eight cents at the US$0.50 that prompts over 100,000 tokens cost (prices read 2026-11-09 from <https://platform.claude.com/docs/en/about-claude/pricing>). The check's own call stays within the same 200,000 characters as before. With at most 10 picks a check, the 20-a-day cap now bounds a bad day at about twenty-five dollars per environment, where this ADR first said ten.
- **Time:** the picks for a check's long pages run together, each at most 90 seconds, before the check's own call and its one retry.

Not decided here, left as could not be checked with its reason shown: PDFs, pages that scripts draw (several of those sites publish the same text through an API on the same official host) and sites that answer an access check.

## Alternatives

| Option | Why not |
| --- | --- |
| Keep the step-up per decision (ADR-0022) | The owner's choice: the prompt adds nothing against the attacker it was for, since signing in is already a passkey |
| One step-up for a batch | Offered to the owner; he chose no prompt |
| A clean report activates a version with no person | Offered; the owner chose to keep one tap. A wrong or tampered official page misleads the check and the rule's author alike, and CLAUDE.md rule 5 keeps a person's approval |
| The admin role in the repository only | Offered; the owner chose to give the role in the app |
| Decisions inserted by `app_api` | Widens who can forge an activation from `app_auth` to the role every request path uses |
| One agent per country | The guide carries what a specialist knows; one check and one prompt keep a single evaluation suite |
| Checking in CI or in an authoring session, with the report committed | A GitHub token holder could then write a clean report; the server's own fetch and the checks in code are what make "clean" mean something |
| Anthropic's server-side web fetch | The quotes could not be checked against text the API itself fetched, and the fetch could not be held to the cited URLs |
| Trusting the model's "matches" without the value check | A true but unrelated sentence from the page would pass; code, not the model, compares numbers (CLAUDE.md rule 3) |
| A report with free text for every item | More room for a page's injected text to steer the admin; only a difference needs explaining. Reversed in part by the long-page amendment: an item that could not be checked with no reason left the admin nothing to act on |
| Embeddings and a vector index (pgvector on Neon) to find a long page's passages | A new vendor for multilingual embeddings, an index to build and keep fresh for pages that are read a few times a month, and similarity search is weakest where a law is most exact: article numbers and amounts. The rule already names the articles it relies on, so a fast model picking from the page's outline finds them with no stored state |
| Picking passages by keywords and numbers in code | The items are in English and the laws are in a dozen languages, so only items with an amount or an age would be found |
| Sending the whole long page to the model | A code of 1,000,000 characters is about 300,000 tokens a check at the strong model's price, and most of it concerns other matters |
| A source locator (article, section) as a field of each source | Sources are part of immutable versions, so every route would need a new version; their titles already carry it for a reader, and the locator reads those |

## Consequences

- Approving the waiting rules becomes one tap for the checked ones and one tap each for the rest, from the phone. Giving someone the admin role is the only passkey prompt left on the knowledge base.
- The checks in code fail safe: a law over the size cap or whose passages could not be picked, an echoed address or a PDF leaves a version flagged, so fewer versions come out checked than a model alone would pass. The evaluation reports how many.
- **Residual risks, accepted:**
  - An open session of an admin can activate a proposed version or reject active ones, with no prompt. A rejection is permanent, so undoing a mass rejection takes new correction versions; an activation is undone by rejecting.
  - A grantee's sessions that are already open become admin sessions when the role is given, so a stolen one gains the role without a new passkey ceremony.
  - New decisions carry no assertion that can be re-verified later: the decision row and the audit event are the record.
  - Taking an account off the owner list does not undo its decisions, activations included; a compromised owner's activations are undone by rejecting each version.
  - A checked version is activated without a person reading it. The checks in code stop invented quotes, echoed addresses and mismatched values, but not a wrong or tampered official page, a model error that pairs the right value with the wrong clause, a version whose own text was written to mislead the model, or a guide merged by a GitHub token holder to steer it. Items with no value to compare (conditions, the leap-day rule, closure, country-set members) rest on the model's reading alone. On a long page the model reads only the passages picked. So a stale version can come out checked when the old wording still stands somewhere on the page, in words that do not mark it superseded, and the pick, steered by the page's text, by the version's own item and source titles or simply mistaken, takes that passage without the provision in force. What stands against it: struck-through text is dropped, the locator is asked for the passage whose heading names the item's subject and for amending passages whatever the source titles say, it can only choose among verbatim passages of that page, the evaluation fails a run in which a long page's provision in force was not sent, and the panel's footer tells the admin that long pages are read in passages. A note is plain text with links, addresses and host names dropped; long digit runs stay, since amounts, dates and law numbers are what a note is for, so the web page turns off the browser's phone-number links (`format-detection`). The evaluation's adversarial cases and the admin's tap are the remaining controls.
  - Whoever writes the production database as `app_jobs` can store a clean report, and as `app_auth` can store a grant or a decision; under threat model R-2 that includes code on a branch that builds a preview. The decision attacker is the one ADR-0022 accepts; the report attacker still needs a bad version merged and an admin's tap.
  - A stolen admin session can spend the daily cap of checks, about ten dollars at most (about twenty-five since the long-page amendment).
  - A granted admin who shares no case with any other admin keeps the role, and no family area shows it, so only a reviewed database change can take it away. Any grant they make still sends the owner-list admins the notice, and the audit log names both accounts.
- CLAUDE.md rule 5 now says an admin approves while signed in, and the glossary replaces Approver and Approver list with Admin and Owner list.

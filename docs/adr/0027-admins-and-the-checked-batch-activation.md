# ADR-0027: Admins decide while signed in, helped by the independent check

- Status: Accepted
- Date: 2026-11-07
- Spec: [#325](https://github.com/fernandolisboa/arca/issues/325)
- Supersedes: [ADR-0022](0022-single-approver-activation.md) for new decisions (its stored decisions keep counting as it says)
- Amends: [ADR-0014](0014-knowledge-base-as-reviewed-data.md) (the independent check: where it runs, what it reads, its report, and what a clean report enables); [ADR-0004](0004-ai-providers-behind-ports.md) (a `RuleChecker` port); [ADR-0010](0010-stack-revised.md) (an HTML-to-text library); CLAUDE.md domain rule 5

## Context

The owner asked on 2026-11-07 why activating a rule asks for a passkey again, and chose, on three decision cards:

1. **An admin role in the app**, given and taken away by an admin, instead of a list of approvers in the repository.
2. **No step-up on a decision**: a signed-in admin activates or rejects with one tap.
3. **An AI analyst checks each rule against its own official sources**, and the rules it finds clean are activated together with one tap by an admin; flagged rules are decided one by one.

Facts behind those choices:

- The step-up proves that a person, not an agent holding the owner's GitHub token, made the decision (ADR-0014). Signing in already takes a passkey, and no agent holds an app session, so a signed-in admin proves the same thing for the attacker the step-up was for.
- ADR-0022 already accepts that whoever can write the production database can forge a decision; the step-up never protected against that attacker.
- The route versions seeded so far (more than twenty files) wait for activation, one passkey prompt each. The owner trusts a careful model check over his own reading for this kind of repetitive comparison, and wants his attention only where the check fails.
- The independent check was specified in ADR-0014 and never built, for lack of an API budget. The owner's Ultra credit now pays for in-app model calls ([ADR-0025](0025-rule-summary-for-the-approver.md)).
- No Claude skill covers immigration law per country (checked 2026-11-03). ADR-0014's country guide is the per-country specialist: one check agent loads the guide of the version's country.

## Decision

### Admins

- An **admin** may activate and reject knowledge-base versions and give or take away the admin role. The role is global, never per case, and grants no access to any case's data.
- The **owner list** in the repository (today's approver list, renamed) names the accounts that are always admins, per environment. It still changes only by a reviewed pull request, and an owner-list admin cannot lose the role in the app. It is how the first admin exists.
- Any other admin holds a **grant** stored in the database. An admin gives the role to an account that shares a case with them, from the family area, and takes it away the same way. Giving it needs a step-up, since it hands someone the power to put rules into use; it happens once per person. Taking it away needs none. Each change writes an audit event naming both accounts.
- The approver list's other uses (the rule summary, rule reports, the activation screen) follow the admin role.

### Decisions without a step-up

- A signed-in admin activates or rejects a version with one request. The API checks the role and stores the decision in one transaction, so a decision is stored only while its author is an admin; a decision keeps counting after its author loses the role.
- The decision routes keep the API's same-origin check on every state-changing request (the `Origin` header or `Sec-Fetch-Site`), so another site cannot make an admin's browser decide.
- New decision rows record that their proof is the session. Rows stored under ADR-0022 keep their step-up and are re-verified exactly as before; nothing already stored changes. The step-up purpose `knowledge_decision` is no longer offered.
- Faults still fail closed in one direction only: a rejection always counts, so a fault or a forged row can only take a rule out of use, as ADR-0022 says.

### The independent check

It is ADR-0014's check, now built, with these choices:

- **What it checks:** route versions only. A comparison version's values come from a statistics API, not from law text, so it is still decided on its own.
- **When it runs:** when an admin lists the versions, the API starts a check for each proposed route version that has no current report and no check running, within the daily cap. A report is current when its content hash, the country guide's hash, the prompt version and the model all match. Nothing runs for active or rejected versions.
- **Where it runs:** a Vercel Workflow in São Paulo with one step, whose input is the route ID and version number only ([ADR-0009](0009-background-jobs-guarantees.md)). The step fetches, calls the model, checks the answer and stores the report, so no page text or model output becomes a step input or output.
- **What it fetches:** the version's cited sources only, over `https`, when the host is on one of the version's pinned official-domain lists. Every redirect hop must stay on those hosts. No cookies or credentials; each host is resolved and refused when it is loopback, private, link-local or a metadata address, and the connection goes to the address checked; limits on size, time and redirects. HTML becomes plain text through a maintained HTML-to-text library, the one dependency this ADR adds. A PDF, another content type or a failed fetch makes the items that rely on it **could not be checked**; PDF reading may come later.
- **What the model reads:** the version laid out as the approver's view already lays it out for the rule summary (no hash, no state), the list of items the API enumerates from it (each requirement, assessment, dependent rule, cost and duration, by key), the country guide when one exists, and each page's text inside its own delimited data block with its URL. Everything is framed as data. No case data, so no exception to minimization.
- **What it answers:** a closed schema with one entry per enumerated item: a status (**matches**, **differs** or **could not be checked**), and, except for the last, a quote from a page and that page's URL. A **differs** entry may carry one short plain-text note on what differs; it is the only free text, because a flagged item is exactly what a person reads next. No recommendation, no verdict on the rule.
- **Checked in code:** each quote must be a verbatim, length-limited substring of the text fetched from the URL it names in the same run, after whitespace is normalized; otherwise the item becomes could not be checked. An item the model leaves out is could not be checked. A version is **clean** when every item matches; code decides that, not the model.
- **Stored:** one row per route ID, version number, content hash, guide hash, prompt version and model, with the items and the fetch log (URL, status, time, SHA-256 of the text, whether it was cut). It is public rule data with no account, unowned in the personal-data registry; `app_api` may read and insert, never update or delete. A failed run stores nothing and the next list starts it again, within the cap.
- **Model and cost:** a `RuleChecker` port with a Claude adapter on the shared call shape (no tools, no SDK retries, one retry on an unparsable answer). The model is kept in reviewed code; it starts as `claude-sonnet-5-5`, a strong model that differs from the one the authoring sessions write rules with, and a change of model runs the evaluation first. The guide and instructions come first in the prompt so they can be cached. At most 20 checks a day per environment; a check is one or two calls. Long laws are the cost driver, so the page text sent is capped and a cut page is recorded as cut. A check costs roughly ten to fifty U.S. cents and runs once per version.
- **Shown apart, as ADR-0014 says:** the activation screen shows each version's check status in the list and the report in its own panel, labelled as written by a model, with quotes and URLs as plain text. A stale or missing report shows as such; could not be checked never reads as passed. The report is never part of the content hash.
- **A difference opens no research task yet**: no research agent exists. The admin rejects the version or asks for a correction, which is written in an authoring session like any rule.

### Country guides

- One file per country and version under the knowledge data, immutable and hashed like other knowledge files: the laws and regulations that govern the country's routes (each with a URL on a pinned official-domain list), how they are usually amended, and known pitfalls. A guide never widens what counts as official and is never a source.
- A guide is a trust root: it lands in its own pull request, like an official-domain list, and needs no activation. A check runs with no guide when the country has none, and the panel says so.

### Activating the checked versions together

- The activation screen offers one action for every proposed route version whose current report is clean. The client sends the identities (route, number, content hash) it showed; the server activates only those that are still proposed, still clean under a current report and still match the bundled hash, and answers which were activated and which were skipped. Each activation is its own decision row and audit event.
- A flagged version, a version without a current report and every comparison version are decided one at a time, as before.

## Alternatives

| Option | Why not |
| --- | --- |
| Keep the step-up per decision (ADR-0022) | The owner's choice: the prompt adds nothing against the attacker it was for, since signing in is already a passkey |
| One step-up for a batch | Offered to the owner; he chose no prompt |
| A clean report activates a version with no person | Offered; the owner chose to keep one tap. A wrong or tampered official page misleads the check and the rule's author alike, and CLAUDE.md rule 5 keeps a person's approval |
| The admin role in the repository only | Offered; the owner chose to give the role in the app |
| One agent per country | The guide carries what a specialist knows; one agent and one prompt keep a single evaluation suite |
| Checking in CI or in an authoring session, with the report committed | A GitHub token holder could then write a clean report and have a bad rule activated in a batch; the server's fetch log and quote check are what make "clean" mean something |
| Anthropic's server-side web fetch | The quotes could not be checked against text the API itself fetched, and the fetch could not be held to the cited URLs |
| A report with free text for every item | More room for a page's injected text to steer the admin; only a difference needs explaining |

## Consequences

- Approving the waiting rules becomes one tap for the clean ones and one tap each for the rest, from the phone. Granting the role is the only passkey prompt left on the knowledge base.
- **Residual risk, accepted:** an open session of an admin can decide; whoever steals one can activate a proposed version, as ADR-0022 already accepts for a database writer. Rejection undoes it at once. A clean report is only as good as the official page it read: a wrong or tampered page passes the check, which is why a person still taps.
- Whoever can write the production database can grant the role or store a report; that attacker can already forge a decision (ADR-0022), so no new class of attacker appears.
- CLAUDE.md rule 5 now says an admin approves while signed in, and the glossary replaces Approver and Approver list with Admin and Owner list.
- Every change to the check's prompt, model, adapter or schema runs its evaluation (known-wrong versions it must flag, correct ones it must pass, and adversarial pages) and lands only after two passing runs on one commit, recorded in the real-data gate, as for the rule summary.

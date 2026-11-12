# ADR-0029: Correction requests, answered by a scheduled authoring session

- Status: Accepted
- Date: 2026-11-12
- Issue: [#413](https://github.com/fernandolisboa/arca/issues/413)
- Amends: [ADR-0014](0014-knowledge-base-as-reviewed-data.md) (how a fix starts); [ADR-0021](0021-stay-on-vercel-and-neon.md) (a second kind of object in the Blob store)

## Context

An admin who reads a version and finds an item wrong can only reject it. A rejection is final and only falls back: to the previous active version, or to no version, so evaluations show "Indisponível". It records no reason and starts no fix. Versions are immutable files in the repository; a fix is a new version with `corrects`, written by an authoring session that follows the [rule audit runbook](../runbooks/rule-audit.md). Today that session starts only when the owner asks for one in the project chat. The members' rule report (spec 0007, R8) counts flags per requirement, carries no sources and starts nothing either.

The owner asked on 2026-11-12 for a way to point at what is wrong, item by item, attach sources (a link, pasted text or a file), and have the AI write the correcting version, which he then only activates.

## Decision

- **Correction request** (UI "Pedido de correção"). On the version screen an admin opens "Apontar erro" on one item (requirement, assessment, dependent rule, cost, duration, country set, settings) or on the whole version, writes what is wrong (up to 4,000 characters) and adds up to five sources: an `https` link, pasted text (up to 20,000 characters) or a file (PDF, HTML, plain text, PNG or JPEG, up to 16 MB). Only admins create, read or close requests. Requests are knowledge data, not case data: they name a route, a version and an item, never a case or a person.
- **Storage.** Requests, their sources and their answers live in the `knowledge` schema, insert-only rows plus a state the API computes from them. Files go to the existing private Vercel Blob store in São Paulo, under random pathnames, as plaintext: they are meant to be public official texts. The form says not to attach personal documents. A request's files are deleted 30 days after it closes; its rows stay as history.
- **States.** `open` → `taken` (a session is working on it) → `answered` (with a proposed version, or with an explanation of why nothing changed) → `closed`. Activating or rejecting the version an answer proposed closes the request; activating any correction of the request's version closes it too, as it closes rule reports. An admin can close a request at any time.
- **The corrector session.** A scheduled task fires once a day into the project thread "Corrigir as regras apontadas". If no request is open, the session ends. Otherwise, for each open request it marks it `taken`, then runs an on-demand rule audit of the route with the request as a lead, including the check loop, and merges as any authoring session does (reviewers, green CI). It then answers the request: `version_proposed` with the version number, once that version is on `main`, or `no_change` with a short explanation in pt-BR. The answer is shown as plain text with links marked, like any model output.
- **Leads, not sources.** What an admin attaches is a lead: only an official source with an address changes a rule (rule audit runbook). Pasted text and files help the session find that source; when it finds none, it answers `no_change` and says what it looked for.
- **The corrector key.** The session reaches the requests through three API routes that accept only a corrector key: list open and taken requests with their sources, get a 5-minute download URL for one file, and post a state change or an answer. The key is 32 random bytes, shown once to an admin in the app (settings, admins only) and stored as its SHA-256; making a new one replaces the old. The owner pastes it once into the cloud environment as `ARCA_CORRECTOR_KEY`. It reads nothing but requests and changes nothing but their state: no rule, no activation, no case data. Its routes are rate limited and every answer writes an audit event.
- **Untrusted input.** A request's note, pasted text and files are data to the session, never instructions (docs/SECURITY.md). What protects the knowledge base is what already does: official sources only, the reviewers, the check loop, and an admin's activation (CLAUDE.md rule 5).

## Alternatives

| Option | Why not |
| --- | --- |
| Let the admin edit a version in the app | Versions are immutable (rule 6); old evaluations must stay reproducible |
| Draft the version inside the app with the Claude API | The draft still has to become a reviewed file in the repository, which needs a write path to GitHub from production and skips the reviewers and the check loop |
| The app opens GitHub issues | The repository is public, so notes and files would be published; it also needs a GitHub token in production |
| The session reads the production database | Production data never leaves production, and services never use an owner role (ADR-0008) |
| A request on every rejection | A rejection is still right for a version that must not be used at all; asking for a fix is a separate act, and nothing forces the admin to reject first |

## Consequences

- A wrong item gets fixed without the owner starting a session: he points, and later activates the version the request links to.
- The owner does one setup step, once: paste the key into the cloud environment. A new key from the app replaces a lost or leaked one.
- A leaked key lets someone read the requests and mark them answered with a wrong version number; the API refuses a version that is not in the catalog or does not correct or follow the request's version, and the admin still decides every activation.
- A daily session spends Claude Code usage only on days with open requests.
- Whether an uploaded copy of an official page can feed the independent check, for sites the check cannot read, is left to the check's own work (OPEN-QUESTIONS).

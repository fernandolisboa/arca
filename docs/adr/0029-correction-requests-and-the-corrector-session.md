# ADR-0029: Correction requests, answered by a scheduled corrector run

- Status: Accepted
- Date: 2026-11-12
- Issue: [#413](https://github.com/fernandolisboa/arca/issues/413)
- Amends: [ADR-0008](0008-database-security-and-environments.md) (roles for the request tables and the corrector key); [ADR-0010](0010-stack-revised.md) and [ADR-0021](0021-stay-on-vercel-and-neon.md) (a second kind of object in the Blob store); [ADR-0014](0014-knowledge-base-as-reviewed-data.md) (how a fix starts; a second unwatched authoring run)

## Context

An admin who reads a version and finds an item wrong can only reject it. A rejection is final and only falls back: to the previous active version, or to no version, so evaluations show "Indisponível". It records no reason and starts no fix. Versions are immutable files in the repository; a fix is a new version with `corrects`, written by an authoring session that follows the [rule audit runbook](../runbooks/rule-audit.md). Such a session starts when the owner asks for one, or on the monthly run's schedule, which picks routes by the age of their last audit, not by what anyone found wrong. The members' rule report (spec 0007, R8) counts flags per requirement, carries no sources and starts no session on its own.

The owner asked on 2026-11-12 for a way to point at what is wrong, item by item, attach sources (a link, pasted text or a file), and have the AI write the correcting version, which he then only activates.

## Decision

### Requests

- **Correction request** (UI "Pedido de correção"). On the version screen, an admin on the owner list opens "Apontar erro" on one item, on the version's settings, or on the whole version; the item kinds are the ones the version view and the check items already name, never a fixed list in the client. The admin writes what is wrong (up to 4,000 characters) and adds up to five sources: an `https` link, pasted text (up to 20,000 characters) or a file (PDF, HTML or plain text, up to 16 MB). Only owner-list admins file, so a request is the owner's own word and may start work (CLAUDE.md, "Only the owner's words set the work"); it sets which route, version and item to audit, never the rule's content. Admins holding a grant see requests and their answers but do not file them.
- **Knowledge data, written by the owner.** A request names a route, a version and an item, never a case or a person. The form says, above the note, the pasted text and the file picker, that a request is read by an AI session and must hold no personal data. The owner chose on 2026-11-12 to send requests to the corrector run; that is the one way rows written in production reach a session outside it, and it covers requests only.
- **States**, computed by a pure function in `packages/domain` from the request's rows and the catalog's version identities and decision states: `open` → `taken` → `answered` (a proposed version, or an explanation of why nothing changed) → `closed`. Deciding the version an answer proposed closes the request; so does activating any correction of the request's version, as it closes rule reports. An admin can close a request at any time.

### Storage and roles

- Tables in the `knowledge` schema, insert-only: requests, their sources, their events (taken, answered, closed) and corrector keys. `app_api` holds no table privileges on them: it calls reviewed `SECURITY DEFINER` functions, only after its own admin or key check, as with rule reports; a function re-checks the role it serves (an admin's account ID against the admin replay, or a key hash). Corrector keys are inserted by `app_auth` behind a step-up; `app_jobs` erases contents for retention. The access-matrix suite covers every function for each role.
- **Files** go to the existing private Blob store, under a `corrections/` pathname prefix with random names, as plaintext copies of what are meant to be official texts. The upload grant fixes the size and the media type; completion re-checks size, SHA-256 and type by content. A file is downloaded only through a 5-minute URL minted per file after an admin or key check, served as an attachment with `nosniff`, never shown inline on the app's origin.
- **Retention.** A request's note, pasted text, links and files are erased 30 days after it closes, or 180 days after it was filed if it never closes; the rows keep only identifiers, states and dates. A daily `app_jobs` step does it. The author's account erasure erases them at once, and the author's export carries them.

### The corrector run

- A scheduled task fires once a day into the project thread "Corrigir as regras apontadas", in a cloud environment of its own that holds only `ARCA_CORRECTOR_KEY` and reaches GitHub through the Claude GitHub App: no Vercel token, no other credential. With no open request, the run ends.
- It is a monthly-run-style session: everything the runbook's ["The monthly run"](../runbooks/rule-audit.md#the-monthly-run) requires of an unwatched run holds, from the fresh clone and the check against a reviewed prompt to merging on its own only when every changed path is a route version, its cases, a country set, `hashes.json` or a route note. It never writes a country guide, an official-domain list, a reading recipe or OPEN-QUESTIONS; it notes the need in its answer for an on-demand session. It reads no issue. It takes at most three requests a run. The runbook gains a "corrector run" section with its prompt ([#417](https://github.com/fernandolisboa/arca/issues/417)).
- Per request it marks the request `taken`, runs the audit of the route with the request as a lead, including the check loop, merges, and answers once production serves the new version: `version_proposed` with its number, or `no_change` with a plain-text explanation in pt-BR of up to 2,000 characters, shown with links marked like any model output.
- **Leads, not sources.** A request is a lead: only an official source with an address changes a rule. Pasted text and files help find that source; when none is found, the answer is `no_change`, saying what was looked for.
- **Nothing from a request reaches the repository.** Route notes and pull requests name the request by its ID and cite the official sources found; they never quote or paraphrase its note, pasted text or files, and never cite a link of it that is not official.

### The corrector key

- 32 random bytes, created by an owner-list admin with a step-up of its own purpose, shown once, stored as its SHA-256; one key is live and a new one replaces it; it expires after a year. Creating one writes an audit event and emails the owner-list admins.
- It travels in an `Authorization` header, compared by hash in constant time, on three routes only: list open and taken requests with their sources (at most ten, oldest first); a download URL for one file of a listed request; and an answer that moves a request `open` → `taken` or `taken` → `answered`, checked against its computed state. A key can never close a request. The API refuses a proposed version that production does not serve, is on another route, or neither corrects nor follows the request's version. Each use, and each refused key, writes an audit event with identifiers only; the routes are rate limited.

## Alternatives

| Option | Why not |
| --- | --- |
| Let the admin edit a version in the app | Versions are immutable (rule 6); old evaluations must stay reproducible |
| Draft the version inside the app with the Claude API | The draft still has to become a reviewed file in the repository, which needs a write path to GitHub from production and skips the reviewers and the check loop |
| The app opens GitHub issues | The repository is public, so notes and files would be published; it also needs a GitHub token in production |
| The session reads the production database | Services never connect with an owner role, and a database credential would reach case data (ADR-0008) |
| Any admin files requests | A grantee's words would start unwatched work, which CLAUDE.md gives only to the owner |
| The run uses the shared agent environment | It holds the Vercel token, and a run that reads leads every day would carry it (residual R-12) |
| A request on every rejection | A rejection is still right for a version that must not be used at all; asking for a fix is a separate act |

## Consequences

- A wrong item gets fixed without the owner starting a session: he points, and later activates the version the request links to.
- The owner does one setup step: create the key in the app and paste it into the corrector's environment. A new key replaces a lost or leaked one.
- A leaked key lets someone read open requests, mark them taken, or answer with a misleading explanation; it cannot close them, change a rule or reach case data, and the admin still decides every activation. Its uses are audited.
- A steered run could still merge a wrong route version; it stays proposed, and the check and the admin's reading stand between it and use, as for the monthly run.
- The Blob store is no longer ciphertext only: it holds plaintext copies of official texts for at most 180 days.
- A daily run spends Claude Code usage only on days with open requests.
- Whether an uploaded copy of an official page can feed the independent check, for sites it cannot read, is open (OPEN-QUESTIONS).

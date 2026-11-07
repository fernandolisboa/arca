# Roadmap

Family first: the product for other families starts only after the founder's family has succeeded using the app. Platforms follow [ADR-0005](adr/0005-platform-strategy.md): web first, then Android, then iOS and iPadOS, then desktop if its gate passes. Every platform is planned now; the foundations they need are built in Phase 1.

| Phase | Platform | Focus | Gate to the next phase |
| --- | --- | --- | --- |
| 0. Discovery (now) | — | Understand case 1, research routes for the knowledge base, confirm stack and domain | Routes chosen for each unit |
| 1. Family MVP | Web PWA | The consultancy core, plus cross-platform foundations | All six people using it |
| 2. Execution | Web PWA | Carry the plan through | It worked for the family |
| 3. Product | Web PWA | Other families | Paying families active; web stable |
| 4. Android | Android | Native app on Google Play | Released to production on Play |
| 5. Apple | iOS and iPadOS | Universal native app on the App Store | Approved and released |
| 6. Desktop (optional) | Windows, macOS, Linux | Native desktop app, only if the gate passes | — |

## Phase 0 — Discovery

- Case 1 facts gathered; ancestry of all six adults mapped.
- Route catalog researched for the countries the family selects.
- ~~Stack confirmed~~ Done: [ADR-0010](adr/0010-stack-revised.md) (superseding ADR-0003), with auth ([ADR-0006](adr/0006-auth.md)), background jobs ([ADR-0009](adr/0009-background-jobs-guarantees.md), superseding ADR-0007), reviewers in CI ([ADR-0011](adr/0011-reviewers-in-ci.md), superseded by [ADR-0019](adr/0019-reviewers-in-the-authoring-session.md)), automation-first setup ([ADR-0012](adr/0012-automation-first-setup.md)) and database security and environments ([ADR-0008](adr/0008-database-security-and-environments.md)).
- Production host `arca.filx.app` set (done 2026-11-03) and the Resend sending domain `filx.app` verified (passkeys depend on the host from day one; production stays closed until email works; [ADR-0015](adr/0015-identity-enrollment-step-up-and-recovery.md)).

Domain-only Phase 1 code (consultancy core, slice 1) runs in parallel with Phase 0, since it needs neither real route data nor case data. The research in [research/](research/) feeds the knowledge seed of Phase 1 (consultancy core, slice 2), where each rule is re-verified against an official source. Phase 0 does not depend on code: the questions in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) can be answered while the repository is set up.

## Phase 1 — Family MVP (web)

**Epic: cross-platform foundations** (done before any feature that touches case data, identity or AI, so native phases add adapters instead of rewrites)

- Specified in five slices: [0001 scaffold](specs/0001-foundations-scaffold.md); [0006 design system and theming](specs/0006-design-system-and-theming.md); [0003 identity and access](specs/0003-identity-and-access.md); [0004 real-data readiness](specs/0004-real-data-readiness.md), which ends with the real-data gate production must pass before family data enters; [0005 vault, device capabilities and notifications](specs/0005-vault-devices-and-notifications.md).
- Monorepo with `packages/domain`, `packages/api-contract`, `packages/ui`, `packages/i18n`, `packages/platform`, `apps/api`, `apps/web` ([ARCHITECTURE.md](ARCHITECTURE.md#platforms-and-code-layout)).
- Empty app deployed end to end (web, API, a sample workflow, database) in São Paulo, with protected preview deployments per pull request.
- Environments per [ADR-0008](adr/0008-database-security-and-environments.md) and [ADR-0012](adr/0012-automation-first-setup.md): a production Neon branch that previews stop forking from before any family data exists, synthetic seed for everything else, secrets per environment.
- Database roles, forced row-level security and the access-matrix suite in CI before the first table with case data.
- Supply-chain controls in CI from the first commit (pinned actions, advisories, secret scanning, SBOM, pnpm install-script and release-age settings).
- Observability with personal data scrubbing: structured logs from the first deploy; Sentry errors and traces before real data; Langfuse when the owner asks for it ([ADR-0016](adr/0016-observability-and-scrubbing.md), [ADR-0023](adr/0023-free-text-intake-sends-the-writers-own-words.md), [ADR-0025](adr/0025-rule-summary-for-the-approver.md)).
- ~~Vault encryption ADR written and reviewed before any document upload is built.~~ Written: [ADR-0018](adr/0018-vault-encryption.md).
- Before real family data enters: in-app account deletion and data export, retention periods ([RETENTION.md](RETENTION.md)), incident response runbook, backups on Neon, threat model for the epic ([ADR-0017](adr/0017-data-lifecycle-and-backups.md), [ADR-0021](adr/0021-stay-on-vercel-and-neon.md), spec 0004).
- Client builds to a static bundle; no server-rendering dependency.
- Versioned typed API; every feature goes through it.
- Passkeys on the production host, invite-only enrollment, purpose-bound step-up (which knowledge-base decisions use, [ADR-0014](adr/0014-knowledge-base-as-reviewed-data.md)) and recovery ([ADR-0015](adr/0015-identity-enrollment-step-up-and-recovery.md)); cookie sessions on the web. Secure-storage tokens for native apps come with Phase 4; nothing in the design blocks them.
- `platform` port with web adapters: passkeys, vault envelopes, camera capture, file picking, notifications, secure key storage, sharing, receiving shared files, deep links.
- Notification service with per-device channels (web push first).
- Vault encryption format documented and platform-neutral; key recovery designed and tested.
- Responsive, touch-first layouts from phone to tablet to desktop, safe-area aware, with the themes and navigation layouts of [spec 0006](specs/0006-design-system-and-theming.md).
- CI running unit tests, and the synthetic AI evaluation run by hand from a manual workflow (the `intake-eval` workflow for free-text intake and the rule summary), never as a required check; the multi-reviewer pass runs in the authoring session ([ADR-0019](adr/0019-reviewers-in-the-authoring-session.md)).

**Epic: consultancy core** (slices and dependencies in [specs/0002-rules-engine-and-knowledge-base.md](specs/0002-rules-engine-and-knowledge-base.md#the-epic-consultancy-core); the case model and intake wait for the foundations' identity and data-protection work above)

- Rules engine and knowledge base, specified in [specs/0002-rules-engine-and-knowledge-base.md](specs/0002-rules-engine-and-knowledge-base.md), with the knowledge base as reviewed data activated by the owner's passkey ([ADR-0014](adr/0014-knowledge-base-as-reviewed-data.md)).
- Knowledge seed for the first countries, from official sources.
- Case model with guided questions first, then AI intake from free text ([spec 0007](specs/0007-case-model-and-guided-intake.md), [spec 0008](specs/0008-free-text-intake.md)), with playback and correction; who sees what, per person; audit log.
- Destination comparison weighted by each person ([#310](https://github.com/fernandolisboa/arca/issues/310), [ADR-0026](adr/0026-destination-comparison-data.md)).
- Strategy recommendation with alternatives, pros, cons, risks, cost and time.
- Personalized document checklist.
- Step-by-step plan with execution modes and action points.
- On-call assistant with cited sources.
- Assets, tax and FX simulator; source-of-funds trail.

**Epic: family area and guidance** ([#117](https://github.com/fernandolisboa/arca/issues/117); each item lands in the consultancy core slice or foundations spec it names)

- Family area: the people in the case, who has an account, invites (slice 3).
- A trusted adult uploads documents for another person, by that person's permission; an account holder holds the documents of a case person without an account, such as a child (slice 3 and the vault; needs an ADR-0018 amendment on who owns such an upload first, [#119](https://github.com/fernandolisboa/arca/issues/119)).
- Sharing an analysis with chosen people in the case, so each starts their own checklist; relatives join through the family area first (slice 4).
- Progress per person and for the whole family, computed in code; each person's bar is visible to those they share it with, and the family bar counts only what the viewer may see (slice 5).
- Steps marked as doable online, with the official link, sourced like any knowledge fact, for the country that issues each document (most often Brazil) as well as the destination (slice 5 and the knowledge base).
- Guided tour of the app and a hint per screen, using the CoachMark pattern of [spec 0006](specs/0006-design-system-and-theming.md), after the first screens of slice 3; separate from Phase 3's onboarding of new families.
- Setup guide for every key and secret the project owner manages (`docs/SETUP.md`): names, where each lives, who creates it and how to rotate it, never values; links to ADR-0012 instead of repeating it.

## Phase 2 — Execution (web)

Document review; form drafts; writing (letters, business plan, source of funds); interview practice by voice; tracking and the rule watcher; arrival and settling checklists; partner network.

## Phase 3 — Product (web)

Multi-family accounts, guided onboarding, billing, expanded catalog, self-help positioning (immigration legal advice is restricted in several destinations), public marketing site as a separate project, public legal pages (privacy policy, terms), external penetration test before opening to other families.

## Phase 4 — Android

- Capacitor Android project wrapping the web client.
- Android adapters for the `platform` port: ML Kit document scanner, Android Keystore with biometric unlock, FCM push, share-sheet target, App Links on the production host, passkeys through Credential Manager with Digital Asset Links.
- Bearer sessions for the native app (Better Auth bearer plugin), with the token in the Keystore and the Capacitor origin on the CORS allow-list ([ADR-0015](adr/0015-identity-enrollment-step-up-and-recovery.md)).
- Native polish: splash screen, offline screens, back-button behavior, in-app browser for external links.
- Release pipeline: signed builds in CI, crash reporting with personal data scrubbed.
- Play listing in pt-BR, Data safety form, content rating.
- **Long pole:** personal developer accounts created after 2023-11-13 need a closed test with at least 12 testers opted in for 14 consecutive days before production ([Google Play Console Help](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB)). Start closed testing as soon as the first build runs, or publish from an organization account.

## Phase 5 — iOS and iPadOS

- Capacitor iOS project wrapping the same client; one universal app for iPhone and iPad.
- iOS adapters: VisionKit document scanner, Keychain and Secure Enclave with Face ID or Touch ID, APNs push, share extension, Universal Links, passkeys through Associated Domains.
- A native layer that clears App Store Review Guideline 4.2 (apps must go "beyond a repackaged website"): native-feeling navigation, push, scanner, biometrics, sharing, offline screens.
- iPad layouts reviewed (split view, larger canvases) and iPad screenshots for the listing.
- Builds on macOS with Xcode or a cloud build service; TestFlight beta with the family.
- App Store listing in pt-BR, privacy labels, in-app account deletion.

## Phase 6 — Desktop (optional)

**Go/no-go gate.** Build only if usage shows a need the installed PWA does not meet, for example: syncing documents with a local folder, an offline vault, OS keychain integration, or organizations that need managed installs. Otherwise, record the decision not to build and close the phase.

If go: Tauri wrapping the same client; Tauri adapters for the `platform` port; signed installers (Windows code signing, macOS notarization), auto-update, and distribution.

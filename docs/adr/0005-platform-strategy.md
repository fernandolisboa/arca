# ADR-0005: Platform strategy — web first, then Android, Apple and desktop

- Status: Accepted; native bearer sessions moved to Phase 4 by [ADR-0015](0015-identity-enrollment-step-up-and-recovery.md)
- Date: 2026-11-01

## Context

Arca will run on the web, Android, iPhone and iPad, and possibly desktop. The founder wants every platform planned from the start, even if built last, so that early choices do not force a rewrite.

What each platform adds for Arca:

- **Web (installable PWA):** no install friction for any family member; one link; instant updates. Camera, microphone, passkeys, client-side encryption and web push all work in the browser (on iPhone, push requires adding the app to the home screen).
- **Native mobile:** the system document scanner (VisionKit on iOS, ML Kit on Android), keys held in the secure enclave or keystore behind biometrics, more reliable push on iOS, receiving files from the share sheet, and store presence for trust once Arca serves other families.
- **Desktop:** little for Arca's core, since data must sync across people and AI runs in the cloud. An installed PWA already gives a desktop app experience. Kept as an option, decided by a gate.

## Decision

### Order

1. **Web PWA**, mobile-first and responsive from phone to desktop. Carries Phases 1 to 3.
2. **Android** app.
3. **iOS and iPadOS** app (one universal app covers iPhone and iPad).
4. **Desktop** app, only if the go/no-go gate passes (see [ROADMAP.md](../ROADMAP.md)).

### One client, wrapped per platform

- The client is a single TypeScript single-page application that builds to a static bundle and talks to the backend only through a versioned, typed API.
- Android and iOS wrap that client with **Capacitor**, adding native capabilities through plugins.
- Desktop, if built, wraps the same client with **Tauri**.
- Native capabilities sit behind a `platform` port with one adapter per runtime (web, Capacitor, Tauri). UI code asks the port what is available; it never branches on the operating system.

### Built in Phase 1 so nothing blocks the native phases

- Monorepo layout with a pure domain package, an API contract package and a portable client ([ARCHITECTURE.md](../ARCHITECTURE.md#platforms-and-code-layout)).
- Passkeys scoped to the production host from day one (amended by [ADR-0015](0015-identity-enrollment-step-up-and-recovery.md): for now the project's `vercel.app` host). Native apps reuse the same passkeys through Digital Asset Links (Android) and Associated Domains (iOS), calling native passkey APIs through the `platform` port, because WebAuthn inside the WebView runs on a `localhost` origin ([ADR-0006](0006-auth.md)). Changing the domain later would invalidate every passkey.
- Authentication that supports both cookie sessions (web) and tokens kept in secure storage (native).
- Notification service with one channel per device type: web push now, FCM and APNs later.
- Deep links that use the same URL paths as the web app.
- A documented, platform-neutral encryption format for the vault, plus key recovery, so native keystores can later wrap the same keys.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Next.js with server rendering and Server Actions | Server-side logic does not travel into Capacitor or Tauri bundles; static export removes most of what Next.js offers. A logged-in app gains nothing from SEO. A public marketing site can be a separate project in Phase 3 |
| React Native (Expo) for mobile, separate web UI | Best native feel, but two UI codebases to build and maintain |
| Expo universal app (web, Android, iOS from one React Native codebase) | Web becomes a second-class target while it is the primary platform for three phases |
| Native apps in Kotlin and Swift | Three codebases; not justified for a forms-, documents- and guidance-heavy app |

## Consequences

- One UI codebase serves four platforms; native phases add adapters, store work and native polish, not a rewrite.
- Apple rejects apps that are a repackaged website (App Store Review Guideline 4.2, "features, content, and UI that elevate it beyond a repackaged website"). The iOS phase must add a native layer: native-feeling navigation, push, share sheet, document scanner, biometrics, offline screens.
- Google Play requires personal developer accounts created after 2023-11-13 to run a closed test with at least 12 testers opted in for 14 consecutive days before production. The Android phase starts closed testing early, or publishes from an organization account.
- iOS builds need macOS with Xcode or a cloud build service, since development happens on Windows/WSL.
- The document scanner, secure storage and biometrics plugins are chosen at the start of the Android phase; some are paid.

## Sources

- [Google Play Console Help: testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB) (checked 2026-11-01)
- [MobiLoud: App Store guidelines for webview apps](https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper) (checked 2026-11-01)
- [web.dev: Manage passkeys across multiple domains and apps with RP ID](https://web.dev/articles/webauthn-rp-id) (checked 2026-11-01)
- [Capawesome: Capacitor Document Scanner](https://capawesome.io/docs/sdks/capacitor/document-scanner/) — ML Kit on Android, VisionKit on iOS; paid (checked 2026-11-01)

# Spec 0005: Vault, device capabilities and notifications

- Status: Ready for tickets
- Date: 2026-11-02
- Epic: cross-platform foundations ([ROADMAP.md](../ROADMAP.md#phase-1--family-mvp-web)), after [spec 0003](0003-identity-and-access.md)
- Decisions: [ADR-0018](../adr/0018-vault-encryption.md), [ADR-0005](../adr/0005-platform-strategy.md), [ADR-0008](../adr/0008-database-security-and-environments.md) (field encryption), [ADR-0017](../adr/0017-data-lifecycle-and-backups.md) (registry, backups), [ADR-0009](../adr/0009-background-jobs-guarantees.md)

## Goal

The pieces that native phases will only add adapters to: an encrypted document vault with a documented, platform-neutral format and tested recovery; KMS field encryption ready for the first sensitive field; the `platform` port with web adapters and a conformance suite; and a notification service with per-device channels, web push first.

## Scope

**In:** `packages/vault`; vault identity, envelopes, unlock and recovery; document storage as ciphertext in S3; sharing, revocation and rotation; the AWS application account; field encryption; `platform` capabilities with web adapters; notifications through web push and email.

**Out:** document review, OCR and the `DocumentReader` adapter (Phase 2), but the processing path is fixed by ADR-0018; any document type catalog (data, with the consultancy core); native adapters (Phases 4 to 6).

**Not on the critical path of the consultancy core's case model**, which stores no documents. The vault must exist before any document upload is built; notifications before the plan sends reminders.

## Requirements

### R1. Vault core

- New package `packages/vault`, pure TypeScript with no workspace dependencies and no platform calls (boundary matrix: `apps/web` may depend on it; the API never decrypts and does not depend on it). It wraps `age-encryption` (newest release at least 7 days old; 0.3.x as of 2026-11-02), added to the Versions table with a supply-chain PASS.
- API: generate a hybrid identity; encrypt and decrypt documents as streams to a recipient set; seal and open an identity envelope with an injected age recipient or identity (passkey PRF from the platform port, or the scrypt recovery secret); re-encrypt to a new recipient set.
- The C2SP age test vectors run in CI against the package. Round-trip, multi-recipient, revocation, rotation and wrong-key tests are table-driven.
- The format is documented in `docs/vault-format.md`: file layout (plain age), recipient types, envelope kinds, how native apps reproduce each with other age implementations.

### R2. Vault identity, unlock and recovery

- Tables in schema `vault`, under row-level security by account, registered in the personal-data registry and readable by `app_backup` (ADR-0017): `vault.recipient` (account, age recipient, created, rotated) and `vault.envelope` (account, kind `passkey_prf` or `recovery`, credential ID for `passkey_prf`, the age ciphertext).
- First use: the device generates the identity, seals one envelope per PRF-capable passkey through the platform port and one with the vault recovery secret from the recovery kit (spec 0003 R6), and uploads the recipient and envelopes. A new passkey with PRF gets its envelope at its next unlock.
- Unlock: the platform port's PRF ceremony opens the matching envelope; without PRF, the person enters the recovery secret once and the identity is kept wrapped by a non-extractable key through the key-storage port (R5). The identity stays in memory only and is dropped on sign-out, after 15 minutes idle, or after 15 minutes hidden.
- Recovery after losing every passkey: account recovery (spec 0003) then the recovery secret opens the recovery envelope; new envelopes are sealed for the new passkey.
- Regenerating the recovery kit re-seals the recovery envelope, so the old secret stops working.
- Tests run in Playwright with a virtual authenticator with PRF, and without PRF.

### R3. AWS application account and storage

- `infra/aws/app-account.yaml`, a CloudFormation template the owner launches once in a new AWS account in `sa-east-1`: the Vercel OIDC identity provider; a production role and a preview role, each trusting only its environment of project `arca`; two buckets (`production` and `preview`, the preview one holding synthetic data only) with versioning, default SSE-S3, public access blocked, TLS required and CORS limited to the environment's origins; one customer-managed KMS key for field encryption, usable only by the production role (preview gets its own key).
- Object keys are random UUIDs under a fixed prefix; they never contain names or document types. Uploads and downloads use presigned URLs valid for 5 minutes, with the content length fixed at signing and a maximum of 25 MB per object.
- The data-flow table in ARCHITECTURE.md already lists S3 and KMS; the ticket records the account and region.

### R4. Documents

- Table `vault.document` (owner account, type key, size, created, object key, recipient account IDs), under row-level security: the owner and the accounts it lists can read the row; only the owner changes it. Registered, with an `app_backup` policy.
- Routes: create (returns a presigned upload URL), confirm upload, list, get download URL, replace (for sharing, revocation and rotation, which happen on the owner's device), delete. Each in `packages/api-contract`.
- `eraseAccount` (spec 0004 R9) deletes the account's envelopes, recipient, documents and objects.
- `connect-src` gains the two bucket origins for the environment; nothing else changes in the CSP.
- The plaintext processing path of ADR-0018 is specified here and built with the first `DocumentReader` use: one request, memory only, nothing persisted, logged or traced.

### R5. Platform port and web adapters

- `packages/platform` defines one port per capability in ARCHITECTURE.md (document capture, file picking, key storage, notifications, receiving shared files, sharing, deep links), plus `Passkeys` (spec 0003) and a `PasskeyPrf` port for vault envelopes. `Capabilities.has()` reports what the running adapter really supports.
- Web adapters: document capture and file picking with `<input type=file>` (with `capture` where useful); key storage with non-extractable WebCrypto keys in IndexedDB, reporting eviction as "not stored"; notifications with the Push API through the service worker; sharing with the Web Share API; receiving shared files with the Web Share Target where supported, otherwise unavailable; deep links as plain URLs; `PasskeyPrf` with `age-encryption`'s WebAuthn recipient and identity.
- A conformance suite per port, written once, that every adapter (web now, Capacitor and Tauri later) must pass, with fakes for headless runs.
- Lint stays as in spec 0001 R2: no OS checks, no native imports outside `packages/platform`.

### R6. Field encryption

- A `FieldCipher` in `apps/api` using the AWS Encryption SDK for JavaScript with a KMS keyring on the R3 key, an encryption context of table, column and row ID, and a short-lived data-key cache. Ciphertext columns are `bytea`.
- Built and tested now against a test-only table and KMS mocked at the SDK boundary; first used by whichever slice adds a bank account or document number. Export decrypts through it; deletion needs nothing extra.

### R7. Notifications

- Tables in schema `notification`, under row-level security by account and registered: `notification.channel` (account, kind `web_push` or `email`, push subscription for `web_push`, device label, created, last success) and `notification.message` (account, message code, entity ID, created, delivered).
- Producing a notification inserts a `message` and starts `deliverNotification(messageId)` (identifiers only). The step sends to every channel of the account. Web push uses VAPID: the public key in a repository configuration file, the private key a Sensitive Vercel variable per environment, generated by an agent after the owner's OK. A subscription that the push service reports gone is deleted.
- **Payloads carry no text:** the push payload is the message code and ID; the service worker turns the code into pt-BR text from the i18n catalog. Email uses spec 0003's sender with the same codes.
- Security notices from spec 0003 R7 go to every channel. Subscribing needs a user gesture; on iOS the app explains that push works after adding it to the home screen.
- Preferences: security notices cannot be turned off; other codes can, per account.
- The web push library is chosen at ticket time from maintained options (the common `web-push` package's last release is from 2024-01), with a supply-chain PASS.

## Threat model for this slice

| Threat | Where | Control |
| --- | --- | --- |
| Information disclosure: server or storage breach reads documents | S3, database | Client-side age encryption; server holds recipients and envelopes only |
| Information disclosure: future quantum attack on stored ciphertext | Documents | Hybrid ML-KEM-768 + X25519 recipients |
| Elevation: a case member reads another's document | Database, S3 | Per-document recipients; row-level security; presigned URLs issued only after the check |
| Loss of keys | Vault | Recovery envelope from the printed kit; per-passkey envelopes; tested recovery path |
| Tampering: XSS steals the unlocked identity | Web | Strict CSP and Trusted Types; identity in memory only, dropped on idle |
| Information disclosure: personal data in object keys or push payloads | S3, push services | Random UUID keys; payloads carry codes only |
| Spoofing: notification phishing | Notifications | Generic text from our own catalog; no links in push |
| Elevation: preview reaching production storage | AWS | Separate roles, buckets and keys per environment, trusted by OIDC subject |

## Definition of done

- Every requirement covered by tests; the C2SP vectors and the platform conformance suite run in CI.
- `docs/vault-format.md` written; a document round-trips between two synthetic accounts with sharing and revocation in Playwright.
- A preview receives a web push for a synthetic message.
- No personal data anywhere in the diff.

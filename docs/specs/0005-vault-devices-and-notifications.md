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

- New package `packages/vault`, pure TypeScript with no workspace dependencies and no platform calls (boundary matrix: `apps/web` may depend on it; the API never decrypts and does not depend on it). `packages/platform` also depends on `age-encryption` for the envelope port (R5); the boundary matrix lists both. It wraps `age-encryption` (newest release at least 7 days old; 0.3.x as of 2026-11-02), added to the Versions table with a supply-chain PASS.
- API: generate a hybrid identity; encrypt and decrypt documents as streams to a recipient set; seal and open the scrypt recovery envelope with the vault recovery secret; re-encrypt to a new recipient set. Passkey envelopes are not sealed here: the `VaultEnvelopes` port (R5) owns them, and `packages/vault` never receives a PRF recipient (ADR-0018).
- The C2SP age test vectors run in CI against the package, plus vectors pinned at adoption for the `mlkem768x25519` stanza where CCTV does not cover it (ADR-0018). Round-trip, multi-recipient, revocation, rotation and wrong-key tests are table-driven.
- The format is documented in `docs/vault-format.md`: file layout (plain age), recipient types, envelope kinds, how native apps reproduce each with other age implementations.

### R2. Vault identity, unlock and recovery

- Tables in schema `vault`, under row-level security by account, registered in the personal-data registry and readable by `app_backup` (ADR-0017): `vault.recipient` (account, age recipient, created, rotated) and `vault.envelope` (account, kind `passkey_prf` or `recovery`, credential ID for `passkey_prf`, the age ciphertext).
- First use: the device generates the identity, seals one envelope per PRF-capable passkey through the `VaultEnvelopes` port and one with the vault recovery secret from the recovery kit (spec 0003 R6), and uploads the recipient and envelopes. A new passkey with PRF gets its envelope at its next unlock.
- Unlock: the API serves envelopes and download URLs only after a `vault_unlock` step-up less than 15 minutes old (spec 0003 R5); then the platform port's PRF ceremony opens the matching envelope; without PRF, the person enters the recovery secret once and the identity is kept wrapped by a non-extractable key through the key-storage port, with the AES-GCM construction ADR-0018 names (R5). The identity stays in memory only and is dropped on sign-out, after 15 minutes idle, or after 15 minutes hidden.
- Revoking a passkey, or cancelling one in its 24-hour window, deletes its `passkey_prf` envelope in the same transaction, and offers identity rotation (ADR-0018), on by default when the passkey had PRF or its device held a wrapped identity.
- Recovery after losing every passkey: account recovery (spec 0003) then the recovery secret opens the recovery envelope; new envelopes are sealed for the new passkey.
- Regenerating the recovery kit re-seals the recovery envelope, so the old secret stops working, in the order spec 0003 R6 fixes; a kit is never shown with a vault secret that is not sealed in.
- Recipient authenticity, rotation of shared documents and the non-PRF residual follow ADR-0018; the Playwright run without PRF asserts that no document opens without a fresh `vault_unlock` step-up.
- Tests run in Playwright with a virtual authenticator with PRF, and without PRF.

### R3. AWS application account and storage

- `infra/aws/app-account.yaml`, a CloudFormation template the owner launches once in a new AWS account in `sa-east-1`: the Vercel OIDC identity provider; a production role and a preview role, each trusting only its environment of project `arca`; two buckets (`production` and `preview`, the preview one holding synthetic data only; the production bucket replicated to the backup account, spec 0004 R12) with versioning and noncurrent versions expired after 1 day, default SSE-S3, public access blocked, TLS required and CORS limited to the environment's origins (production: the domain; preview: the branch-URL pattern `https://arca-git-*-<team-slug>.vercel.app`, harmless beyond that because every request needs a presigned URL); one customer-managed KMS key per environment for field encryption, each usable only by that environment's role; and the replication role for the production bucket. The same change updates `infra/aws/backup-account.yaml` (spec 0004 R12) with the two grants cross-account replication into SSE-KMS needs, scoped to the document replica bucket: its bucket policy admits the replication role, and its KMS key lets that role encrypt; the owner updates the backup stack once.
- Application deletes are plain `DeleteObject` calls; the production and preview roles hold no `s3:DeleteObjectVersion`, so delete markers replicate to the backup account (spec 0004 R12) and the 1-day noncurrent rule purges the source.
- Object keys are random UUIDs under a fixed prefix; they never contain names or document types. Uploads and downloads use presigned URLs valid for 5 minutes, with the content length fixed at signing and a maximum of 25 MB per object.
- The data-flow table in ARCHITECTURE.md already lists S3 and KMS; the ticket records the account and region.

### R4. Documents

- Table `vault.document` (owner account, type key, size, created, object key) and table `vault.document_recipient` (document ID, document owner ID, recipient account ID), one row per share, with a composite foreign key `(document_id, document_owner_id)` to `vault.document (id, owner_id)` `ON DELETE CASCADE`, under row-level security. Owner-side policies on `document_recipient` read its own `document_owner_id` column (no subquery into `vault.document`, so the two tables' policies never recurse): only the owner inserts, changes or deletes recipient rows (`WITH CHECK document_owner_id` = identity); a recipient reads only their own row. The owner and the accounts with a recipient row read the document row. Both registered with the `delete` strategy (the recipient table's owner column is the recipient account), with `app_backup` policies.
- **Reading another account's recipient** (to share with them): an account reads the `vault.recipient` row of an account it is linked to, by an accepted invite between the two (either direction) until the case model exists, then also by shared case membership; the target is named by account ID from that link, never looked up by email. No other cross-account read exists.
- Audit events (added to spec 0003 R7's closed list): envelope fetched, download URL issued, document created, shared, share revoked, replaced, deleted, identity rotated, recipient pin changed. Notification channel added and removed are audited too (R7).
- Routes: create (returns a presigned upload URL), confirm upload, list (cursor-paginated, page size capped in the contract), get download URL, replace (for sharing, revocation and rotation, which happen on the owner's device), delete. Each in `packages/api-contract`.
- `eraseAccount` (spec 0004 R9) deletes the account's envelopes, recipient, documents and objects, and the account's own recipient rows on other owners' documents; those documents stay encrypted to the deleted recipient until their owner's next re-encryption, and the deleted recipient's key no longer exists.
- Packages: the AWS SDK v3 S3 client and presigner, and the OIDC bridge as in spec 0004 R12, each in the Versions table with a supply-chain PASS.
- `connect-src` gains the environment's bucket origin only, as ADR-0018 records; nothing else changes in the CSP.
- Retention of documents, versions and notifications follows [RETENTION.md](../RETENTION.md).
- The plaintext processing path of ADR-0018 is built with the first `DocumentReader` use: one request bound to a `vault.document` row **owned by the requester** (a share recipient is refused, with an access-matrix and an evaluation case), rate-limited and audited; memory only, nothing persisted, logged or traced; the schema-validated result returned to the client, which stores it in the vault; only confirmed, minimized fields enter the case model.

### R5. Platform port and web adapters

- `packages/platform` defines one port per capability in ARCHITECTURE.md (document capture, file picking, key storage, notifications, receiving shared files, sharing, deep links), plus `Passkeys` (spec 0003) and `VaultEnvelopes`. `Capabilities.has()` reports what the running adapter really supports.
- Web adapters: document capture and file picking with `<input type=file>` (with `capture` where useful); key storage with non-extractable WebCrypto keys in IndexedDB, reporting eviction as "not stored"; notifications with the Push API through the service worker; sharing with the Web Share API; receiving shared files with the Web Share Target where supported, otherwise unavailable; deep links as plain URLs; `VaultEnvelopes` (`seal(identity, credentialId)` and `open(envelope)`, typed on our own types, never the library's) with `age-encryption`'s WebAuthn recipient and identity; it is the only producer of passkey envelopes. It pins `fido2prf` vectors generated at adoption (fixed credential, PRF output and nonce) in CI, and the ticket proves one envelope opens with the Go `age-plugin-fido2prf`. Key storage wraps with AES-GCM-256 (`extractable: false`, usages `encrypt` and `decrypt`, a fresh random 96-bit IV per wrap, additional authenticated data of account ID, relying-party ID and format version) and deletes the blob on sign-out, account change and recovery, and whenever the client finds its session revoked; a device that never comes back is covered by the identity rotation offered on revocation (R2). Native adapters implement the same port with their platform's age implementation, never by re-deriving the stanza themselves.
- A conformance suite per port, written once (key storage includes: a blob moved to another account or origin fails to open; eviction reports "not stored"), that every adapter (web now, Capacitor and Tauri later) must pass, with fakes for headless runs.
- Lint stays as in spec 0001 R2: no OS checks, no native imports outside `packages/platform`.

### R6. Field encryption

- A `FieldCipher` in `apps/api` using the AWS Encryption SDK for JavaScript (newest release at least 7 days old, added to the Versions table with a supply-chain PASS; the minimal modules `@aws-crypto/encrypt-node`, `@aws-crypto/decrypt-node`, `@aws-crypto/kms-keyring-node` and `@aws-crypto/caching-materials-manager-node`, not the umbrella `client-node`, which pulls DynamoDB and unused keyrings) with a KMS keyring on the R3 key, an encryption context of table, column and row ID, the commitment policy that requires key commitment on encrypt and decrypt, and a short-lived data-key cache partitioned by table and column. The SDK's cache keys include the encryption context, so it mostly serves repeated decrypts; the row ID stays in the context whatever the hit rate. `decrypt(ciphertext, {table, column, rowId})` compares the context the SDK returns, key by key, with the expected one and fails closed on any difference, so a ciphertext moved to another row or column never decrypts there. Ciphertext columns are `bytea`. KMS automatic key rotation is on; Encryption SDK messages name the key version, so rotation needs no re-encryption. The data-key cache has limits on age (5 minutes), messages and bytes.
- Table-driven tests: ciphertext moved between rows, between columns and across environments' keys fails; cache limits hold.
- Built and tested now against a test-only table and KMS mocked at the SDK boundary; first used by whichever slice adds a bank account or document number. Export decrypts through it; deletion needs nothing extra.

### R7. Notifications

- Tables in schema `notification`, under row-level security by account and registered: `notification.channel` (account, kind `web_push` or `email`, push subscription for `web_push`, device description, created, last success) and `notification.message` (account, message code, entity ID, created, delivered).
- Producing a notification inserts a `message` and starts `deliverNotification(accountId, messageId)` (identifiers only; the step sets the account's identity before reading, per spec 0004 R9). The step sends to every channel of the account. Web push uses VAPID with one key pair per environment: the public keys in a repository configuration file, keyed by environment, the private keys Sensitive Vercel variables, generated by an agent after the owner's OK. A subscription that the push service reports gone is deleted.
- **Payloads carry no text:** the push payload is the message code and ID; the service worker turns the code into pt-BR text from the i18n catalog. Email uses spec 0003's sender with the same codes.
- Security notices from spec 0003 R7 go to every channel; this service becomes their only producer, replacing spec 0003's direct email path. Subscribing needs a user gesture; on iOS the app explains that push works after adding it to the home screen ([WebKit: web push for web apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), checked 2026-11-02).
- Preferences: security notices cannot be turned off; other codes can, per account.
- The web push library is chosen at ticket time, preferring a maintained one built on WebCrypto with provenance; the supply-chain PASS weighs that `web-push` 3.6.7 is MPL-2.0 (needs a license exception), has no provenance and depends on the unmaintained `asn1.js`. The choice is made from maintained options (the common [`web-push`](https://www.npmjs.com/package/web-push) package's last release, 3.6.7, is from 2024-01-16, npm registry checked 2026-11-02), with a supply-chain PASS.

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
- The access-matrix suite covers every new table: the owner reads and writes; a recipient reads the document row and their own recipient row but cannot change, add or delete one; a non-recipient sees nothing; an envelope is readable only by its account, never by a recipient of a shared document; another account's `vault.recipient` is readable only when an accepted invite or a shared case links the two, and not otherwise; erasing the owner of a shared document, or its recipient, succeeds in either order; `app_jobs` under identity A erases nothing of B; `app_backup` reads all and writes nothing; notification rows only by their account.
- `docs/vault-format.md` written; a document round-trips between two synthetic accounts with sharing and revocation in Playwright.
- A preview receives a web push for a synthetic message.
- No personal data anywhere in the diff.

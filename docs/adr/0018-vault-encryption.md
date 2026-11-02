# ADR-0018: Vault encryption with the age format, hybrid post-quantum keys and passkey unlock

- Status: Accepted
- Date: 2026-11-02
- Amends: [ADR-0008](0008-database-security-and-environments.md) (document encryption, crypto-shredding, the field-encryption library), [ADR-0010](0010-stack-revised.md) (`connect-src` gains the storage origins)
- Spec: [0005 vault, devices and notifications](../specs/0005-vault-devices-and-notifications.md)

## Context

Documents (passports, certificates, bank statements) are encrypted on the client and the server stores ciphertext ([CLAUDE.md](../../CLAUDE.md), ADR-0008). ADR-0010 lists the inputs to this ADR: standard, reviewed constructions only; keys wrapped with passkey-derived keys through the WebAuthn PRF extension where supported, recovery codes as the fallback; no reliance on browser storage, which Safari can evict; and a defined path by which plaintext reaches a document-processing session the person authorized. ARCHITECTURE.md asks for a documented, platform-neutral format that native keystores can later wrap.

Requirements that shape the choice:

- **Each adult owns their documents** (SECURITY.md, principle 3). Sharing is explicit, per document.
- **Documents are long-lived and sensitive.** A passport scan stays sensitive for a decade, so ciphertext recorded today should resist a future quantum computer ("harvest now, decrypt later").
- **Four platforms.** Web now; Android, iOS and possibly desktop later, each needing to read the same files.
- **No home-made cryptography.**

Facts checked on 2026-11-02:

- age is a file encryption format with a public specification ([C2SP age](https://c2sp.org/age)) and independent implementations in Go (`filippo.io/age`), Rust (`rage`) and TypeScript (`age-encryption`, by the format's author). Shared test vectors exist ([C2SP CCTV age vectors](https://c2sp.org/CCTV/age)).
- `age-encryption` 0.3.1 (published 2026-08-28 with provenance) depends only on `@noble/*` and `@scure/base`. `@noble/curves`, `@noble/hashes` and `@noble/ciphers` are independently audited; `@noble/post-quantum`, which supplies ML-KEM, is not (its README, checked 2026-11-02), and `age-encryption` 0.3.1 declares `^0.5.3`. It supports X25519 and hybrid post-quantum identities (ML-KEM-768 with X25519), streaming encryption of large files, scrypt passphrases, and symmetric encryption with passkeys through the WebAuthn PRF extension, interoperable with the age CLI's FIDO2 PRF plugin (package README, npm registry).
- The hybrid recipient is the `mlkem768x25519` stanza of the age v1 specification, an X-Wing-based ML-KEM-768 + X25519 construction ([C2SP age](https://c2sp.org/age)). The passkey recipient is the `age-encryption.org/fido2prf` stanza implemented by `age-encryption` and by the Go `age-plugin-fido2prf` plugin; it has no standalone specification beyond those implementations, and its identity string encodes the credential ID and the relying-party ID ([typage README](https://github.com/FiloSottile/typage), checked 2026-11-02).
- PRF support is broad but incomplete across authenticators ([ADR-0015](0015-identity-enrollment-step-up-and-recovery.md)).
- A Vercel function accepts a request body of at most 4.5 MB ([Vercel: functions limits](https://vercel.com/docs/functions/limitations), checked 2026-11-02).

## Decision

### Format and library

- Every vault file is an **age** file. The library is `age-encryption` on the web; native apps use an age implementation for their platform that reads the same stanzas, never a hand-built stanza.
- **Native passkey envelopes.** No native age implementation reads `fido2prf`, and hand-built stanzas are not allowed. Native shells (Capacitor, Tauri) therefore run the same `age-encryption` code in the app's JavaScript runtime, with the PRF output supplied by the platform passkey API through the port. The vault ticket checks that the library accepts injected PRF output; if it does not, native devices unlock with the recovery kit once and keep the identity wrapped in Keystore or Keychain, like non-PRF web devices.
- Recipient types and what keeps them readable for a decade:
  - X25519 and scrypt: age v1 core stanzas, covered by the C2SP CCTV vectors.
  - `mlkem768x25519` (hybrid): age v1 specification; CCTV vectors where they cover it.
  - `fido2prf` (passkey envelopes): defined by its two implementations, not a specification. The `VaultEnvelopes` adapter in `packages/platform` pins vectors generated at adoption (fixed credential, PRF output and nonce) and check them in CI forever, and the vault ticket proves one envelope opens with the Go `age-plugin-fido2prf` too.
- If a stanza format must change, the device opens every file with the old type and re-encrypts it to the new one at the next unlock, as rotation does; ciphertext is never stranded on a format only one implementation reads.

### Keys

The wrapping, storage and port details are normative in [spec 0005](../specs/0005-vault-devices-and-notifications.md) R2 and R5; this section records the decision and the guarantees they must keep.

- Each person who holds documents has a **vault identity**: an age hybrid identity (ML-KEM-768 + X25519), generated on their device. Its recipient (public key) is stored on the server with the account; the identity (private key) never leaves a device in plaintext.
- The identity is stored on the server only inside **envelopes**, each an age file holding the identity string, encrypted to one unlock method:
  - one envelope per passkey that supports PRF, using the `fido2prf` recipient with that credential. Login passkeys are created with the PRF extension enabled, so the same passkey signs in and unlocks;
  - one envelope encrypted with an age scrypt passphrase recipient whose passphrase is the **vault recovery secret**, 128 random bits generated on the device when the vault is created and shown as the vault part of the recovery kit (ADR-0015) only after the envelope is sealed and opened once as a check.
- Every envelope holds the identity and a 256-bit **share key**, generated with it, that authenticates the person's sharing state (below).
- **Who seals what.** The `VaultEnvelopes` port in `packages/platform` owns passkey envelopes, because the PRF ceremony is a platform capability; it takes and returns our own types, and the identity crosses it as an opaque branded type (`VaultIdentity`, with the share key) defined in `packages/vault`, which `packages/platform` imports for types only. `packages/vault` owns document encryption and the scrypt recovery envelope, and never receives a PRF recipient. Both depend on `age-encryption`; no other package does.
- On a device whose passkey lacks PRF, the person unlocks once with the recovery kit; the identity is then kept wrapped by a non-extractable WebCrypto key held through the `platform` key-storage port. The wrapping is AES-GCM with a 256-bit key generated with `extractable: false` and usages `encrypt` and `decrypt` only, a fresh random 96-bit IV per wrap, and additional authenticated data of the account ID, the relying-party ID and a format version; IV and version are stored beside the ciphertext. The blob is deleted on sign-out, on an account change in that browser and on recovery. If the browser evicts it, the kit is needed again. Nothing depends on that storage persisting.
- **Residual on non-PRF devices:** non-extractable means the key cannot be exported, not that using it needs a verification. Script running on our origin can unwrap that identity. It still reaches no document without the server-checked `vault_unlock` step-up below, which needs the person's user-verified passkey, and download responses are never cached; an injected script that gets the person to approve a step-up prompt is covered only by the CSP and Trusted Types. Accepted for those devices.

### Documents

- **Recipient authenticity.** The device derives its own recipient from the unlocked identity and never uses the server's copy for itself. A recipient's fingerprint is printed in that person's recovery kit and shown on the share screen.
- **The owner's sharing state is authenticated by the owner.** Which recipients each document is encrypted to, and the fingerprint pinned for each person, live in one sharing-state record per owner, stored on the server with an HMAC-SHA-256 tag (WebCrypto) under the share key, and a version number. The tag covers a length-prefixed encoding of the domain tag `arca-sharing-state/v1`, the account ID, the version and the serialized state, so the server cannot relabel an old state with a higher version or move one between accounts. Every device verifies the tag and remembers the highest version it has seen; a rotation generates a new share key, kept only in the new identity's envelopes, and re-tags the current state under it with the next version, so a share key from before a compromise cannot forge a state. A device that finds a lower version than it remembers (after a database restore) does not use it: it shows the owner the differences from the state it remembers, and once the owner confirms, re-tags the confirmed state with a version above both; the restore notice says to expect this. Because that memory can be lost (a new device, cleared storage), a revoke or rotation that re-encrypts documents first shows the owner the resulting recipient list to confirm, and the rollback residual is limited to a device that has never seen the newer state. A device encrypts only to recipients in a verified sharing state, which changes only through the owner's own share, revoke or confirm action. A recipient or recipient row the state does not contain (one the server added) is never encrypted to: it is shown with its fingerprint and needs the owner's confirmation. Another person's rotation never widens a document's recipients and changes their pin only after the owner confirms the new fingerprint. The server's `vault.document_recipient` rows mirror the state for access control; they never decide encryption. The logic lives in one module of `packages/vault` with its own test vectors (spec 0005 R1).
- Residuals: the first share with a person trusts the server's recipient unless the owner compares the fingerprint with that person; and a server could replay an older, validly tagged sharing state to a device that never saw a newer one, re-adding a revoked recipient at the next re-encryption.
- A document is encrypted on the device as an age file (streamed for large files) to the owner's recipient plus the recipient of every person it is shared with, and uploaded as ciphertext to S3 in São Paulo through a presigned URL. Its metadata row (type, owner, size) and one recipient row per share are under row-level security.
- **Sharing** a document, or revoking a share, re-encrypts it on the owner's device to the new recipient set and replaces the object. Documents are small enough that rewriting the whole file is simpler than editing headers.
- **Rotation** of an identity (suspected compromise, or a policy period; offered by default when a revoked passkey had PRF or its device held a wrapped identity, and after recovery) creates a new identity, re-encrypts the documents the person owns, and marks the old recipient as rotated. Each owner who shared documents with that person re-encrypts them to the new recipient at their next unlock. Until then the server keeps the old identity's envelopes beside the new ones (each envelope names the recipient whose identity it holds), sealed to the same unlock methods, so shared documents stay readable from any device; they are deleted when every sharing owner has re-encrypted, or after 90 days, whichever comes first.

### Opening the vault

- Download URLs carry `response-cache-control=no-store`, so neither the browser cache nor the service worker keeps ciphertext.
- Replacing or deleting documents needs its own consumed `vault_write` step-up bound to the documents and the new objects' hashes (ADR-0015), so whoever shares a session cannot spend an open unlock window on writes. The server issues envelopes and document download URLs only to a session with a `vault_unlock` step-up ([ADR-0015](0015-identity-enrollment-step-up-and-recovery.md)) less than 15 minutes old. Reaching plaintext therefore always needs a fresh user verification checked by the server, as ARCHITECTURE.md requires, including on a device that keeps a locally wrapped identity.
- On a PRF device the PRF ceremony that opens the envelope is a second, client-side user-verified assertion; the two prompts happen at most once per 15 minutes. The server never sees PRF output, and the client enforces it: the `Passkeys` port refuses server-issued options with `prf.eval`, `prf.evalByCredential` or any extension outside an allow-list (`prf: {}` at registration only), and strips extension results other than `prf.enabled` from every response before it is sent; the ceremony that evaluates PRF runs only inside the `VaultEnvelopes` adapter, with user verification required.
- The unlocked identity lives in memory for the tab's session and is dropped on sign-out, after 15 minutes idle, or when the page is hidden for 15 minutes.

### Plaintext for an authorized processing session

- When the person authorizes reading a document (OCR, review), the client decrypts it and sends the plaintext over TLS in one request to the API (within the function's request body limit, 4.5 MB on Vercel; a larger document is not processed, and is never routed through storage instead), which passes it to the `DocumentReader` port ([ADR-0004](0004-ai-providers-behind-ports.md)) and returns the result. Plaintext exists only in that function's memory for that request; it is never written to the database, storage, logs, telemetry or a workflow payload. Work that would outlast one request on plaintext is not allowed.
- Only the document's **owner** may send it for processing: the request names a `vault.document` row whose owner is the requesting account, never one the requester can merely read because it was shared with them. It is rate-limited per account and writes an audit event (document ID, vendor, time). Letting a share recipient process a document would need an explicit per-document authorization by the owner, a change to this ADR and to ADR-0004. Residual, accepted: the check stops the app's own flow from processing someone else's document, but a recipient who already decrypted a shared document could send its plaintext under a document they own; sharing trusts the recipient with the content.
- The adapter's output is untrusted: it is schema-validated, rendered with remote images stripped and links marked, and covered by injection cases in the evaluation suite. The API returns it to the client without persisting it; the client stores the full result in the vault, encrypted like the document ([ADR-0004](0004-ai-providers-behind-ports.md)). Only the minimized fields the person confirms enter the case model, with document and account numbers stored through field encryption (below).

### Storage origins in the CSP

- Documents up to 25 MB go straight from the device to S3 through presigned URLs, because a Vercel function cannot take a request body that large and has no reason to see ciphertext. So `connect-src` gains exactly the environment's bucket origin, an amendment to ADR-0010's `connect-src 'self'`. The bucket accepts only presigned requests, and its CORS allows only the environment's origin.

### Deletion

- **Crypto-shredding**: deleting a person's envelopes makes their identity unrecoverable; their documents' objects are deleted too, and the application buckets expire noncurrent object versions after 1 day, so a replaced or deleted file (one a revoked recipient could still open) does not linger in the application account; the backup account's document replica keeps such versions for 35 days, readable only by the owner's restore role ([RETENTION.md](../RETENTION.md)). Backups ([ADR-0017](0017-data-lifecycle-and-backups.md)) may keep envelopes for up to 36 days, still encrypted to the person's own passkey and recovery secret.

### Field encryption is separate

- Bank account and identity document numbers stored as fields are encrypted on the server with KMS envelope encryption, as ADR-0008 decided. The library is the AWS Encryption SDK for JavaScript (its message format in `bytea` columns, key commitment required, an encryption context of table, column and row ID checked on every decrypt); [spec 0005](../specs/0005-vault-devices-and-notifications.md) R6 has the details.

## Alternatives

| Option | Why not |
| --- | --- |
| A custom scheme on WebCrypto (ECDH, HKDF, AES-GCM) | Home-made composition, no shared spec for native apps, no test vectors |
| libsodium sealed boxes and secretstream | Sound primitives, but no file format: headers, sharing and passkey unlock would be ours to design |
| X25519-only age recipients | Ten-year-sensitive documents; the hybrid costs about a kilobyte per recipient |
| Per-case data key wrapped by every member's key (ARCHITECTURE.md's earlier sketch) | Gives every case member access by default, against per-person ownership |
| Server-side encryption with KMS for documents | The server could read every document |
| Field encryption with raw KMS `GenerateDataKey` and WebCrypto | Home-made envelope format and context binding; the AWS Encryption SDK provides both, with key commitment |
| A `VaultEnvelopes` port that only returns the PRF output, with sealing in `packages/vault` | `age-encryption`'s `fido2prf` recipient runs the passkey ceremony itself; splitting them would mean rebuilding its stanza by hand |
| Keys kept only in browser storage | Safari can evict it; the identity would be lost |

## Consequences

- **Residual, accepted:** the ML-KEM half of each recipient comes from an implementation without an independent audit. The hybrid construction keeps X25519's classical security if ML-KEM fails, and the vectors run in CI. The residual ends when `@noble/post-quantum` publishes an independent audit; the vault ticket and every yearly security review re-check it and the resolved version.

- One documented format on every platform; native apps can use mature age implementations.
- Losing every passkey and the recovery kit makes the person's documents unrecoverable. The recovery kit is therefore part of enrollment, and the app reminds the person to keep it.
- Revoking a share is effective for future reads only: a person who already downloaded a document keeps that copy.
- Sharing and rotation run on the owner's device and take time proportional to the documents involved.
- The vault code is security-critical: must-pass security and auth-and-cryptography reviews, and the C2SP vectors in CI.

## Sources

- [C2SP: age specification](https://c2sp.org/age) and [CCTV age test vectors](https://c2sp.org/CCTV/age) (checked 2026-11-02)
- [npm: age-encryption](https://www.npmjs.com/package/age-encryption) 0.3.1 and its README — hybrid identities, streams, WebAuthn PRF, dependencies, provenance (checked 2026-11-02)
- [typage (age-encryption) README](https://github.com/FiloSottile/typage) — `fido2prf` identities, interoperability with `age-plugin-fido2prf` (checked 2026-11-02)
- [Vercel: functions limitations](https://vercel.com/docs/functions/limitations) — 4.5 MB request body (checked 2026-11-02)
- [Corbado: passkeys and the PRF extension](https://www.corbado.com/blog/passkeys-prf-webauthn) (checked 2026-11-02)

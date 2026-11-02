# ADR-0018: Vault encryption with the age format, hybrid post-quantum keys and passkey unlock

- Status: Accepted
- Date: 2026-11-02
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
- `age-encryption` 0.3.1 (published 2026-08-28 with provenance) depends only on the audited `@noble/*` and `@scure/base` libraries. It supports X25519 and hybrid post-quantum identities (ML-KEM-768 with X25519), streaming encryption of large files, scrypt passphrases, and symmetric encryption with passkeys through the WebAuthn PRF extension, interoperable with the age CLI's FIDO2 PRF plugin (package README, npm registry).
- PRF support is broad but incomplete across authenticators ([ADR-0015](0015-identity-enrollment-step-up-and-recovery.md)).

## Decision

### Format and library

- Every vault file is an **age** file. The library is `age-encryption` on the web; native apps use an age implementation for their platform, or a native PRF adapter that produces the same stanza. CI runs the C2SP test vectors against the web implementation.

### Keys

- Each person who holds documents has a **vault identity**: an age hybrid identity (ML-KEM-768 + X25519), generated on their device. Its recipient (public key) is stored on the server with the account; the identity (private key) never leaves a device in plaintext.
- The identity is stored on the server only inside **envelopes**, each an age file holding the identity string, encrypted to one unlock method:
  - one envelope per passkey that supports PRF, using age's FIDO2 PRF recipient with that credential. Login passkeys are created with the PRF extension enabled, so the same passkey signs in and unlocks;
  - one envelope encrypted with an age scrypt passphrase recipient whose passphrase is the **vault recovery secret**, 128 random bits printed in the same recovery kit as the account recovery code (ADR-0015).
- On a device whose passkey lacks PRF, the person unlocks once with the recovery kit; the identity is then kept wrapped by a non-extractable WebCrypto key held through the `platform` key-storage port. If the browser evicts it, the kit is needed again. Nothing depends on that storage persisting.

### Documents

- A document is encrypted on the device as an age file (streamed for large files) to the owner's recipient plus the recipient of every person it is shared with, and uploaded as ciphertext to S3 in São Paulo through a presigned URL. Its metadata row (type, owner, size, recipients) is under row-level security.
- **Sharing** a document, or revoking a share, re-encrypts it on the owner's device to the new recipient set and replaces the object. Documents are small enough that rewriting the whole file is simpler than editing headers.
- **Rotation** of an identity (suspected compromise, or a policy period) creates a new identity and re-encrypts each document the person can read, on the device.

### Opening the vault

- Unlocking is a user-verified passkey ceremony on the device (the PRF assertion requires user verification), so reaching plaintext always needs a fresh verification, as ARCHITECTURE.md requires. The server sees no PRF output and serves envelopes and document ciphertext to an authenticated session only.
- The unlocked identity lives in memory for the tab's session and is dropped on sign-out, after 15 minutes idle, or when the page is hidden for 15 minutes.

### Plaintext for an authorized processing session

- When the person authorizes reading a document (OCR, review), the client decrypts it and sends the plaintext over TLS in one request to the API, which passes it to the `DocumentReader` port ([ADR-0004](0004-ai-providers-behind-ports.md)) and returns the result. Plaintext exists only in that function's memory for that request; it is never written to the database, storage, logs, telemetry or a workflow payload. Work that would outlast one request on plaintext is not allowed; long jobs run on the extracted, minimized fields the person confirmed.

### Deletion

- **Crypto-shredding**: deleting a person's envelopes makes their identity unrecoverable; their documents' objects are deleted too. Backups ([ADR-0017](0017-data-lifecycle-and-backups.md)) may keep envelopes for up to 35 days, still encrypted to the person's own passkey and recovery secret.

### Field encryption is separate

- Bank account and identity document numbers stored as fields are encrypted on the server with KMS envelope encryption, as ADR-0008 decided; this ADR does not change that.

## Alternatives

| Option | Why not |
| --- | --- |
| A custom scheme on WebCrypto (ECDH, HKDF, AES-GCM) | Home-made composition, no shared spec for native apps, no test vectors |
| libsodium sealed boxes and secretstream | Sound primitives, but no file format: headers, sharing and passkey unlock would be ours to design |
| X25519-only age recipients | Ten-year-sensitive documents; the hybrid costs about a kilobyte per recipient |
| Per-case data key wrapped by every member's key (ARCHITECTURE.md's earlier sketch) | Gives every case member access by default, against per-person ownership |
| Server-side encryption with KMS for documents | The server could read every document |
| Keys kept only in browser storage | Safari can evict it; the identity would be lost |

## Consequences

- One documented format on every platform; native apps can use mature age implementations.
- Losing every passkey and the recovery kit makes the person's documents unrecoverable. The recovery kit is therefore part of enrollment, and the app reminds the person to keep it.
- Revoking a share is effective for future reads only: a person who already downloaded a document keeps that copy.
- Sharing and rotation run on the owner's device and take time proportional to the documents involved.
- The vault code is security-critical: must-pass security and auth-and-cryptography reviews, and the C2SP vectors in CI.

## Sources

- [C2SP: age specification](https://c2sp.org/age) and [CCTV age test vectors](https://c2sp.org/CCTV/age) (checked 2026-11-02)
- npm registry and package README: `age-encryption` 0.3.1 — hybrid identities, streams, WebAuthn PRF, dependencies (checked 2026-11-02)
- [Corbado: passkeys and the PRF extension](https://www.corbado.com/blog/passkeys-prf-webauthn) (checked 2026-11-02)

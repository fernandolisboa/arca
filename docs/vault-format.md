# Vault format

How Arca's vault stores data, precisely enough for another implementation (a native app, or a person with the age CLI) to read and write it. The decision behind it is [ADR-0018](adr/0018-vault-encryption.md). The code is `packages/vault` ([spec 0005](specs/0005-vault-devices-and-notifications.md) R1). Every file is plain [age v1](https://age-encryption.org/v1), so any conforming age implementation that supports the recipient type can open it.

## Recipient types

| Type | Stanza | Used for | Specified by |
| --- | --- | --- | --- |
| Hybrid ML-KEM-768 + X25519 | `mlkem768x25519` | Documents and vault items. Identities are `AGE-SECRET-KEY-PQ-1…`, recipients `age1pq1…` | age v1 specification, with C2SP CCTV vectors |
| scrypt | `scrypt` | The recovery envelope | age v1 core, with C2SP CCTV vectors |
| FIDO2 PRF | `fido2prf` | Passkey envelopes, sealed by the `VaultEnvelopes` port in `packages/platform` | `age-plugin-fido2prf` and `age-encryption`, with vectors pinned at adoption |

Documents are encrypted only to hybrid recipients. A plain X25519 recipient is refused, so a recipient that the server supplies cannot remove the post-quantum half.

## Identity

Each person has one vault identity: an age hybrid identity and a 256-bit **share key**, both generated on the device. The identity's recipient is stored on the server with the account. The device derives its own recipient from the identity and never trusts the server's copy for itself.

The serialized identity, which is what every envelope seals, is three length-prefixed fields:

```
u32be(len) "arca-vault-identity/v1"
u32be(len) "AGE-SECRET-KEY-PQ-1…"   (UTF-8)
u32be(32)  share key               (32 random bytes)
```

`u32be` is a 4-byte big-endian length. A reader must reject:

- any other tag;
- a field count other than three;
- trailing bytes;
- an identity that is not an upper-case Bech32 `AGE-SECRET-KEY-PQ-1…` string holding 32 bytes;
- a share key of any length other than 32 bytes.

## Envelopes

An envelope is an age file whose plaintext is the serialized identity.

- **Recovery envelope:** one `scrypt` stanza, work factor 18. The passphrase is the **vault recovery secret**: 128 random bits written as 26 Crockford base32 symbols (`0-9`, `A-Z` without `I`, `L`, `O`, `U`), with no padding and the final two bits zero.
  - Before use, typed input is normalized: spaces and hyphens are removed, letters are upper-cased, `I` and `L` are read as `1` and `O` as `0`, and the result must decode to exactly 16 bytes.
  - The age CLI opens the envelope with `age -d` and the canonical 26-symbol secret as the passphrase.
- **Passkey envelope:** one `fido2prf` stanza for one credential. These are sealed and opened only through the `VaultEnvelopes` port (spec 0005 R5).

## Documents and vault items

A document, or a small vault item such as a bank account number, is an age file with one `mlkem768x25519` stanza per recipient: the owner and each person it is shared with.

- It is streamed in 64 KiB STREAM chunks and stored as is (binary, not armored).
- Sharing, revoking or rotating re-encrypts the whole file to the new recipient set.
- A decrypting stream that fails part way must be discarded. Each chunk is authenticated before it is released, and the library releases a chunk only once it knows whether that chunk is the last. On a truncated or corrupted file it can therefore release fewer chunks than the reference implementation, never more.

## Sharing state

Which people each document is encrypted to, and the recipient pinned for each person, form the owner's **sharing state**. The server stores it with a version and a tag, and every device verifies it before encrypting.

**State bytes.** The state is canonical JSON:

```json
{"format":1,"pins":{"<account ID>":"age1pq1…"},"documents":{"<document ID>":["<account ID>"]}}
```

- Account and document IDs are lowercase UUIDs, and every pin is a hybrid recipient.
- Keys are in this order. The keys of `pins` and `documents` are sorted by byte value, which for these IDs is the same as sorting by UTF-16 code unit.
- Each recipient list is sorted the same way and has no duplicates.
- There is no whitespace.
- Every account in a recipient list has a pin.
- A reader re-serializes what it parsed and rejects the bytes unless they match.

**Tag.** HMAC-SHA-256, keyed with the share key, over four length-prefixed fields (the same `u32be` framing as the identity):

```
"arca-sharing-state/v1" ‖ account ID ‖ version (decimal ASCII) ‖ state bytes
```

**Version.** A positive integer. Every new state, and every re-tag after a rotation or a confirmed rollback, takes a version above every version seen. Verification has three results:

| Result | When | What the device does |
| --- | --- | --- |
| `verified` | The tag matches for the expected account, and the version is at least the highest this device has seen | Uses the state |
| `rolled_back` | The tag matches, but the version is below the highest seen | Shows the owner the changes from the state it remembers, and uses nothing until the owner confirms |
| `invalid` | Anything else, including a highest-seen version that is not a positive integer | Never uses the state |

## Fingerprints

A recipient's fingerprint is the first 16 bytes of SHA-256 over its UTF-8 `age1pq1…` string, written as eight groups of four lowercase hex digits. It is printed in the person's recovery kit and shown on the share screen, so two people can compare it.

## Test vectors

- The C2SP CCTV age vectors (the `cctv-age` package, hybrid stanza included) run in CI against the library the vault uses. Header-level failures are aliased, as the vectors' README allows.
- `packages/vault/test` holds table-driven tests for round trips, several recipients, revocation, rotation, wrong keys, the recovery envelope and the sharing-state cases (spec 0005 R1).

import { generateX25519Identity, identityToRecipient } from 'age-encryption';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  decryptDocument,
  encryptDocument,
  generateVaultIdentity,
  InvalidRecipients,
  InvalidVaultIdentity,
  recipientFingerprint,
  recipientOf,
  reencryptDocument,
  type VaultIdentity,
} from '../src/index.js';

const streamOf = (bytes: Uint8Array) => new Blob([new Uint8Array(bytes)]).stream();
const bytesOf = async (stream: ReadableStream<Uint8Array>) =>
  new Uint8Array(await new Response(stream).arrayBuffer());

async function encrypted(plaintext: Uint8Array, recipients: readonly string[]) {
  return bytesOf(await encryptDocument(streamOf(plaintext), recipients));
}

async function opened(ciphertext: Uint8Array, identity: VaultIdentity) {
  return bytesOf(await decryptDocument(streamOf(ciphertext), identity));
}

let owner: VaultIdentity;
let sharedWith: VaultIdentity;
let stranger: VaultIdentity;
beforeAll(async () => {
  [owner, sharedWith, stranger] = await Promise.all([
    generateVaultIdentity(),
    generateVaultIdentity(),
    generateVaultIdentity(),
  ]);
});

// Sizes around the 64 KiB STREAM chunk: empty, short, exactly one chunk, one more byte, several.
const sizes = [0, 1, 65_536, 65_537, 200_000];

describe('documents (spec 0005, R1)', () => {
  it('generates hybrid post-quantum identities', async () => {
    expect(await recipientOf(owner)).toMatch(/^age1pq1[02-9ac-hj-np-z]+$/);
    expect(await recipientOf(owner)).not.toBe(await recipientOf(sharedWith));
  });

  it.each(sizes)('round-trips %i bytes as a stream', async (size) => {
    const plaintext = crypto.getRandomValues(new Uint8Array(Math.min(size, 65_536)));
    const document = new Uint8Array(size).map((_, index) => plaintext[index % 65_536] ?? 0);
    const ciphertext = await encrypted(document, [await recipientOf(owner)]);
    expect(await opened(ciphertext, owner)).toEqual(document);
  });

  it('opens for every recipient and no one else', async () => {
    const document = new TextEncoder().encode('synthetic passport scan');
    const ciphertext = await encrypted(document, [
      await recipientOf(owner),
      await recipientOf(sharedWith),
    ]);
    expect(await opened(ciphertext, owner)).toEqual(document);
    expect(await opened(ciphertext, sharedWith)).toEqual(document);
    await expect(opened(ciphertext, stranger)).rejects.toThrow();
  });

  it('revokes by re-encrypting without the recipient', async () => {
    const document = new TextEncoder().encode('synthetic bank statement');
    const shared = await encrypted(document, [
      await recipientOf(owner),
      await recipientOf(sharedWith),
    ]);
    const revoked = await bytesOf(
      await reencryptDocument(streamOf(shared), owner, [await recipientOf(owner)]),
    );
    expect(await opened(revoked, owner)).toEqual(document);
    await expect(opened(revoked, sharedWith)).rejects.toThrow();
  });

  it('rotates by re-encrypting to a new identity', async () => {
    const document = new TextEncoder().encode('synthetic birth certificate');
    const rotated = await generateVaultIdentity();
    const before = await encrypted(document, [await recipientOf(owner)]);
    const after = await bytesOf(
      await reencryptDocument(streamOf(before), owner, [await recipientOf(rotated)]),
    );
    expect(await opened(after, rotated)).toEqual(document);
    await expect(opened(after, owner)).rejects.toThrow();
  });

  it('refuses a document whose ciphertext was changed', async () => {
    const ciphertext = await encrypted(new Uint8Array(1000), [await recipientOf(owner)]);
    ciphertext[ciphertext.length - 1] = (ciphertext.at(-1) ?? 0) ^ 1;
    await expect(opened(ciphertext, owner)).rejects.toThrow();
  });

  it.each([
    ['no recipients', () => Promise.resolve([])],
    [
      'an X25519-only recipient',
      async () => [await identityToRecipient(await generateX25519Identity())],
    ],
    ['a malformed hybrid recipient', () => Promise.resolve(['age1pq1notarecipient'])],
    ['a passphrase', () => Promise.resolve(['correct horse battery staple'])],
  ])('refuses %s', async (_case, recipients) => {
    await expect(
      encryptDocument(streamOf(new Uint8Array(1)), await recipients()),
    ).rejects.toBeInstanceOf(InvalidRecipients);
  });

  const framed = (secret: string) => {
    const parts = ['arca-vault-identity/v1', secret].map((text) => new TextEncoder().encode(text));
    const all = [...parts, new Uint8Array(32)];
    const out = new Uint8Array(all.reduce((size, part) => size + 4 + part.length, 0));
    let offset = 0;
    for (const part of all) {
      new DataView(out.buffer).setUint32(offset, part.length);
      out.set(part, offset + 4);
      offset += 4 + part.length;
    }
    return out;
  };

  it.each([
    ['empty bytes', new Uint8Array()],
    ['random bytes', crypto.getRandomValues(new Uint8Array(64))],
    ['a malformed hybrid secret', framed('AGE-SECRET-KEY-PQ-1XYZ')],
    ['an X25519 secret', framed('AGE-SECRET-KEY-1QQQQ')],
  ])('refuses %s as an identity', async (_case, bytes) => {
    await expect(
      decryptDocument(streamOf(new Uint8Array(1)), bytes as VaultIdentity),
    ).rejects.toBeInstanceOf(InvalidVaultIdentity);
  });

  it('gives a recipient a stable 128-bit fingerprint in eight groups', async () => {
    const recipient = await recipientOf(owner);
    const fingerprint = await recipientFingerprint(recipient);
    expect(fingerprint).toMatch(/^[0-9a-f]{4}( [0-9a-f]{4}){7}$/);
    expect(await recipientFingerprint(recipient)).toBe(fingerprint);
    expect(await recipientFingerprint(await recipientOf(sharedWith))).not.toBe(fingerprint);
  });
});

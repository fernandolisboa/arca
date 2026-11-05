import { beforeAll, describe, expect, it } from 'vitest';
import {
  documentMediaType,
  documentName,
  generateVaultIdentity,
  InvalidDocumentLabel,
  openDocumentLabel,
  recipientOf,
  sealDocumentLabel,
  type VaultIdentity,
} from '../src/index.js';

const hashOf = (text: string) =>
  crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(text))
    .then((digest) => new Uint8Array(digest));

let owner: VaultIdentity;
let sharedWith: VaultIdentity;
let stranger: VaultIdentity;
let ciphertextSha256: Uint8Array;
beforeAll(async () => {
  [owner, sharedWith, stranger] = await Promise.all([
    generateVaultIdentity(),
    generateVaultIdentity(),
    generateVaultIdentity(),
  ]);
  ciphertextSha256 = await hashOf('synthetic ciphertext');
});

const label = { name: 'passaporte-exemplo.pdf', type: 'application/pdf' };

describe('document labels (spec 0005, R4)', () => {
  it('opens for every recipient and no one else', async () => {
    const recipients = [await recipientOf(owner), await recipientOf(sharedWith)];
    const sealed = await sealDocumentLabel(label, ciphertextSha256, recipients);
    for (const identity of [owner, sharedWith]) {
      expect(await openDocumentLabel(sealed, identity, ciphertextSha256)).toEqual(label);
    }
    await expect(openDocumentLabel(sealed, stranger, ciphertextSha256)).rejects.toThrow(
      InvalidDocumentLabel,
    );
  });

  it('refuses a label moved onto another ciphertext', async () => {
    const sealed = await sealDocumentLabel(label, ciphertextSha256, [await recipientOf(owner)]);
    await expect(openDocumentLabel(sealed, owner, await hashOf('another'))).rejects.toThrow(
      'the label names another ciphertext',
    );
  });

  it.each([
    '',
    'a'.repeat(256),
    'line\nbreak.pdf',
    'tab\t.pdf',
    'invoice\u202efdp.exe',
    'right\u200fmark.pdf',
    'isolate\u2066.pdf',
    'zero\u200bwidth.pdf',
    'bom\ufeff.pdf',
  ])('refuses to seal the name %j', async (name) => {
    await expect(
      sealDocumentLabel({ name, type: 'application/pdf' }, ciphertextSha256, [
        await recipientOf(owner),
      ]),
    ).rejects.toThrow(InvalidDocumentLabel);
  });

  it('keeps names in any script, up to 255 characters', async () => {
    const recipients = [await recipientOf(owner)];
    for (const name of ['certidão de nascimento.jpg', 'パスポート.pdf', 'a'.repeat(255)]) {
      const sealed = await sealDocumentLabel({ name, type: '' }, ciphertextSha256, recipients);
      expect(await openDocumentLabel(sealed, owner, ciphertextSha256)).toEqual({
        name,
        type: 'application/octet-stream',
      });
    }
  });

  it.each([
    ['application/pdf', 'application/pdf'],
    ['IMAGE/JPEG', 'image/jpeg'],
    ['', 'application/octet-stream'],
    ['text/html; charset=utf-8', 'application/octet-stream'],
    ['not a type', 'application/octet-stream'],
  ])('reads the media type %j as %j', (type, expected) => {
    expect(documentMediaType(type)).toBe(expected);
  });

  it.each([
    ['passaporte.pdf', 'passaporte.pdf'],
    ['  linha\nquebrada.pdf ', 'linhaquebrada.pdf'],
    ['\u0007', ''],
    ['invoice\u202efdp.exe', 'invoicefdp.exe'],
    ['\u2067nome\u2069.pdf', 'nome.pdf'],
    [`${'a'.repeat(300)}.pdf`, `${'a'.repeat(251)}.pdf`],
    [`😀${'a'.repeat(254)}`, 'a'.repeat(254)],
  ])('names the file %j as %j', (fileName, expected) => {
    expect(documentName(fileName)).toBe(expected);
  });
});

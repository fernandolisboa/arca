import { base64urlnopad } from '@scure/base';
import { Decrypter } from 'age-encryption';
import { encrypterFor } from './documents.js';
import { identityParts, type VaultIdentity } from './identity.js';
import { utf8 } from './encoding.js';

/** What a person sees of a document before opening it: its file name and media type. */
export interface DocumentLabel {
  readonly name: string;
  readonly type: string;
}

export class InvalidDocumentLabel extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidDocumentLabel';
  }
}

const formatVersion = 1;
const maxNameLength = 255;
const fallbackType = 'application/octet-stream';
const mediaType = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

/**
 * Control characters, and the invisible and bidirectional format characters that could make a
 * name read as another, such as `invoice\u202efdp.exe` shown as `invoiceexe.pdf`.
 */
const hiddenCharacter =
  // eslint-disable-next-line no-control-regex -- control characters are exactly what it refuses
  /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;

function checkName(name: string): void {
  if (name.length === 0 || name.length > maxNameLength || hiddenCharacter.test(name)) {
    throw new InvalidDocumentLabel('a name has 1 to 255 characters and no hidden ones');
  }
}

/**
 * A file's name as a label can hold it: control characters dropped and, past 255 characters,
 * the end kept so the extension survives. Empty when nothing is left, for the caller to name.
 */
export function documentName(fileName: string): string {
  const cleaned = fileName.replace(new RegExp(hiddenCharacter, 'g'), '').trim();
  // A cut through a surrogate pair would leave half a character at the start.
  return cleaned.slice(-maxNameLength).replace(/^[\udc00-\udfff]/, '');
}

/** A browser reports an unknown file's type as empty; anything malformed is a plain file. */
export function documentMediaType(type: string): string {
  const lower = type.toLowerCase();
  return mediaType.test(lower) ? lower : fallbackType;
}

/**
 * Seals a document's name and media type to the same recipients as its ciphertext. The label
 * names the ciphertext's SHA-256, so a label moved onto another document does not open.
 */
export async function sealDocumentLabel(
  label: DocumentLabel,
  ciphertextSha256: Uint8Array,
  recipients: readonly string[],
): Promise<Uint8Array> {
  checkName(label.name);
  const plaintext = JSON.stringify({
    format: formatVersion,
    name: label.name,
    type: documentMediaType(label.type),
    sha256: base64urlnopad.encode(ciphertextSha256),
  });
  return encrypterFor(recipients).encrypt(utf8.encode(plaintext));
}

/** Opens a label, refusing one that is malformed or names another ciphertext. */
export async function openDocumentLabel(
  sealed: Uint8Array,
  identity: VaultIdentity,
  ciphertextSha256: Uint8Array,
): Promise<DocumentLabel> {
  const decrypter = new Decrypter();
  decrypter.addIdentity(identityParts(identity).secret);
  let value: unknown;
  try {
    value = JSON.parse(utf8.decode(await decrypter.decrypt(sealed)));
  } catch {
    throw new InvalidDocumentLabel('not a label this identity opens');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidDocumentLabel('not a label');
  }
  const { format, name, type, sha256 } = value as Record<string, unknown>;
  if (format !== formatVersion || typeof name !== 'string' || typeof type !== 'string') {
    throw new InvalidDocumentLabel('not a label');
  }
  if (sha256 !== base64urlnopad.encode(ciphertextSha256)) {
    throw new InvalidDocumentLabel('the label names another ciphertext');
  }
  checkName(name);
  return { name, type: documentMediaType(type) };
}

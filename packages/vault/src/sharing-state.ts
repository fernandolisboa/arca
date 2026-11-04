import { identityParts, type VaultIdentity } from './identity.js';
import { lengthPrefixed, utf8 } from './encoding.js';

/**
 * Who the owner's documents are encrypted to (ADR-0018). Every account a document is shared with
 * has a pinned recipient, and the owner is listed like anyone else.
 */
export interface SharingState {
  /** Each person's pinned recipient (`age1pq1…`), by account ID. */
  readonly pins: Readonly<Record<string, string>>;
  /** Each document's recipients, by document ID: account IDs. */
  readonly documents: Readonly<Record<string, readonly string[]>>;
}

/** A sharing state as the server stores it: the canonical state, its version and its tag. */
export interface TaggedSharingState {
  readonly accountId: string;
  readonly version: number;
  readonly state: Uint8Array;
  readonly tag: Uint8Array;
}

export type SharingStateCheck =
  | { readonly status: 'verified'; readonly version: number; readonly state: SharingState }
  /** Validly tagged but older than a version this device has seen: a restore or a replay. */
  | {
      readonly status: 'rolled_back';
      readonly version: number;
      readonly highestSeen: number;
      readonly state: SharingState;
    }
  /** A wrong tag, another account's state, or a malformed one. Never used. */
  | { readonly status: 'invalid' };

export interface SharingStateChanges {
  readonly pinsAdded: readonly { readonly accountId: string; readonly recipient: string }[];
  readonly pinsRemoved: readonly { readonly accountId: string; readonly recipient: string }[];
  readonly pinsChanged: readonly {
    readonly accountId: string;
    readonly from: string;
    readonly to: string;
  }[];
  readonly sharesAdded: readonly { readonly documentId: string; readonly accountId: string }[];
  readonly sharesRemoved: readonly { readonly documentId: string; readonly accountId: string }[];
}

const domainTag = 'arca-sharing-state/v1';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hybridRecipient = /^age1pq1[02-9ac-hj-np-z]+$/;
const formatVersion = 1;

export class InvalidSharingState extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidSharingState';
  }
}

/**
 * The canonical bytes of a state: JSON with sorted keys and sorted, unique recipient lists, so one
 * state has exactly one encoding.
 */
export function serializeSharingState(state: SharingState): Uint8Array {
  checkState(state);
  const sortedKeys = (record: Readonly<Record<string, unknown>>) => Object.keys(record).sort();
  const canonical = {
    format: formatVersion,
    pins: Object.fromEntries(sortedKeys(state.pins).map((id) => [id, state.pins[id]])),
    documents: Object.fromEntries(
      sortedKeys(state.documents).map((id) => [id, [...new Set(state.documents[id])].sort()]),
    ),
  };
  return utf8.encode(JSON.stringify(canonical));
}

/** Parses a state, refusing anything but its canonical encoding. */
export function parseSharingState(bytes: Uint8Array): SharingState {
  let value: unknown;
  try {
    value = JSON.parse(utf8.decode(bytes));
  } catch {
    throw new InvalidSharingState('not JSON');
  }
  if (!isRecord(value) || Object.keys(value).length !== 3 || value['format'] !== formatVersion) {
    throw new InvalidSharingState('not a sharing state');
  }
  const { pins, documents } = value;
  if (
    !isStringRecord(pins) ||
    !isRecord(documents) ||
    !Object.values(documents).every(isStringList)
  ) {
    throw new InvalidSharingState('not a sharing state');
  }
  const state: SharingState = { pins, documents: documents as Record<string, string[]> };
  const canonical = serializeSharingState(state);
  if (canonical.length !== bytes.length || canonical.some((byte, index) => byte !== bytes[index])) {
    throw new InvalidSharingState('not canonical');
  }
  return state;
}

/** Tags a state for an account and version under the identity's share key. */
export async function tagSharingState(
  identity: VaultIdentity,
  accountId: string,
  version: number,
  state: SharingState,
): Promise<TaggedSharingState> {
  checkVersion(version);
  const serialized = serializeSharingState(state);
  const key = await hmacKey(identity, 'sign');
  const tag = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, signedBytes(accountId, version, serialized)),
  );
  return { accountId, version, state: serialized, tag };
}

/**
 * Checks a stored state against the identity's share key, the account it must belong to and the
 * highest version this device has seen. Only a `verified` state may decide encryption.
 */
export async function verifySharingState(
  identity: VaultIdentity,
  accountId: string,
  tagged: TaggedSharingState,
  highestSeen?: number,
): Promise<SharingStateCheck> {
  if (
    tagged.accountId !== accountId ||
    !Number.isSafeInteger(tagged.version) ||
    tagged.version < 1
  ) {
    return { status: 'invalid' };
  }
  const key = await hmacKey(identity, 'verify');
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    new Uint8Array(tagged.tag),
    signedBytes(accountId, tagged.version, tagged.state),
  );
  if (!valid) return { status: 'invalid' };
  let state: SharingState;
  try {
    state = parseSharingState(tagged.state);
  } catch {
    return { status: 'invalid' };
  }
  if (highestSeen !== undefined && (!Number.isSafeInteger(highestSeen) || highestSeen < 1)) {
    return { status: 'invalid' };
  }
  if (highestSeen !== undefined && tagged.version < highestSeen) {
    return { status: 'rolled_back', version: tagged.version, highestSeen, state };
  }
  return { status: 'verified', version: tagged.version, state };
}

/** The version a re-tag uses: above every version the state or this device has seen. */
export function nextSharingStateVersion(...versions: readonly number[]): number {
  versions.forEach(checkVersion);
  return Math.max(0, ...versions) + 1;
}

/** What changes from one state to another, for the owner to confirm. */
export function sharingStateChanges(from: SharingState, to: SharingState): SharingStateChanges {
  checkState(from);
  checkState(to);
  const accountIds = [...new Set([...Object.keys(from.pins), ...Object.keys(to.pins)])].sort();
  const pinsAdded: { accountId: string; recipient: string }[] = [];
  const pinsRemoved: { accountId: string; recipient: string }[] = [];
  const pinsChanged: { accountId: string; from: string; to: string }[] = [];
  for (const accountId of accountIds) {
    const before = Object.hasOwn(from.pins, accountId) ? from.pins[accountId] : undefined;
    const after = Object.hasOwn(to.pins, accountId) ? to.pins[accountId] : undefined;
    if (before === undefined && after !== undefined)
      pinsAdded.push({ accountId, recipient: after });
    else if (before !== undefined && after === undefined) {
      pinsRemoved.push({ accountId, recipient: before });
    } else if (before !== undefined && after !== undefined && before !== after) {
      pinsChanged.push({ accountId, from: before, to: after });
    }
  }
  return {
    pinsAdded,
    pinsRemoved,
    pinsChanged,
    sharesAdded: sharesOnlyIn(to, from),
    sharesRemoved: sharesOnlyIn(from, to),
  };
}

function sharesOnlyIn(state: SharingState, other: SharingState) {
  return Object.keys(state.documents)
    .sort()
    .flatMap((documentId) => {
      const others = new Set(
        Object.hasOwn(other.documents, documentId) ? other.documents[documentId] : [],
      );
      return [...new Set(state.documents[documentId])]
        .sort()
        .filter((accountId) => !others.has(accountId))
        .map((accountId) => ({ documentId, accountId }));
    });
}

function signedBytes(
  accountId: string,
  version: number,
  state: Uint8Array,
): Uint8Array<ArrayBuffer> {
  return lengthPrefixed([
    utf8.encode(domainTag),
    utf8.encode(accountId),
    utf8.encode(String(version)),
    state,
  ]);
}

async function hmacKey(identity: VaultIdentity, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    identityParts(identity).shareKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

/**
 * IDs are lowercase UUIDs and pins hybrid recipients, so no key is integer-like or names a
 * prototype property, and sorting by UTF-16 units equals sorting by bytes in any implementation.
 */
function checkState(state: SharingState): void {
  const pins = Object.entries(state.pins);
  const documents = Object.entries(state.documents);
  if (!pins.every(([id, recipient]) => uuid.test(id) && hybridRecipient.test(recipient))) {
    throw new InvalidSharingState('a pin is not an account ID with a hybrid recipient');
  }
  for (const [documentId, recipients] of documents) {
    if (!uuid.test(documentId) || !recipients.every((accountId) => uuid.test(accountId))) {
      throw new InvalidSharingState('a document or account ID is not a lowercase UUID');
    }
    if (!recipients.every((accountId) => Object.hasOwn(state.pins, accountId))) {
      throw new InvalidSharingState('a document recipient has no pinned recipient');
    }
  }
}

function checkVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new InvalidSharingState('a version is a positive integer');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

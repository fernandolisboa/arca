import { maxDocumentBatch, type AccountLink } from '@arca/api-contract/client';
import { recipientFingerprint, type SharingState } from '@arca/vault';
import type { DocumentRecipient, OpenedDocument } from './documents.js';

/**
 * The owner's sharing state as this device checked it (ADR-0018). Only a `verified` state decides
 * whom a document is encrypted to; a `rolled_back` one waits for the owner to confirm it, and an
 * `invalid` one is never used.
 */
export interface SharingView {
  readonly status: 'verified' | 'rolled_back' | 'invalid';
  /** The version stored on the server, which the next change replaces; null when none is. */
  readonly storedVersion: number | null;
  /** The highest version this device has seen, if it remembers one. */
  readonly highestSeen: number | undefined;
  readonly state: SharingState;
}

/** A recipient as the share screen shows it, with the fingerprint two people compare. */
export interface ShownRecipient {
  readonly recipient: string;
  readonly fingerprint: string;
}

/** A linked account as the share screen shows it. */
export interface SharePerson {
  readonly accountId: string;
  readonly email: string;
  /**
   * `pinned`: the recipient the owner already trusts. `new`: a first share, which would trust the
   * server's recipient. `changed`: the server reports another recipient than the pinned one, used
   * only once the owner accepts it. `no_vault`: nothing to share to.
   */
  readonly trust: 'pinned' | 'new' | 'changed' | 'no_vault';
  /** The recipient the owner's sharing state pins for them. */
  readonly pinned: ShownRecipient | null;
  /** The server's recipient, for a first share or a changed key. */
  readonly offered: ShownRecipient | null;
}

export interface Sharing {
  readonly view: SharingView;
  readonly people: readonly SharePerson[];
}

const shown = async (recipient: string): Promise<ShownRecipient> => ({
  recipient,
  fingerprint: await recipientFingerprint(recipient),
});

export async function sharePerson(view: SharingView, link: AccountLink): Promise<SharePerson> {
  const pin = Object.hasOwn(view.state.pins, link.accountId)
    ? view.state.pins[link.accountId]
    : undefined;
  const pinned = pin === undefined ? null : await shown(pin);
  const offered =
    link.recipient === null || link.recipient === pin ? null : await shown(link.recipient);
  const trust =
    pinned !== null
      ? offered === null
        ? 'pinned'
        : 'changed'
      : offered === null
        ? 'no_vault'
        : 'new';
  return { accountId: link.accountId, email: link.email, trust, pinned, offered };
}

/**
 * The recipient each chosen person gets: the pinned one, unless the owner accepted the key the
 * server now reports for them (ADR-0018: another person's rotation changes their pin only after
 * the owner confirms the new fingerprint); a first share uses the one shown with its fingerprint.
 */
export function shareRecipients(
  people: readonly SharePerson[],
  chosen: ReadonlySet<string>,
  accepted: ReadonlySet<string>,
): DocumentRecipient[] {
  return people.flatMap(({ accountId, trust, pinned, offered }) => {
    if (!chosen.has(accountId)) return [];
    const used =
      trust === 'new' || (trust === 'changed' && accepted.has(accountId)) ? offered : pinned;
    return used === null ? [] : [{ accountId, recipient: used.recipient }];
  });
}

/** The state after a share: the owner's own pin, each person's, and this document's people. */
export function sharedState(
  state: SharingState,
  owner: DocumentRecipient,
  documentId: string,
  sharedWith: readonly DocumentRecipient[],
): SharingState {
  const pins: Record<string, string> = { ...state.pins, [owner.accountId]: owner.recipient };
  for (const { accountId, recipient } of sharedWith) pins[accountId] = recipient;
  const documents = Object.fromEntries(
    Object.entries(state.documents).filter(([id]) => id !== documentId),
  );
  if (sharedWith.length > 0) {
    documents[documentId] = sharedWith.map(({ accountId }) => accountId).sort();
  }
  return { pins, documents };
}

/** Whom the verified state shares a document with, by account ID. */
export function sharedInState(view: SharingView, documentId: string): readonly string[] {
  return Object.hasOwn(view.state.documents, documentId)
    ? (view.state.documents[documentId] ?? [])
    : [];
}

/** Enough ciphertext for one replacement to hold in memory at once. */
export const moveBatchBytes = 64 * 1024 * 1024;

/**
 * The owner's documents to encrypt again, grouped by the people the state shares each with (one
 * recipient list per replacement), each batch within the replace route's count and in memory.
 */
export function moveBatches(
  view: SharingView,
  documents: readonly OpenedDocument[],
): { sharedWith: DocumentRecipient[]; documents: OpenedDocument[] }[] {
  const groups = new Map<string, OpenedDocument[]>();
  for (const opened of documents) {
    const key = sharedInState(view, opened.document.id).join(',');
    groups.set(key, [...(groups.get(key) ?? []), opened]);
  }
  return [...groups].flatMap(([key, group]) => {
    const sharedWith = key
      .split(',')
      .filter((accountId) => accountId !== '' && Object.hasOwn(view.state.pins, accountId))
      .map((accountId) => ({ accountId, recipient: view.state.pins[accountId] ?? '' }));
    const batches: OpenedDocument[][] = [[]];
    let bytes = 0;
    for (const opened of group) {
      const last = batches.at(-1) ?? [];
      if (
        last.length > 0 &&
        (last.length === maxDocumentBatch || bytes + opened.document.size > moveBatchBytes)
      ) {
        batches.push([opened]);
        bytes = opened.document.size;
      } else {
        last.push(opened);
        bytes += opened.document.size;
      }
    }
    return batches.map((batch) => ({ sharedWith, documents: batch }));
  });
}

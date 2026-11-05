import { routes, type AccountLink } from '@arca/api-contract/client';
import type { Passkeys } from '@arca/platform';
import {
  nextSharingStateVersion,
  recipientFingerprint,
  tagSharingState,
  verifySharingState,
  type SharingState,
} from '@arca/vault';
import { queryOptions } from '@tanstack/react-query';
import { api } from './api.js';
import { base64url, fromBase64url } from './base64url.js';
import { inVaultWindow, replaceDocument, type OpenedDocument } from './documents.js';
import { reach } from './requests.js';
import type { UnlockedVault } from './vault-session.js';

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

/** A linked account as the share screen shows it, with the recipient a share would use. */
export interface SharePerson {
  readonly accountId: string;
  readonly email: string;
  /** The pinned recipient, or the server's for a first share or a changed key; null without one. */
  readonly recipient: string | null;
  readonly fingerprint: string | null;
  /**
   * `pinned`: the recipient the owner already trusts. `new`: a first share, trusting the server's
   * recipient. `changed`: their key changed since it was pinned. `no_vault`: nothing to share to.
   */
  readonly trust: 'pinned' | 'new' | 'changed' | 'no_vault';
}

export interface Sharing {
  readonly view: SharingView;
  readonly people: readonly SharePerson[];
}

/** The sharing state stored on the server does not verify, so nothing is shared until it does. */
export class SharingStateInvalid extends Error {
  override name = 'SharingStateInvalid';
}

const emptyState: SharingState = { pins: {}, documents: {} };

const versionKey = (accountId: string) => `arca.sharing-version.${accountId}`;

/** The highest version seen here; storage can be cleared, which the confirmation covers. */
function highestSeen(accountId: string): number | undefined {
  try {
    const version = Number(localStorage.getItem(versionKey(accountId)));
    return Number.isSafeInteger(version) && version > 0 ? version : undefined;
  } catch {
    return undefined;
  }
}

function rememberVersion(accountId: string, version: number): void {
  try {
    if ((highestSeen(accountId) ?? 0) < version) {
      localStorage.setItem(versionKey(accountId), String(version));
    }
  } catch {
    // Without storage this device cannot tell a rollback; the owner still confirms each change.
  }
}

async function checkedView(vault: UnlockedVault): Promise<SharingView> {
  const seen = highestSeen(vault.accountId);
  const { sharingState: stored } = await reach(api.call(routes.getSharingState));
  if (stored === null) {
    // A state this device saw is gone, as after a database restore.
    const status = seen === undefined ? 'verified' : 'rolled_back';
    return { status, storedVersion: null, highestSeen: seen, state: emptyState };
  }
  const check = await verifySharingState(
    vault.identity,
    vault.accountId,
    {
      accountId: vault.accountId,
      version: stored.version,
      state: fromBase64url(stored.state),
      tag: fromBase64url(stored.tag),
    },
    seen,
  );
  if (check.status === 'invalid') {
    return {
      status: 'invalid',
      storedVersion: stored.version,
      highestSeen: seen,
      state: emptyState,
    };
  }
  if (check.status === 'verified') rememberVersion(vault.accountId, check.version);
  return {
    status: check.status,
    storedVersion: stored.version,
    highestSeen: seen,
    state: check.state,
  };
}

async function person(view: SharingView, link: AccountLink): Promise<SharePerson> {
  const pinned = Object.hasOwn(view.state.pins, link.accountId)
    ? view.state.pins[link.accountId]
    : undefined;
  const trust =
    link.recipient === null
      ? pinned === undefined
        ? 'no_vault'
        : 'pinned'
      : pinned === undefined
        ? 'new'
        : pinned === link.recipient
          ? 'pinned'
          : 'changed';
  // A changed key is shown as the new one, which the owner confirms by sharing again.
  const recipient = trust === 'changed' || trust === 'new' ? link.recipient : (pinned ?? null);
  return {
    accountId: link.accountId,
    email: link.email,
    recipient,
    fingerprint: recipient === null ? null : await recipientFingerprint(recipient),
    trust,
  };
}

/**
 * The verified sharing state and the linked accounts to share with, in memory only while the
 * vault is open.
 */
export function sharingQuery(vault: UnlockedVault) {
  return queryOptions({
    queryKey: ['sharing', vault.accountId, vault.recipient],
    queryFn: async (): Promise<Sharing> => {
      const [view, { links }] = await Promise.all([
        checkedView(vault),
        reach(api.call(routes.listAccountLinks)),
      ]);
      return { view, people: await Promise.all(links.map((link) => person(view, link))) };
    },
    gcTime: 0,
    networkMode: 'always',
    retry: false,
  });
}

/** Tags a state above every version stored or seen, and stores it over the stored one. */
async function storeState(
  passkeys: Passkeys,
  vault: UnlockedVault,
  view: SharingView,
  state: SharingState,
) {
  const version = nextSharingStateVersion(
    ...[view.storedVersion, view.highestSeen].filter((seen) => typeof seen === 'number'),
  );
  const tagged = await tagSharingState(vault.identity, vault.accountId, version, state);
  await inVaultWindow(passkeys, () =>
    api.call(routes.storeSharingState, {
      recipient: vault.recipient,
      expectedVersion: view.storedVersion,
      sharingState: { version, state: base64url(tagged.state), tag: base64url(tagged.tag) },
    }),
  );
  rememberVersion(vault.accountId, version);
}

/** The owner confirms a rolled-back state as it stands, which re-tags it above both versions. */
export function confirmSharingState(passkeys: Passkeys, vault: UnlockedVault, view: SharingView) {
  if (view.status !== 'rolled_back') throw new SharingStateInvalid();
  return storeState(passkeys, vault, view, view.state);
}

/**
 * Shares one of the owner's documents with exactly the chosen people, revoking anyone else: the
 * state is stored first, so a failed upload leaves it stricter or ahead of the ciphertext, never
 * looser, and the next save re-encrypts to it.
 */
export async function shareDocument(
  passkeys: Passkeys,
  vault: UnlockedVault,
  { view, people }: Sharing,
  opened: OpenedDocument,
  chosen: ReadonlySet<string>,
) {
  if (view.status !== 'verified') throw new SharingStateInvalid();
  const sharedWith = people.flatMap(({ accountId, recipient }) =>
    chosen.has(accountId) && recipient !== null ? [{ accountId, recipient }] : [],
  );
  const pins: Record<string, string> = { ...view.state.pins, [vault.accountId]: vault.recipient };
  for (const { accountId, recipient } of sharedWith) pins[accountId] = recipient;
  const documentId = opened.document.id;
  const documents = Object.fromEntries(
    Object.entries(view.state.documents).filter(([id]) => id !== documentId),
  );
  if (sharedWith.length > 0) {
    documents[documentId] = sharedWith.map(({ accountId }) => accountId).sort();
  }
  await storeState(passkeys, vault, view, { pins, documents });
  await replaceDocument(passkeys, vault, opened, sharedWith);
}

/** Whom the verified state shares a document with, by account ID. */
export function sharedInState(view: SharingView, documentId: string): readonly string[] {
  return Object.hasOwn(view.state.documents, documentId)
    ? (view.state.documents[documentId] ?? [])
    : [];
}

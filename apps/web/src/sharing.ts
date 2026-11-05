import { routes, type SharingStateChange } from '@arca/api-contract/client';
import type { Passkeys } from '@arca/platform';
import {
  nextSharingStateVersion,
  tagSharingState,
  verifySharingState,
  type SharingState,
  type VaultIdentity,
} from '@arca/vault';
import { queryOptions } from '@tanstack/react-query';
import { api } from './api.js';
import { base64url, fromBase64url } from './base64url.js';
import { inVaultWindow, replaceDocuments, type OpenedDocument } from './documents.js';
import { reach } from './requests.js';
import {
  moveBatches,
  sharedState,
  sharePerson,
  shareRecipients,
  type Sharing,
  type SharingView,
} from './share-recipients.js';
import type { UnlockedVault } from './vault-session.js';

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

export function rememberVersion(accountId: string, version: number): void {
  try {
    if ((highestSeen(accountId) ?? 0) < version) {
      localStorage.setItem(versionKey(accountId), String(version));
    }
  } catch {
    // Without storage this device cannot tell a rollback; the owner still confirms each change.
  }
}

/** The stored sharing state, verified on this device under the current identity's share key. */
export async function checkedView(vault: UnlockedVault): Promise<SharingView> {
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
      return { view, people: await Promise.all(links.map((link) => sharePerson(view, link))) };
    },
    gcTime: 0,
    networkMode: 'always',
    retry: false,
    // A refetch under an open panel would change what the owner is looking at.
    refetchOnWindowFocus: false,
  });
}

const nextVersion = (view: SharingView) =>
  nextSharingStateVersion(
    ...[view.storedVersion, view.highestSeen].filter((seen) => typeof seen === 'number'),
  );

/** Tags a state above every version stored or seen, and stores it over the stored one. */
async function storeState(
  passkeys: Passkeys,
  vault: UnlockedVault,
  view: SharingView,
  state: SharingState,
) {
  const version = nextVersion(view);
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
  accepted: ReadonlySet<string>,
) {
  if (view.status !== 'verified') throw new SharingStateInvalid();
  const sharedWith = shareRecipients(people, chosen, accepted);
  const state = sharedState(
    view.state,
    { accountId: vault.accountId, recipient: vault.recipient },
    opened.document.id,
    sharedWith,
  );
  await storeState(passkeys, vault, view, state);
  await replaceDocuments(passkeys, vault, [opened], sharedWith);
}

/**
 * The verified state as a rotation stores it (ADR-0018): the owner's pin moved to the new
 * recipient and tagged under the new identity's share key, over the stored version; null when
 * none is stored. A state that is not verified is never carried over.
 */
export async function rotatedSharingState(
  vault: UnlockedVault,
  view: SharingView,
  identity: VaultIdentity,
  recipient: string,
): Promise<SharingStateChange | null> {
  if (view.status !== 'verified') throw new SharingStateInvalid();
  if (view.storedVersion === null) return null;
  const version = nextVersion(view);
  const state = { ...view.state, pins: { ...view.state.pins, [vault.accountId]: recipient } };
  const tagged = await tagSharingState(identity, vault.accountId, version, state);
  return {
    expectedVersion: view.storedVersion,
    sharingState: { version, state: base64url(tagged.state), tag: base64url(tagged.tag) },
  };
}

/**
 * Encrypts the owner's documents still opened only with a replaced identity again, to the
 * current one and the people the verified state shares each with, in batches.
 */
export async function moveDocuments(
  passkeys: Passkeys,
  vault: UnlockedVault,
  { view }: Sharing,
  stale: readonly OpenedDocument[],
) {
  if (view.status !== 'verified') throw new SharingStateInvalid();
  for (const { sharedWith, documents } of moveBatches(view, stale)) {
    await replaceDocuments(passkeys, vault, documents, sharedWith);
  }
}

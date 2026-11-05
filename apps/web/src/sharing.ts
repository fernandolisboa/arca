import { routes } from '@arca/api-contract/client';
import type { Passkeys } from '@arca/platform';
import {
  nextSharingStateVersion,
  tagSharingState,
  verifySharingState,
  type SharingState,
} from '@arca/vault';
import { queryOptions } from '@tanstack/react-query';
import { api } from './api.js';
import { base64url, fromBase64url } from './base64url.js';
import { inVaultWindow, replaceDocument, type OpenedDocument } from './documents.js';
import { reach } from './requests.js';
import {
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
  await replaceDocument(passkeys, vault, opened, sharedWith);
}

import { ApiError, routes, type VaultEnvelopesResponse } from '@arca/api-contract/client';
import {
  EnvelopeNotOpenedError,
  EnvelopeNotSealedError,
  type KeyContext,
  type KeyStorage,
  type Passkeys,
  type VaultEnvelopes,
} from '@arca/platform';
import {
  WrongRecoverySecret,
  generateRecoverySecret,
  generateVaultIdentity,
  openRecoveryEnvelope,
  recipientOf,
  sealRecoveryEnvelope,
  type VaultIdentity,
} from '@arca/vault';
import { api } from './api.js';
import { base64url, fromBase64url } from './base64url.js';
import { reach } from './requests.js';
import { checkedView, rememberVersion, rotatedSharingState } from './sharing.js';
import { approvedWith, openVaultWindow, stepUpFor } from './step-up.js';
import { holdVault, type UnlockedVault } from './vault-session.js';

/** What the vault screens need from the platform, so a native build can supply its own. */
export interface VaultDevice {
  readonly passkeys: Passkeys;
  readonly envelopes: VaultEnvelopes;
  /** Undefined where the device cannot keep a wrapped identity. */
  readonly keyStorage: KeyStorage | undefined;
  readonly relyingPartyId: string;
}

/** The opened identity is not the recipient the server says is current. */
export class WrongVaultIdentity extends Error {
  override name = 'WrongVaultIdentity';
}

/**
 * The account keeps an identity a rotation replaced that this device has not opened, so a new
 * secret cannot be sealed to it: its documents are opened with it first.
 */
export class RotatedVaultIdentity extends Error {
  override name = 'RotatedVaultIdentity';
}

/** The account keeps no identity a rotation replaced. */
export class NothingRetained extends Error {
  override name = 'NothingRetained';
}

const keyContext = (device: VaultDevice, accountId: string): KeyContext => ({
  accountId,
  relyingPartyId: device.relyingPartyId,
});

/** A passkey without PRF keeps the identity wrapped on the device instead (ADR-0018). */
async function sealForPasskey(
  device: VaultDevice,
  identity: VaultIdentity,
  credentialId: string,
): Promise<Uint8Array | undefined> {
  try {
    return (await device.envelopes.seal(identity, credentialId)).bytes;
  } catch (error) {
    if (error instanceof EnvelopeNotSealedError && error.reason === 'prf_unavailable') {
      return undefined;
    }
    throw error;
  }
}

async function keepWrapped(
  device: VaultDevice,
  accountId: string,
  identity: VaultIdentity,
): Promise<void> {
  await device.keyStorage?.store(keyContext(device, accountId), identity);
}

/**
 * First use (spec 0005, R2): a new identity, share key and vault recovery secret; the recovery
 * envelope opened once as a check; an envelope for the passkey that opened the window, or the
 * identity wrapped on a device without PRF; then the upload. Returns the secret to show once.
 */
export async function setUpVault(device: VaultDevice, accountId: string): Promise<string> {
  const credentialId = await openVaultWindow(device.passkeys);
  const identity = await generateVaultIdentity();
  const secret = generateRecoverySecret();
  const recoveryEnvelope = await sealRecoveryEnvelope(identity, secret);
  await openRecoveryEnvelope(recoveryEnvelope, secret);
  const sealed = await sealForPasskey(device, identity, credentialId);
  const recipient = await recipientOf(identity);
  await reach(
    api.call(routes.setUpVault, {
      recipient,
      passkeyEnvelopes:
        sealed === undefined ? [] : [{ credentialId, ciphertext: base64url(sealed) }],
      recoveryEnvelope: base64url(recoveryEnvelope),
    }),
  );
  if (sealed === undefined) await keepWrapped(device, accountId, identity);
  holdVault({ accountId, recipient, identity, retained: [] });
  return secret;
}

/** The window is open but neither the passkey nor the device opened the vault. */
export interface SecretNeeded {
  /** Opens the vault with the recovery secret, then seals for this passkey where it can. */
  readonly openWithSecret: (secret: string) => Promise<void>;
}

async function check(identity: VaultIdentity, recipient: string): Promise<VaultIdentity> {
  if ((await recipientOf(identity)) !== recipient) throw new WrongVaultIdentity();
  return identity;
}

/**
 * Unlock (spec 0005, R2): the `vault_unlock` window, then this passkey's envelope through its
 * PRF ceremony, else the identity wrapped on this device, else the recovery secret. `undefined`
 * once unlocked.
 */
export async function unlockVault(
  device: VaultDevice,
  accountId: string,
): Promise<SecretNeeded | undefined> {
  const credentialId = await openVaultWindow(device.passkeys);
  const kept: VaultEnvelopesResponse = await reach(api.call(routes.vaultEnvelopes));
  const current = kept.recipients.find((candidate) => candidate.current);
  if (current === undefined) throw new Error('the vault has no current recipient');
  const ofCurrent = kept.envelopes.filter((envelope) => envelope.recipientId === current.id);
  const own = ofCurrent.find((envelope) => envelope.credentialId === credentialId);
  const hold = (identity: VaultIdentity) => {
    holdVault({ accountId, recipient: current.recipient, identity, retained: [] });
  };

  let sealHere = own === undefined;
  if (own !== undefined) {
    try {
      const bytes = fromBase64url(own.ciphertext);
      hold(await check(await device.envelopes.open({ credentialId, bytes }), current.recipient));
      return undefined;
    } catch (error) {
      const unusable =
        error instanceof WrongVaultIdentity ||
        (error instanceof EnvelopeNotOpenedError && error.reason !== 'cancelled');
      if (!unusable) throw error;
      sealHere = false;
    }
  }

  const stored = await device.keyStorage?.load(keyContext(device, accountId));
  if (stored?.status === 'stored') {
    try {
      hold(await check(stored.secret as VaultIdentity, current.recipient));
      return undefined;
    } catch {
      await device.keyStorage?.forget();
    }
  }

  const recovery = ofCurrent.find((envelope) => envelope.kind === 'recovery');
  if (recovery === undefined) throw new Error('the current recipient has no recovery envelope');
  return {
    openWithSecret: async (secret) => {
      const identity = await check(
        await openRecoveryEnvelope(fromBase64url(recovery.ciphertext), secret),
        current.recipient,
      );
      hold(identity);
      if (!sealHere) {
        await keepWrapped(device, accountId, identity);
        return;
      }
      // A cancelled PRF prompt leaves the vault open; the envelope waits for the next unlock.
      const sealed = await sealForPasskey(device, identity, credentialId).catch(
        (error: unknown) => {
          if (error instanceof EnvelopeNotSealedError) return null;
          throw error;
        },
      );
      if (sealed === undefined) await keepWrapped(device, accountId, identity);
      if (sealed instanceof Uint8Array) {
        await reach(
          api.call(routes.addVaultEnvelope, { credentialId, ciphertext: base64url(sealed) }),
        );
      }
    },
  };
}

/** The kept envelopes, opening the `vault_unlock` window again if the unlock's has closed. */
async function keptEnvelopes(device: VaultDevice): Promise<VaultEnvelopesResponse> {
  try {
    return await reach(api.call(routes.vaultEnvelopes));
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 'step_up_required')) throw error;
    await openVaultWindow(device.passkeys);
    return reach(api.call(routes.vaultEnvelopes));
  }
}

/**
 * The identity sealed in each kept recovery envelope: the current one or one this device opened
 * from a rotation, so a new secret can be sealed to every one of them.
 */
async function sealedIdentities(vault: UnlockedVault, kept: VaultEnvelopesResponse) {
  const current = kept.recipients.find((candidate) => candidate.current);
  if (current?.recipient !== vault.recipient) throw new WrongVaultIdentity();
  const retained = await Promise.all(
    vault.retained.map(async (identity) => ({ identity, recipient: await recipientOf(identity) })),
  );
  const withRecovery = kept.recipients.filter(({ id }) =>
    kept.envelopes.some(({ recipientId, kind }) => recipientId === id && kind === 'recovery'),
  );
  return {
    current,
    sealed: withRecovery.map(({ id, recipient, current: isCurrent }) => {
      const identity = isCurrent
        ? vault.identity
        : retained.find((candidate) => candidate.recipient === recipient)?.identity;
      if (identity === undefined) throw new RotatedVaultIdentity();
      return { recipientId: id, identity };
    }),
  };
}

const sealedTo = (
  secret: string,
  sealed: readonly { recipientId: string; identity: VaultIdentity }[],
) =>
  Promise.all(
    sealed.map(async ({ recipientId, identity }) => ({
      recipientId,
      ciphertext: base64url(await sealRecoveryEnvelope(identity, secret)),
    })),
  );

/**
 * A new vault recovery secret, after an account recovery or a new recovery kit (spec 0003, R6):
 * every kept identity sealed to it, the current one opened once as a check, then a
 * `sensitive_settings` step-up replaces every recovery envelope, so the old secret opens none.
 * Returns the secret to show once.
 */
export async function replaceVaultSecret(
  device: VaultDevice,
  vault: UnlockedVault,
): Promise<string> {
  const { current, sealed } = await sealedIdentities(vault, await keptEnvelopes(device));
  const secret = generateRecoverySecret();
  const envelopes = await sealedTo(secret, sealed);
  const own = envelopes.find(({ recipientId }) => recipientId === current.id);
  if (own === undefined) throw new WrongVaultIdentity();
  await check(await openRecoveryEnvelope(fromBase64url(own.ciphertext), secret), vault.recipient);
  const approved = await stepUpFor(device.passkeys, {
    action: routes.resealVaultRecovery.operationId,
    targets: envelopes.map(({ recipientId }) => recipientId),
  });
  await reach(approved.call(routes.resealVaultRecovery, { envelopes }));
  return secret;
}

/**
 * Opens, on this device, the identities a rotation replaced, so documents still encrypted to
 * them open (ADR-0018): this passkey's envelope for each, else the vault recovery secret.
 * `undefined` once every one is open.
 */
export async function openRetained(
  device: VaultDevice,
  vault: UnlockedVault,
): Promise<SecretNeeded | undefined> {
  const credentialId = await openVaultWindow(device.passkeys);
  const kept: VaultEnvelopesResponse = await reach(api.call(routes.vaultEnvelopes));
  const rotated = kept.recipients.filter(({ current }) => !current);
  if (rotated.length === 0) throw new NothingRetained();
  const opened: VaultIdentity[] = [];
  const missing: typeof rotated = [];
  for (const candidate of rotated) {
    const own = kept.envelopes.find(
      ({ recipientId, credentialId: id }) => recipientId === candidate.id && id === credentialId,
    );
    const identity =
      own === undefined
        ? undefined
        : await device.envelopes
            .open({ credentialId, bytes: fromBase64url(own.ciphertext) })
            .then((found) => check(found, candidate.recipient))
            .catch(() => undefined);
    if (identity === undefined) missing.push(candidate);
    else opened.push(identity);
  }
  const hold = (more: readonly VaultIdentity[]) => {
    holdVault({ ...vault, retained: [...opened, ...more] });
  };
  if (missing.length === 0) {
    hold([]);
    return undefined;
  }
  return {
    openWithSecret: async (secret) => {
      const more = await Promise.all(
        missing.map(async ({ id, recipient }) => {
          const recovery = kept.envelopes.find(
            ({ recipientId, kind }) => recipientId === id && kind === 'recovery',
          );
          if (recovery === undefined) throw new WrongRecoverySecret();
          return check(
            await openRecoveryEnvelope(fromBase64url(recovery.ciphertext), secret),
            recipient,
          );
        }),
      );
      hold(more);
    },
  };
}

const pause = (milliseconds: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

/**
 * Sends a rotation and, when no answer comes back, asks whether it was stored anyway: the new
 * identity and secret exist only here, so a rotation that landed must still finish here.
 */
async function stored(recipient: string, rotate: () => Promise<unknown>): Promise<void> {
  try {
    await reach(rotate());
  } catch (error) {
    for (const wait of [0, 1000, 3000]) {
      await pause(wait);
      const status = await reach(api.call(routes.vaultStatus)).catch(() => undefined);
      if (status?.recipient === recipient) return;
      if (status !== undefined) break;
    }
    throw error;
  }
}

/**
 * Rotation (ADR-0018): a new identity and vault recovery secret, every kept identity sealed to
 * the secret, the verified sharing state re-tagged under the new share key, and an envelope for
 * the approving passkey (or the identity wrapped on a device without PRF), all stored in one
 * `sensitive_settings` step-up. The replaced identity stays open here for the documents still
 * encrypted to it. Returns the secret to show once.
 */
export async function rotateVault(device: VaultDevice, vault: UnlockedVault): Promise<string> {
  const view = await checkedView(vault);
  const { current, sealed } = await sealedIdentities(vault, await keptEnvelopes(device));
  const identity = await generateVaultIdentity();
  const recipient = await recipientOf(identity);
  const secret = generateRecoverySecret();
  const recoveryEnvelope = await sealRecoveryEnvelope(identity, secret);
  await check(await openRecoveryEnvelope(recoveryEnvelope, secret), recipient);
  const keptRecoveryEnvelopes = await sealedTo(secret, sealed);
  const sharingState = await rotatedSharingState(vault, view, identity, recipient);
  const { client, credentialId } = await approvedWith(device.passkeys, {
    action: routes.rotateVaultIdentity.operationId,
    targets: [current.id],
    fields: { recipient },
  });
  const passkeyEnvelope = await sealForPasskey(device, identity, credentialId);
  await stored(recipient, () =>
    client.call(routes.rotateVaultIdentity, {
      from: current.id,
      recipient,
      passkeyEnvelopes:
        passkeyEnvelope === undefined
          ? []
          : [{ credentialId, ciphertext: base64url(passkeyEnvelope) }],
      recoveryEnvelope: base64url(recoveryEnvelope),
      sharingState,
      keptRecoveryEnvelopes,
    }),
  );
  if (sharingState !== null) rememberVersion(vault.accountId, sharingState.sharingState.version);
  if (passkeyEnvelope === undefined) await keepWrapped(device, vault.accountId, identity);
  holdVault({
    accountId: vault.accountId,
    recipient,
    identity,
    retained: [vault.identity, ...vault.retained],
  });
  return secret;
}

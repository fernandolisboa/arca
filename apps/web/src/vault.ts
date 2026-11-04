import { routes, type VaultEnvelopesResponse } from '@arca/api-contract/client';
import {
  EnvelopeNotOpenedError,
  EnvelopeNotSealedError,
  type KeyContext,
  type KeyStorage,
  type Passkeys,
  type VaultEnvelopes,
} from '@arca/platform';
import {
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
import { openVaultWindow } from './step-up.js';
import { holdVault } from './vault-session.js';

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
  holdVault({ accountId, recipient, identity });
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
    holdVault({ accountId, recipient: current.recipient, identity });
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

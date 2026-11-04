import { generateKeyPairSync, randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { databaseServer } from './servers.js';

/** A COSE EC2 P-256 ES256 public key in CBOR, as the passkey plugin stores it. */
function coseKey(x: Buffer, y: Buffer): string {
  return Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    x,
    Buffer.from([0x22, 0x58, 0x20]),
    y,
  ]).toString('base64');
}

export interface Credential {
  readonly credentialId: string;
  readonly privateKey: string;
  readonly publicKey: string;
}

export function newCredential(): Credential {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const { x, y } = publicKey.export({ format: 'jwk' });
  return {
    credentialId: randomBytes(16).toString('base64url'),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    publicKey: coseKey(Buffer.from(String(x), 'base64url'), Buffer.from(String(y), 'base64url')),
  };
}

/** Chromium's virtual platform authenticator, holding one discoverable credential. */
export async function virtualAuthenticator(
  page: Page,
  credential: Credential,
  {
    userId,
    userVerified = true,
    signCount = 0,
  }: {
    readonly userId: string;
    readonly userVerified?: boolean;
    /** Where its counter starts; two authenticators holding one credential need distinct ones. */
    readonly signCount?: number;
  },
) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      hasPrf: true,
      isUserVerified: userVerified,
      automaticPresenceSimulation: true,
    },
  });
  const hold = async (held: Credential, owner: string, from = signCount) => {
    await cdp.send('WebAuthn.clearCredentials', { authenticatorId });
    await cdp.send('WebAuthn.addCredential', {
      authenticatorId,
      credential: {
        credentialId: Buffer.from(held.credentialId, 'base64url').toString('base64'),
        isResidentCredential: true,
        rpId: databaseServer.rpId,
        privateKey: held.privateKey,
        userHandle: Buffer.from(owner.replaceAll('-', ''), 'hex').toString('base64'),
        signCount: from,
      },
    });
  };
  await hold(credential, userId);
  /** Swaps the credential it holds for another, its counter starting at `from`. */
  return {
    hold,
    /** Empties it, so it can create a credential the account already excludes. */
    clear: async (): Promise<void> => {
      await cdp.send('WebAuthn.clearCredentials', { authenticatorId });
    },
  };
}

/**
 * Chromium's virtual authenticator answers an autofill request on its own, so the button tests
 * turn autofill off to reach the button.
 */
export async function withoutAutofill(page: Page) {
  await page.addInitScript(() => {
    PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
  });
}

import { createECDH } from 'node:crypto';
import type { Logger } from '@arca/telemetry';
import type { DeploymentEnvironment } from '../config.js';

/**
 * Each environment's VAPID public key, base64url of the uncompressed P-256 point (spec 0005, R7).
 * The matching private keys are Sensitive Vercel variables; null leaves push off there.
 */
export const vapidPublicKeys: Readonly<Record<DeploymentEnvironment, string | null>> = {
  production: null,
  preview: null,
  development: null,
};

export interface VapidKeys {
  readonly publicKey: string;
  /** The private scalar, base64url. */
  readonly privateKey: string;
}

const scalar = /^[A-Za-z0-9_-]{43}$/;

/**
 * The environment's key pair, when its private key is set and belongs to its public key; a
 * malformed or mismatched one leaves push off rather than sending what no browser accepts.
 */
export function vapidKeysFor(
  environment: DeploymentEnvironment,
  privateKey: string | undefined,
  publicKeys: Readonly<Record<DeploymentEnvironment, string | null>> = vapidPublicKeys,
): VapidKeys | undefined {
  const publicKey = publicKeys[environment];
  if (publicKey === null || privateKey === undefined || !scalar.test(privateKey)) return undefined;
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    if (ecdh.getPublicKey().toString('base64url') !== publicKey) return undefined;
  } catch {
    return undefined;
  }
  return { publicKey, privateKey };
}

/** The key pair, logging a set private key that was refused, never its value. */
export function configuredVapidKeys(
  environment: DeploymentEnvironment,
  privateKey: string | undefined,
  logger: Logger,
): VapidKeys | undefined {
  const keys = vapidKeysFor(environment, privateKey);
  if (keys === undefined && privateKey !== undefined) {
    logger.error({ errorName: 'vapid_key_rejected' });
  }
  return keys;
}

import { describe, expect, it } from 'vitest';
import { stepUpChallenge, subjectHash } from '../src/auth/step-up-encoding.js';
import {
  reverifyStepUp,
  type Expected,
  type StoredAssertion,
} from '../src/auth/step-up-reverify.js';
import { softwarePasskey } from './software-passkey.js';

const origin = 'http://localhost:3000';
const rpId = 'localhost';
const nonce = new Uint8Array(32).fill(0x22);
const actionNonce = new Uint8Array(16).fill(0x33);
const subjectA = subjectHash({ action: 'revokeSession', targets: ['a'], nonce: actionNonce });
const subjectB = subjectHash({ action: 'revokeSession', targets: ['b'], nonce: actionNonce });

const bytes = (base64url: string) => new Uint8Array(Buffer.from(base64url, 'base64url'));
const keyOf = (passkey: ReturnType<typeof softwarePasskey>) =>
  new Uint8Array(Buffer.from(passkey.publicKey, 'base64'));

/** A step-up for subject A, stored as `auth.step_up` keeps it. */
function storedFor(passkey = softwarePasskey(rpId), { userVerified = true } = {}) {
  const challenge = Buffer.from(stepUpChallenge('sensitive_settings', subjectA, nonce));
  const { response } = passkey.assert({
    challenge: challenge.toString('base64url'),
    origin,
    userVerified,
  });
  const stored: StoredAssertion = {
    credentialId: passkey.credentialId,
    nonce,
    authenticatorData: bytes(response.authenticatorData),
    clientDataJson: bytes(response.clientDataJSON),
    signature: bytes(response.signature),
  };
  const expected: Expected = {
    purpose: 'sensitive_settings',
    subjectHash: subjectA,
    credentialId: passkey.credentialId,
    publicKey: keyOf(passkey),
    rpId,
    origin,
  };
  return { stored, expected };
}

const flipped = (data: Uint8Array, index: number) => {
  const copy = new Uint8Array(data);
  copy[index] = (copy[index] ?? 0) ^ 0x01;
  return copy;
};

describe('re-verifying a stored step-up (spec 0003, R5)', () => {
  it('accepts the assertion for the purpose, subject and key it was made for', async () => {
    const { stored, expected } = storedFor();
    expect(await reverifyStepUp(stored, expected)).toBe(true);
  });

  it('can be run again, since it never checks the counter', async () => {
    const { stored, expected } = storedFor();
    await reverifyStepUp(stored, expected);
    expect(await reverifyStepUp(stored, expected)).toBe(true);
  });

  const other = softwarePasskey(rpId);
  it.each<[string, (expected: Expected) => Expected]>([
    ['offered as approval of subject B', (e) => ({ ...e, subjectHash: subjectB })],
    ['offered for another purpose', (e) => ({ ...e, purpose: 'data_export' })],
    [
      'offered for vault_unlock',
      (e) => ({ ...e, purpose: 'vault_unlock', subjectHash: new Uint8Array(0) }),
    ],
    [
      'checked against a credential it does not name',
      (e) => ({ ...e, credentialId: other.credentialId }),
    ],
    ['checked against any other key', (e) => ({ ...e, publicKey: keyOf(other) })],
    ['checked for another origin', (e) => ({ ...e, origin: 'http://localhost:4174' })],
    ['checked for another relying party', (e) => ({ ...e, rpId: 'arca.filx.app' })],
  ])('rejects an assertion %s', async (_, change) => {
    const { stored, expected } = storedFor();
    expect(await reverifyStepUp(stored, change(expected))).toBe(false);
  });

  it('rejects a stored credential ID that is not the caller key’s, even with its key', async () => {
    const passkey = softwarePasskey(rpId);
    const { stored, expected } = storedFor(passkey);
    expect(await reverifyStepUp({ ...stored, credentialId: other.credentialId }, expected)).toBe(
      false,
    );
  });

  it.each<[string, (stored: StoredAssertion) => StoredAssertion]>([
    ['authenticator data', (s) => ({ ...s, authenticatorData: flipped(s.authenticatorData, 33) })],
    ['client data', (s) => ({ ...s, clientDataJson: flipped(s.clientDataJson, 10) })],
    ['signature', (s) => ({ ...s, signature: flipped(s.signature, 20) })],
    ['nonce', (s) => ({ ...s, nonce: flipped(s.nonce, 0) })],
  ])('rejects tampered %s', async (_, tamper) => {
    const { stored, expected } = storedFor();
    expect(await reverifyStepUp(tamper(stored), expected)).toBe(false);
  });

  it('rejects an assertion made without user verification', async () => {
    const { stored, expected } = storedFor(softwarePasskey(rpId), { userVerified: false });
    expect(await reverifyStepUp(stored, expected)).toBe(false);
  });
});

import type { VaultIdentity } from '@arca/vault';
import { armor } from 'age-encryption';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runConformance, vaultEnvelopesConformance } from '../src/conformance/index.js';
import { EnvelopeNotOpenedError, EnvelopeNotSealedError } from '../src/vault-envelopes.js';
import { createWebVaultEnvelopes, fido2prfIdentity } from '../src/web-vault-envelopes.js';
import { fakePrfAuthenticator } from './fake-prf-authenticator.js';
import { fido2prfVector as vector } from './fixtures/fido2prf-vector.js';

const utf8 = new TextEncoder();
const otherCredential = 'synthetic-credential-two';
const credentialWithoutPrf = 'synthetic-credential-without';

beforeEach(() => {
  vi.stubGlobal('navigator', {
    credentials: fakePrfAuthenticator(
      vector.relyingPartyId,
      new Map<string, Uint8Array<ArrayBuffer> | 'no-prf'>([
        [vector.credentialId, utf8.encode(vector.authenticatorSecret)],
        [otherCredential, utf8.encode('another synthetic credRandom!!!!')],
        [credentialWithoutPrf, 'no-prf'],
      ]),
    ),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the web VaultEnvelopes adapter (spec 0005, R5)', () => {
  const envelopes = () => createWebVaultEnvelopes(vector.relyingPartyId);

  it('passes the conformance suite', async () => {
    const cases = vaultEnvelopesConformance({
      envelopes: envelopes(),
      identity: crypto.getRandomValues(new Uint8Array(120)) as VaultIdentity,
      credentialIds: [vector.credentialId, otherCredential],
    });
    expect((await runConformance(cases)).filter((result) => result.error !== undefined)).toEqual(
      [],
    );
  });

  it('encodes the pinned fido2prf identity', () => {
    expect(fido2prfIdentity(vector.credentialId, vector.relyingPartyId)).toBe(
      vector.identityString,
    );
  });

  it('opens the envelope pinned at adoption', async () => {
    const opened = await envelopes().open({
      credentialId: vector.credentialId,
      bytes: armor.decode(vector.envelope),
    });
    expect(new TextDecoder().decode(opened)).toBe(vector.sealed);
  });

  it('does not open the pinned envelope for another relying party', async () => {
    await expect(
      createWebVaultEnvelopes('other.example.com').open({
        credentialId: vector.credentialId,
        bytes: armor.decode(vector.envelope),
      }),
    ).rejects.toMatchObject({ name: 'EnvelopeNotOpenedError', reason: 'not_opened' });
  });

  it('reports a refused ceremony as cancelled', async () => {
    const identity = utf8.encode('synthetic') as VaultIdentity;
    const envelope = await envelopes().seal(identity, otherCredential);
    const gone = 'synthetic-credential-unknown';
    await expect(envelopes().open({ ...envelope, credentialId: gone })).rejects.toMatchObject(
      new EnvelopeNotOpenedError('cancelled'),
    );
    await expect(envelopes().seal(identity, gone)).rejects.toMatchObject(
      new EnvelopeNotSealedError('cancelled'),
    );
  });

  it('reports a passkey without PRF as prf_unavailable', async () => {
    const identity = utf8.encode('synthetic') as VaultIdentity;
    await expect(envelopes().seal(identity, credentialWithoutPrf)).rejects.toMatchObject({
      name: 'EnvelopeNotSealedError',
      reason: 'prf_unavailable',
    });
    const envelope = await envelopes().seal(identity, otherCredential);
    await expect(
      envelopes().open({ ...envelope, credentialId: credentialWithoutPrf }),
    ).rejects.toMatchObject({ name: 'EnvelopeNotOpenedError', reason: 'prf_unavailable' });
  });
});

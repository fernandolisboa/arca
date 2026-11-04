import type { VaultIdentity } from '@arca/vault';
import { describe, expect, it } from 'vitest';
import {
  capabilitiesConformance,
  deepLinksConformance,
  filesConformance,
  keyStorageConformance,
  notificationsConformance,
  runConformance,
  sharingConformance,
  vaultEnvelopesConformance,
  type ConformanceCase,
} from '../src/conformance/index.js';
import { fakeCapabilities, fakePlatform, fakeVaultEnvelopes } from './fakes.js';

const suites = (harness: ReturnType<typeof fakePlatform>): Record<string, ConformanceCase[]> => ({
  capabilities: capabilitiesConformance(harness.capabilities),
  files: filesConformance(harness),
  'key storage': keyStorageConformance(harness),
  notifications: notificationsConformance(harness),
  sharing: sharingConformance(harness),
  'deep links': deepLinksConformance(harness),
});

describe.each([
  ['available', true],
  ['unavailable', false],
])('the conformance suites with every capability %s (spec 0005, R5)', (_case, available) => {
  for (const [suite, cases] of Object.entries(suites(fakePlatform(fakeCapabilities(available))))) {
    it(`the fakes pass ${suite}`, async () => {
      expect(cases.length).toBeGreaterThan(0);
      expect((await runConformance(cases)).filter((result) => result.error !== undefined)).toEqual(
        [],
      );
    });
  }
});

describe('the VaultEnvelopes conformance suite (spec 0005, R5)', () => {
  it('passes with the fake', async () => {
    const identity = crypto.getRandomValues(new Uint8Array(120)) as VaultIdentity;
    const cases = vaultEnvelopesConformance({
      envelopes: fakeVaultEnvelopes(),
      identity,
      credentialIds: ['Y3JlZC1h', 'Y3JlZC1i'],
    });
    expect((await runConformance(cases)).filter((result) => result.error !== undefined)).toEqual(
      [],
    );
  });

  it('catches an adapter that opens with any passkey', async () => {
    const envelopes = fakeVaultEnvelopes();
    const lax = {
      ...envelopes,
      open: (envelope: { credentialId: string; bytes: Uint8Array }) =>
        envelopes.open({ ...envelope, credentialId: 'Y3JlZC1h' }),
    };
    const results = await runConformance(
      vaultEnvelopesConformance({
        envelopes: lax,
        identity: new Uint8Array(32) as VaultIdentity,
        credentialIds: ['Y3JlZC1h', 'Y3JlZC1i'],
      }),
    );
    expect(
      results.find((result) => result.name === 'does not open with another passkey')?.error,
    ).toBeDefined();
  });
});

import type { VaultIdentity } from '@arca/vault';
import type { VaultEnvelopes } from '../vault-envelopes.js';
import { check, rejectsWith, sameBytes, type ConformanceCase } from './check.js';

export interface VaultEnvelopesHarness {
  readonly envelopes: VaultEnvelopes;
  readonly identity: VaultIdentity;
  /** Two passkeys the person has, each answering its own ceremony. */
  readonly credentialIds: readonly [string, string];
}

export function vaultEnvelopesConformance(harness: VaultEnvelopesHarness): ConformanceCase[] {
  const { envelopes, identity, credentialIds } = harness;
  const [first, second] = credentialIds;
  return [
    {
      name: 'opens what it sealed',
      run: async () => {
        const envelope = await envelopes.seal(identity, first);
        check(envelope.credentialId === first, 'the envelope names another passkey');
        check(sameBytes(await envelopes.open(envelope), identity), 'the identity differs');
      },
    },
    {
      name: 'seals the same identity differently each time',
      run: async () => {
        const [a, b] = await Promise.all([
          envelopes.seal(identity, first),
          envelopes.seal(identity, first),
        ]);
        check(!sameBytes(a.bytes, b.bytes), 'two seals are identical');
      },
    },
    {
      name: 'does not open with another passkey',
      run: async () => {
        const envelope = await envelopes.seal(identity, first);
        await rejectsWith(
          () => envelopes.open({ ...envelope, credentialId: second }),
          'EnvelopeNotOpenedError',
        );
      },
    },
    {
      name: 'does not open a changed envelope',
      run: async () => {
        const envelope = await envelopes.seal(identity, first);
        const bytes = new Uint8Array(envelope.bytes);
        bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 1;
        await rejectsWith(() => envelopes.open({ ...envelope, bytes }), 'EnvelopeNotOpenedError');
      },
    },
  ];
}

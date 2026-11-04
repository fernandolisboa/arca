import { beforeAll, describe, expect, it } from 'vitest';
import {
  generateVaultIdentity,
  InvalidSharingState,
  nextSharingStateVersion,
  parseSharingState,
  serializeSharingState,
  sharingStateChanges,
  tagSharingState,
  verifySharingState,
  type SharingState,
  type TaggedSharingState,
  type VaultIdentity,
} from '../src/index.js';

const owner = '0b9c3d6e-1f2a-4b5c-8d7e-9f0a1b2c3d4e';
const other = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';
const third = '3c2d1e0f-9a8b-4c7d-8e6f-5a4b3c2d1e0f';
const documentA = 'd0c0a000-0000-4000-8000-00000000000a';
const documentB = 'd0c0b000-0000-4000-8000-00000000000b';

// Synthetic recipients in the bech32 alphabet: the state pins them and never decrypts.
const ownStateV1: SharingState = {
  pins: { [owner]: 'age1pq1qqqq', [other]: 'age1pq1pppp' },
  documents: { [documentA]: [owner, other], [documentB]: [owner] },
};
const ownStateV2: SharingState = {
  pins: { [owner]: 'age1pq1qqqq', [other]: 'age1pq1pppp', [third]: 'age1pq1zzzz' },
  documents: { [documentA]: [owner], [documentB]: [owner, third] },
};

let identity: VaultIdentity;
let otherIdentity: VaultIdentity;
let v1: TaggedSharingState;
let v2: TaggedSharingState;
beforeAll(async () => {
  [identity, otherIdentity] = await Promise.all([generateVaultIdentity(), generateVaultIdentity()]);
  v1 = await tagSharingState(identity, owner, 1, ownStateV1);
  v2 = await tagSharingState(identity, owner, 2, ownStateV2);
});

describe('the sharing state (spec 0005, R1)', () => {
  it.each([
    ['a valid state', () => verifySharingState(identity, owner, v2), 'verified'],
    [
      'the newest state a device has seen',
      () => verifySharingState(identity, owner, v2, 2),
      'verified',
    ],
    [
      'a wrong tag',
      () =>
        verifySharingState(identity, owner, {
          ...v2,
          tag: v2.tag.map((byte, i) => (i === 0 ? byte ^ 1 : byte)),
        }),
      'invalid',
    ],
    [
      'a state tagged under another share key',
      async () =>
        verifySharingState(
          identity,
          owner,
          await tagSharingState(otherIdentity, owner, 3, ownStateV1),
        ),
      'invalid',
    ],
    [
      'an older state relabelled with a higher version',
      () => verifySharingState(identity, owner, { ...v1, version: 3 }),
      'invalid',
    ],
    [
      "another account's state",
      async () =>
        verifySharingState(identity, owner, await tagSharingState(identity, other, 2, ownStateV1)),
      'invalid',
    ],
    [
      "another account's state relabelled as the owner's",
      async () =>
        verifySharingState(identity, owner, {
          ...(await tagSharingState(identity, other, 2, ownStateV1)),
          accountId: owner,
        }),
      'invalid',
    ],
    ['a lower restored version', () => verifySharingState(identity, owner, v1, 2), 'rolled_back'],
    [
      'a version that is not a positive integer',
      () => verifySharingState(identity, owner, { ...v1, version: 0 }),
      'invalid',
    ],
  ])('%s is %s', async (_case, check, status) => {
    expect((await check()).status).toBe(status);
  });

  it('returns the state it verified', async () => {
    const check = await verifySharingState(identity, owner, v1, 2);
    expect(check).toEqual({ status: 'rolled_back', version: 1, highestSeen: 2, state: ownStateV1 });
  });

  it('re-tags a confirmed state above every version seen, under a new share key', async () => {
    const rotated = await generateVaultIdentity();
    const version = nextSharingStateVersion(v1.version, 2);
    const retagged = await tagSharingState(rotated, owner, version, ownStateV1);
    expect(version).toBe(3);
    expect((await verifySharingState(rotated, owner, retagged, 2)).status).toBe('verified');
    expect((await verifySharingState(identity, owner, retagged, 2)).status).toBe('invalid');
  });

  it('lists what changes for the owner to confirm', () => {
    expect(sharingStateChanges(ownStateV1, ownStateV2)).toEqual({
      pinsAdded: [{ accountId: third, recipient: 'age1pq1zzzz' }],
      pinsRemoved: [],
      pinsChanged: [],
      sharesAdded: [{ documentId: documentB, accountId: third }],
      sharesRemoved: [{ documentId: documentA, accountId: other }],
    });
    expect(
      sharingStateChanges(ownStateV1, {
        ...ownStateV1,
        pins: { ...ownStateV1.pins, [other]: 'age1pq1new' },
      }).pinsChanged,
    ).toEqual([{ accountId: other, from: 'age1pq1pppp', to: 'age1pq1new' }]);
  });

  it('encodes one state one way, whatever the order it was built in', () => {
    const reordered: SharingState = {
      pins: { [other]: 'age1pq1pppp', [owner]: 'age1pq1qqqq' },
      documents: { [documentB]: [owner], [documentA]: [other, owner, other] },
    };
    expect(serializeSharingState(reordered)).toEqual(serializeSharingState(ownStateV1));
    expect(parseSharingState(serializeSharingState(reordered))).toEqual(ownStateV1);
  });

  it.each([
    ['not JSON', 'not json'],
    ['another format', '{"format":2,"pins":{},"documents":{}}'],
    ['an extra key', '{"format":1,"pins":{},"documents":{},"extra":1}'],
    ['keys out of order', '{"format":1,"documents":{},"pins":{}}'],
    [
      'a recipient without a pin',
      `{"format":1,"pins":{},"documents":{"${documentA}":["${owner}"]}}`,
    ],
    ['spacing', '{"format":1, "pins":{},"documents":{}}'],
    [
      'a recipient named after a prototype property',
      `{"format":1,"pins":{},"documents":{"${documentA}":["constructor"]}}`,
    ],
    ['a __proto__ pin', '{"format":1,"pins":{"__proto__":"age1pq1qqqq"},"documents":{}}'],
    [
      'integer-like document IDs',
      `{"format":1,"pins":{"${owner}":"age1pq1qqqq"},"documents":{"10":["${owner}"],"9":["${owner}"]}}`,
    ],
    [
      'an upper-case account ID',
      `{"format":1,"pins":{"${owner.toUpperCase()}":"age1pq1qqqq"},"documents":{}}`,
    ],
    ['an X25519 pin', `{"format":1,"pins":{"${owner}":"age1qqqq"},"documents":{}}`],
  ])('refuses a state with %s', (_case, text) => {
    expect(() => parseSharingState(new TextEncoder().encode(text))).toThrow(InvalidSharingState);
  });

  it.each([Number.NaN, -1, 0, 1.5])('refuses %d as the highest version seen', async (seen) => {
    expect((await verifySharingState(identity, owner, v2, seen)).status).toBe('invalid');
  });

  it('refuses to diff a state that names a prototype property', () => {
    const planted = { pins: {}, documents: { [documentA]: ['constructor'] } };
    expect(() => sharingStateChanges(ownStateV1, planted)).toThrow(InvalidSharingState);
  });

  it('refuses to tag a state with an unpinned recipient or a bad version', async () => {
    const unpinned: SharingState = { pins: {}, documents: { [documentA]: [owner] } };
    await expect(tagSharingState(identity, owner, 1, unpinned)).rejects.toThrow(
      InvalidSharingState,
    );
    await expect(tagSharingState(identity, owner, 0, ownStateV1)).rejects.toThrow(
      InvalidSharingState,
    );
    await expect(tagSharingState(identity, owner, 1.5, ownStateV1)).rejects.toThrow(
      InvalidSharingState,
    );
  });
});

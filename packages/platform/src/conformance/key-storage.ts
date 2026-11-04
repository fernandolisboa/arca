import type { Capabilities } from '../capabilities.js';
import type { KeyContext, KeyStorage } from '../key-storage.js';
import { check, rejectsWith, sameBytes, type ConformanceCase } from './check.js';

export interface KeyStorageHarness {
  readonly capabilities: Capabilities;
  readonly keyStorage: KeyStorage;
  /** Drops everything the way the system would, as a browser evicting site data. */
  readonly evict: () => Promise<void>;
}

const owner: KeyContext = {
  accountId: '0b9c3d6e-1f2a-4b5c-8d7e-9f0a1b2c3d4e',
  relyingPartyId: 'arca.example.com',
};
const secret = new Uint8Array(64).map((_, index) => index);

export function keyStorageConformance(harness: KeyStorageHarness): ConformanceCase[] {
  const { capabilities, keyStorage, evict } = harness;
  const available = capabilities.has('keyStorage');
  const stored = async () => {
    await keyStorage.forget();
    check((await keyStorage.store(owner, secret)) === 'stored', 'the secret was not stored');
  };
  const notStored = async (context: KeyContext, message: string) => {
    check((await keyStorage.load(context)).status === 'not stored', message);
  };
  if (!available) {
    return [
      {
        name: 'refuses every call while unavailable',
        run: async () => {
          await rejectsWith(() => keyStorage.store(owner, secret), 'CapabilityUnavailableError');
          await rejectsWith(() => keyStorage.load(owner), 'CapabilityUnavailableError');
          await rejectsWith(() => keyStorage.forget(), 'CapabilityUnavailableError');
        },
      },
    ];
  }
  return [
    {
      name: 'loads the secret it stored',
      run: async () => {
        await stored();
        const loaded = await keyStorage.load(owner);
        check(loaded.status === 'stored', 'the secret did not load');
        check(sameBytes(loaded.secret, secret), 'the loaded secret differs');
      },
    },
    {
      name: 'replaces the stored secret',
      run: async () => {
        await stored();
        const next = new Uint8Array(32).fill(7);
        await keyStorage.store(owner, next);
        const loaded = await keyStorage.load(owner);
        check(loaded.status === 'stored' && sameBytes(loaded.secret, next), 'not replaced');
      },
    },
    {
      name: 'reports nothing stored on a new device',
      run: async () => {
        await keyStorage.forget();
        await notStored(owner, 'a forgotten secret loaded');
      },
    },
    {
      name: 'does not open for another account',
      run: async () => {
        await stored();
        await notStored(
          { ...owner, accountId: '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d' },
          "another account's load opened the secret",
        );
      },
    },
    {
      name: 'does not open for another relying party',
      run: async () => {
        await stored();
        await notStored(
          { ...owner, relyingPartyId: 'other.example.com' },
          "another relying party's load opened the secret",
        );
      },
    },
    {
      name: 'reports an evicted secret as not stored',
      run: async () => {
        await stored();
        await evict();
        await notStored(owner, 'an evicted secret loaded');
      },
    },
    {
      name: 'forgets the secret',
      run: async () => {
        await stored();
        await keyStorage.forget();
        await notStored(owner, 'a forgotten secret loaded');
      },
    },
  ];
}

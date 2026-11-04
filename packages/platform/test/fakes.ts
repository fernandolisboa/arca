import type { VaultIdentity } from '@arca/vault';
import {
  capabilities as all,
  createWebDeepLinks,
  EnvelopeNotOpenedError,
  NotificationsDeniedError,
  type Capabilities,
  type Capability,
  type KeyContext,
  type Platform,
  type VaultEnvelopes,
} from '../src/index.js';
import { capabilitiesFrom, guarded } from '../src/capabilities.js';
import type { ChosenFile } from '../src/conformance/index.js';

export const origin = 'https://arca.example.com';

export function fakeCapabilities(available: boolean): Capabilities {
  return capabilitiesFrom(
    Object.fromEntries(
      all.map((capability) => [capability, available ? undefined : 'unsupported']),
    ),
  );
}

/** Every port in memory, as a native adapter's tests would drive it without a device. */
export function fakePlatform(capabilities: Capabilities) {
  const port = <Args extends unknown[], Result>(
    capability: Capability,
    method: (...args: Args) => Result,
  ) => guarded(capabilities, capability, method);
  let choice: readonly ChosenFile[] = [];
  let stored: { context: KeyContext; secret: Uint8Array } | undefined;
  let prompt: 'granted' | 'denied' = 'denied';
  let permission: 'granted' | 'denied' | 'prompt' = 'prompt';
  let shareSheet: 'shared' | 'cancelled' = 'shared';
  let inbox: File[] = [];
  const chosen = () =>
    choice.map((file) => new File([file.content], file.name, { type: file.type }));
  const platform: Platform = {
    capabilities,
    filePicking: { pick: port('filePicking', chosen) },
    documentCapture: { capture: port('documentCapture', () => chosen()[0]) },
    keyStorage: {
      store: port('keyStorage', (context: KeyContext, secret: Uint8Array) => {
        stored = { context, secret: new Uint8Array(secret) };
        return 'stored' as const;
      }),
      load: port('keyStorage', (context: KeyContext) =>
        stored?.context.accountId === context.accountId &&
        stored.context.relyingPartyId === context.relyingPartyId
          ? { status: 'stored' as const, secret: new Uint8Array(stored.secret) }
          : { status: 'not stored' as const },
      ),
      forget: port('keyStorage', () => {
        stored = undefined;
      }),
    },
    notifications: {
      permission: port('notifications', () => permission),
      subscribe: port('notifications', () => {
        permission = prompt;
        if (prompt !== 'granted') throw new NotificationsDeniedError('refused');
        return { endpoint: 'https://push.example.com/synthetic', p256dh: 'BPk', auth: 'AAA' };
      }),
      unsubscribe: port('notifications', () => undefined),
    },
    sharing: { share: port('sharing', () => shareSheet) },
    sharedFiles: {
      take: port('receiveSharedFiles', () => {
        const files = inbox;
        inbox = [];
        return files;
      }),
    },
    deepLinks: createWebDeepLinks(capabilities, origin),
  };
  const set =
    <Value>(assign: (value: Value) => void) =>
    (value: Value) => {
      assign(value);
      return Promise.resolve();
    };
  return {
    ...platform,
    respond: set((next: readonly ChosenFile[]) => (choice = next)),
    evict: () => {
      stored = undefined;
      return Promise.resolve();
    },
    answerPrompt: set((answer: 'granted' | 'denied') => (prompt = answer)),
    answerShareSheet: set((answer: 'shared' | 'cancelled') => (shareSheet = answer)),
    receive: set((files: readonly File[]) => (inbox = [...inbox, ...files])),
    pushService: true,
    origin,
  };
}

/** Envelopes under one random AES-GCM key per passkey, standing in for its PRF output. */
export function fakeVaultEnvelopes(): VaultEnvelopes {
  const keys = new Map<string, CryptoKey>();
  const keyFor = async (credentialId: string) => {
    const key =
      keys.get(credentialId) ??
      (await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ]));
    keys.set(credentialId, key);
    return key;
  };
  return {
    seal: async (identity, credentialId) => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          await keyFor(credentialId),
          new Uint8Array(identity),
        ),
      );
      const bytes = new Uint8Array(iv.length + sealed.length);
      bytes.set(iv);
      bytes.set(sealed, iv.length);
      return { credentialId, bytes };
    },
    open: async ({ credentialId, bytes }) => {
      try {
        const opened = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: new Uint8Array(bytes.subarray(0, 12)) },
          await keyFor(credentialId),
          new Uint8Array(bytes.subarray(12)),
        );
        return new Uint8Array(opened) as VaultIdentity;
      } catch {
        throw new EnvelopeNotOpenedError('not opened');
      }
    },
  };
}

import { describe, expect, it } from 'vitest';
import {
  createPasskeys,
  PasskeyOptionsRefusedError,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type WebAuthnBrowser,
} from '../src/index.js';

const assertion: AuthenticationResponseJSON = {
  id: 'Y3JlZA',
  rawId: 'Y3JlZA',
  type: 'public-key',
  response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' },
  clientExtensionResults: {
    prf: { enabled: true, results: { first: new ArrayBuffer(32) } },
    credProps: { rk: true },
  } as AuthenticationResponseJSON['clientExtensionResults'],
};

const attestation: RegistrationResponseJSON = {
  id: 'Y3JlZA',
  rawId: 'Y3JlZA',
  type: 'public-key',
  response: { clientDataJSON: 'e30', attestationObject: 'AA' },
  clientExtensionResults: {
    prf: { enabled: false, results: { first: new ArrayBuffer(32) } },
  } as RegistrationResponseJSON['clientExtensionResults'],
};

function fakeBrowser(supported = true) {
  const calls: unknown[] = [];
  let cancelled = 0;
  const browser: WebAuthnBrowser = {
    supported: () => supported,
    autofillSupported: () => Promise.resolve(true),
    startRegistration: (settings) => {
      calls.push(settings);
      return Promise.resolve(attestation);
    },
    startAuthentication: (settings) => {
      calls.push(settings);
      return Promise.resolve(assertion);
    },
    cancelCeremony: () => {
      cancelled += 1;
    },
  };
  return { browser, calls, cancelled: () => cancelled };
}

const requestOptions: PublicKeyCredentialRequestOptionsJSON = {
  challenge: 'Y2hhbGxlbmdl',
  rpId: 'localhost',
  userVerification: 'required',
};

describe('the Passkeys port (spec 0003, R3)', () => {
  it('passes the options through and starts autofill only when asked', async () => {
    const { browser, calls } = fakeBrowser();
    const passkeys = createPasskeys(browser);
    await passkeys.get(requestOptions);
    await passkeys.get(requestOptions, { autofill: true });
    expect(calls).toEqual([
      { optionsJSON: requestOptions, useBrowserAutofill: false },
      { optionsJSON: requestOptions, useBrowserAutofill: true },
    ]);
  });

  it.each([
    ['prf.eval', { prf: { eval: { first: 'AA' } } }],
    ['prf.evalByCredential', { prf: { evalByCredential: { Y3JlZA: { first: 'AA' } } } }],
    ['an extension outside the allow-list', { credProps: true }],
    ['extensions that are not an object', 'prf'],
  ])('refuses options carrying %s, before the browser sees them', async (_label, extensions) => {
    const { browser, calls } = fakeBrowser();
    const passkeys = createPasskeys(browser);
    const options = { ...requestOptions, extensions } as PublicKeyCredentialRequestOptionsJSON;
    await expect(passkeys.get(options)).rejects.toThrow(PasskeyOptionsRefusedError);
    await expect(
      passkeys.create({
        challenge: 'Y2hhbGxlbmdl',
        rp: { name: 'Arca' },
        user: { id: 'dQ', name: 'u', displayName: 'u' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        extensions,
      } as Parameters<typeof passkeys.create>[0]),
    ).rejects.toThrow(PasskeyOptionsRefusedError);
    expect(calls).toEqual([]);
  });

  it('lets registration ask whether PRF is supported', async () => {
    const { browser, calls } = fakeBrowser();
    const options = {
      challenge: 'Y2hhbGxlbmdl',
      rp: { name: 'Arca' },
      user: { id: 'dQ', name: 'u', displayName: 'u' },
      pubKeyCredParams: [{ type: 'public-key' as const, alg: -7 }],
      extensions: { prf: {} },
    } as Parameters<ReturnType<typeof createPasskeys>['create']>[0];
    await createPasskeys(browser).create(options);
    expect(calls).toEqual([{ optionsJSON: options }]);
  });

  it('sends only prf.enabled among the extension results, never PRF outputs', async () => {
    const passkeys = createPasskeys(fakeBrowser().browser);
    expect((await passkeys.get(requestOptions)).clientExtensionResults).toEqual({
      prf: { enabled: true },
    });
    const created = await passkeys.create({
      challenge: 'Y2hhbGxlbmdl',
      rp: { name: 'Arca' },
      user: { id: 'dQ', name: 'u', displayName: 'u' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    });
    expect(created.clientExtensionResults).toEqual({ prf: { enabled: false } });
  });

  it('cancels a waiting ceremony through the browser', () => {
    const fake = fakeBrowser();
    createPasskeys(fake.browser).cancel();
    expect(fake.cancelled()).toBe(1);
  });

  it('offers no autofill where passkeys are unavailable', async () => {
    const passkeys = createPasskeys(fakeBrowser(false).browser);
    await expect(passkeys.isAvailable()).resolves.toBe(false);
    await expect(passkeys.supportsAutofill()).resolves.toBe(false);
  });
});

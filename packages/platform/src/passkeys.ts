import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';

export type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
};

/**
 * Passkeys as WebAuthn JSON in and out (spec 0003, R3). UI code calls only this port, so a native
 * adapter (Android Credential Manager, Apple's passkey APIs) can replace the web one.
 */
export interface Passkeys {
  /** Whether this device can use passkeys at all. */
  isAvailable(): Promise<boolean>;
  /** Whether the browser can offer passkeys in a field's autofill (conditional UI). */
  supportsAutofill(): Promise<boolean>;
  create(options: PublicKeyCredentialCreationOptionsJSON): Promise<RegistrationResponseJSON>;
  /** With `autofill`, waits for the person to pick a passkey from a field's suggestions. */
  get(
    options: PublicKeyCredentialRequestOptionsJSON,
    settings?: { readonly autofill?: boolean },
  ): Promise<AuthenticationResponseJSON>;
  /** Ends a ceremony still waiting, such as an autofill `get`, which then rejects with AbortError. */
  cancel(): void;
}

/** Options asked for something the port does not allow, such as evaluating PRF here. */
export class PasskeyOptionsRefusedError extends Error {
  override name = 'PasskeyOptionsRefusedError';
}

/**
 * The only extension allowed is PRF at registration, and only to learn whether it is supported:
 * evaluating it would derive the vault key in a ceremony meant for something else (ADR-0018).
 */
function checkExtensions(extensions: unknown, { prf }: { readonly prf: boolean }): void {
  if (extensions === undefined) return;
  if (typeof extensions !== 'object' || extensions === null) {
    throw new PasskeyOptionsRefusedError('extensions must be an object');
  }
  for (const [name, value] of Object.entries(extensions as Record<string, unknown>)) {
    if (name !== 'prf' || !prf) {
      throw new PasskeyOptionsRefusedError(`extension ${name} is not allowed`);
    }
    if (typeof value !== 'object' || value === null || Object.keys(value).length > 0) {
      throw new PasskeyOptionsRefusedError('prf may only be requested empty');
    }
  }
}

/** Only `prf.enabled` leaves the device among the extension results; never PRF outputs. */
function keepPrfEnabled(results: unknown): Record<string, unknown> {
  const prf = (results as { prf?: { enabled?: unknown } } | undefined)?.prf;
  return typeof prf?.enabled === 'boolean' ? { prf: { enabled: prf.enabled } } : {};
}

/** The browser calls the web adapter needs; injected so the checks are tested without a browser. */
export interface WebAuthnBrowser {
  readonly supported: () => boolean;
  readonly autofillSupported: () => Promise<boolean>;
  readonly startRegistration: (settings: {
    optionsJSON: PublicKeyCredentialCreationOptionsJSON;
  }) => Promise<RegistrationResponseJSON>;
  readonly startAuthentication: (settings: {
    optionsJSON: PublicKeyCredentialRequestOptionsJSON;
    useBrowserAutofill?: boolean;
  }) => Promise<AuthenticationResponseJSON>;
  readonly cancelCeremony: () => void;
}

export function createPasskeys(browser: WebAuthnBrowser): Passkeys {
  return {
    isAvailable: () => Promise.resolve(browser.supported()),
    supportsAutofill: () =>
      browser.supported() ? browser.autofillSupported() : Promise.resolve(false),
    async create(options) {
      checkExtensions(options.extensions, { prf: true });
      const response = await browser.startRegistration({ optionsJSON: options });
      return {
        ...response,
        clientExtensionResults: keepPrfEnabled(response.clientExtensionResults),
      };
    },
    async get(options, { autofill = false } = {}) {
      checkExtensions(options.extensions, { prf: false });
      const response = await browser.startAuthentication({
        optionsJSON: options,
        useBrowserAutofill: autofill,
      });
      return {
        ...response,
        clientExtensionResults: keepPrfEnabled(response.clientExtensionResults),
      };
    },
    cancel: () => {
      browser.cancelCeremony();
    },
  };
}

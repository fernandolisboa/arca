/** The parts of the Trusted Types API this app uses; TypeScript's DOM library does not ship it. */
interface TrustedTypePolicy {
  createScriptURL(input: string): unknown;
}

interface TrustedTypePolicyFactory {
  createPolicy(
    name: string,
    rules: { createScriptURL: (input: string) => string },
  ): TrustedTypePolicy;
}

declare global {
  // Absent in browsers without Trusted Types.
  var trustedTypes: TrustedTypePolicyFactory | undefined;
}

/** The service worker's URL: the build writes it at the site root (vite.config.ts). */
export const serviceWorkerUrl = '/sw.js';

/** The CSP allows one policy, `arca` (spec 0001, R4), and a policy name can be created once. */
let policy: TrustedTypePolicy | undefined;

/**
 * The service worker URL as a TrustedScriptURL. The policy returns only that one known URL, so
 * no other script URL can pass through it.
 */
export function trustedServiceWorkerUrl(): string {
  const factory = globalThis.trustedTypes;
  if (factory === undefined) return serviceWorkerUrl;
  policy ??= factory.createPolicy('arca', {
    createScriptURL: (input) => {
      if (input !== serviceWorkerUrl) throw new TypeError('script URL is not allowed');
      return input;
    },
  });
  // register() accepts a TrustedScriptURL wherever it accepts a string.
  return policy.createScriptURL(serviceWorkerUrl) as string;
}

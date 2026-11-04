import { createWebPasskeys, createWebPlatform } from '@arca/platform';

/** The web adapters of the platform ports; a native build swaps this module. */
export const passkeys = createWebPasskeys();

const web = createWebPlatform();

/** Undefined where the device cannot keep a wrapped vault identity. */
export const keyStorage = web.capabilities.has('keyStorage') ? web.keyStorage : undefined;

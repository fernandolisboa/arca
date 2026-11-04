import { createWebPasskeys } from '@arca/platform';

/** The web adapters of the platform ports; a native build swaps this module. */
export const passkeys = createWebPasskeys();

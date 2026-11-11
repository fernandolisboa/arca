import { databaseServer, signedOutOrigin } from './servers.js';

/** The app's `arca.tour` entry with every tour seen (the ids of `src/tour/tours.ts`). */
const seen = JSON.stringify({ v: 1, seen: ['app', 'compare', 'family', 'vault'] });

/**
 * Browser storage in which the guided tour is over, so no coach mark covers the screen another
 * suite is testing. The tour's own tests start from `notToured`.
 */
export const toured = {
  cookies: [],
  origins: [signedOutOrigin, databaseServer.origin].map((origin) => ({
    origin,
    localStorage: [{ name: 'arca.tour', value: seen }],
  })),
};

export const notToured = { cookies: [], origins: [] };

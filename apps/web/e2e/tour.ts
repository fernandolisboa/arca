import { databaseServer, signedOutOrigin } from './servers.js';

/**
 * The app's `arca.tour` entry with every tour seen. The ids repeat `src/tour/tours.ts`, which this
 * project cannot import; a hint missing here covers its screen and fails that screen's tests.
 */
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

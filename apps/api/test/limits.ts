import type { AuthLimits } from '../src/app.js';
import type { RateLimiter } from '../src/auth/rate-limit.js';

/** A limiter that lets everything through, for tests about something else. */
export const allowAll: RateLimiter = {
  hit: () => Promise.resolve({ allowed: true }),
  sweep: () => Promise.resolve(0),
};

export const noLimits: AuthLimits = { limiter: allowAll, clientAddress: () => '192.0.2.1' };

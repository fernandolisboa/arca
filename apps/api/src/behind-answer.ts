import type { BehindAnswer } from './auth/recovery.js';

/**
 * The platform's `waitUntil` for this request, which Nitro sets on Vercel and in Node, so work
 * started before the answer still finishes after it. Without one (the Hono test client) the work
 * simply runs on.
 */
export function behindAnswerOf(request: Request): BehindAnswer {
  const { waitUntil } = request as { waitUntil?: (work: Promise<void>) => void };
  return (work) => {
    waitUntil?.(work);
  };
}

import type { BehindAnswer } from './auth/recovery.js';

/**
 * The platform's `waitUntil` for this request, which Nitro sets on Vercel and in Node, so work
 * started before the answer still finishes after it. Without one the work simply runs on, and
 * `onMissing` reports it: on Vercel the work could then be cut off.
 */
export function behindAnswerOf(request: Request, onMissing: () => void): BehindAnswer {
  const { waitUntil } = request as { waitUntil?: (work: Promise<void>) => void };
  return (work) => {
    if (waitUntil === undefined) onMissing();
    else waitUntil(work);
  };
}

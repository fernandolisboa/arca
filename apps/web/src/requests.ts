import { ApiError } from '@arca/api-contract/client';

/** The API could not be reached: fetch rejected before any response arrived. */
export class UnreachableError extends Error {
  override name = 'UnreachableError';
}

/** Tells a failed fetch apart from any other TypeError, such as malformed ceremony options. */
export async function reach<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    throw error instanceof TypeError
      ? new UnreachableError(error.message, { cause: error })
      : error;
  }
}

/** What went wrong around a passkey ceremony, as the screens word it. */
export type CommonFailure = 'cancelled' | 'closed' | 'limited' | 'unreachable' | 'other';

/**
 * The failures every passkey screen shares; an API error a screen words itself is left to the
 * caller through `apiCode`.
 */
export function commonFailure(error: unknown): CommonFailure;
export function commonFailure<Code extends string>(
  error: unknown,
  apiCode: (error: ApiError) => Code | undefined,
): CommonFailure | Code;
export function commonFailure(
  error: unknown,
  apiCode: (error: ApiError) => string | undefined = () => undefined,
): string {
  if (error instanceof ApiError) {
    if (error.code === 'accounts_closed') return 'closed';
    return apiCode(error) ?? (error.status === 429 ? 'limited' : 'other');
  }
  if (error instanceof UnreachableError) return 'unreachable';
  // Browsers report a dismissed prompt, a timeout and a failed verification alike.
  if (error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
    return 'cancelled';
  }
  return 'other';
}

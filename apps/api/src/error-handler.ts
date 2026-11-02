import type { ErrorResponse } from '@arca/api-contract/routes';
import { securityHeaders } from '@arca/security-policy';
import type { ErrorCode } from './app.js';
import { createLogger, type Logger } from './logger.js';

/** The fields Nitro's errors carry that this handler reads. */
interface NitroError {
  readonly name?: unknown;
  readonly status?: unknown;
  readonly unhandled?: unknown;
  /** For an unhandled error, what was thrown; h3 wraps it in an HTTPError. */
  readonly cause?: unknown;
}

function nameOf(error: NitroError): string | undefined {
  const source = error.unhandled === true && error.cause instanceof Error ? error.cause : error;
  return typeof source.name === 'string' ? source.name : undefined;
}

function statusOf(error: NitroError): number {
  const { status, unhandled } = error;
  return unhandled !== true &&
    typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
    ? status
    : 500;
}

function codeFor(status: number): ErrorCode {
  if (status === 404) return 'not_found';
  return status >= 500 ? 'internal_error' : 'request_failed';
}

/**
 * Answers errors that never reach the API's own handler: a malformed URL, a module that fails to
 * load, a Nitro route outside Hono. Nitro's default handler builds fresh headers, so its responses
 * would lack the security headers, and it echoes the error's message. This one sets the headers,
 * returns only an error code, and logs the status and the error's class name, never its message.
 */
export function createErrorHandler(logger: Logger) {
  return (error: NitroError): Response => {
    const status = statusOf(error);
    const code = codeFor(status);
    const errorName = nameOf(error);
    logger[status >= 500 ? 'error' : 'info']({
      status,
      errorCode: code,
      ...(errorName === undefined ? {} : { errorName }),
    });
    return Response.json({ error: { code } } satisfies ErrorResponse, {
      status,
      headers: { ...securityHeaders, 'cache-control': 'no-store' },
    });
  };
}

export default createErrorHandler(createLogger());

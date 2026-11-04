import { securityHeaders } from '@arca/security-policy';
import { describe, expect, it } from 'vitest';
import { createErrorHandler } from '../src/error-handler.js';
import type { LogEntry } from '@arca/telemetry';

function handlerWithLog() {
  const entries: { level: string; entry: LogEntry }[] = [];
  const handle = createErrorHandler({
    info: (entry) => entries.push({ level: 'info', entry }),
    error: (entry) => entries.push({ level: 'error', entry }),
  });
  return { handle, entries };
}

describe('error handler', () => {
  it.each([
    [{ name: 'HTTPError', status: 400 }, 400, 'request_failed'],
    [{ name: 'HTTPError', status: 404 }, 404, 'not_found'],
    [{ name: 'HTTPError', status: 503 }, 503, 'internal_error'],
    [{ name: 'HTTPError', status: 302 }, 500, 'internal_error'],
    [{ name: 'HTTPError', status: 'teapot' }, 500, 'internal_error'],
    [{ name: 'HTTPError', status: 400, unhandled: true }, 500, 'internal_error'],
  ])('answers %o with %i %s and every security header', async (error, status, code) => {
    const { handle } = handlerWithLog();
    const response = handle(error);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code } });
    expect(response.headers.get('cache-control')).toBe('no-store');
    for (const [name, value] of Object.entries(securityHeaders)) {
      expect(response.headers.get(name), name).toBe(value);
    }
  });

  it('logs the thrown class name for an unhandled error, never its message', () => {
    const { handle, entries } = handlerWithLog();
    const cause = new TypeError('synthetic detail');
    handle({ name: 'HTTPError', status: 500, unhandled: true, cause });
    expect(entries).toEqual([
      {
        level: 'error',
        entry: { status: 500, errorCode: 'internal_error', errorName: 'TypeError' },
      },
    ]);
  });

  it('logs a client error at info level', () => {
    const { handle, entries } = handlerWithLog();
    handle({ name: 'HTTPError', status: 400 });
    expect(entries).toEqual([
      {
        level: 'info',
        entry: { status: 400, errorCode: 'request_failed', errorName: 'HTTPError' },
      },
    ]);
  });
});

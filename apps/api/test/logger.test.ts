import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger.js';

describe('logger', () => {
  it('writes allow-listed fields and drops everything else', () => {
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line));
    logger.info({
      requestId: 'r-1',
      route: '/v1/health',
      status: 200,
      durationMs: 3,
      // A field outside the allow-list, as a careless caller might pass it.
      ...({ email: 'someone@example.test', body: { name: 'x' } } as object),
    });
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { level: 'info', requestId: 'r-1', route: '/v1/health', status: 200, durationMs: 3 },
    ]);
  });

  it('cannot be told to change its level through the entry', () => {
    const lines: string[] = [];
    createLogger((line) => lines.push(line)).error({ level: 'info', errorCode: 'internal_error' });
    expect(JSON.parse(lines[0] ?? '')).toEqual({ level: 'error', errorCode: 'internal_error' });
  });
});

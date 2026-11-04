import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/index.js';

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
    createLogger((line) => lines.push(line)).error({
      errorCode: 'internal_error',
      ...({ level: 'info' } as object),
    });
    expect(JSON.parse(lines[0] ?? '')).toEqual({ level: 'error', errorCode: 'internal_error' });
  });

  it('drops values that do not fit their field', () => {
    const lines: string[] = [];
    createLogger((line) => lines.push(line)).error({
      errorCode: 'case 123 of someone@example.test',
      errorName: 'TypeError',
      status: Number.NaN,
      route: 'x'.repeat(257),
    });
    expect(JSON.parse(lines[0] ?? '')).toEqual({ level: 'error', errorName: 'TypeError' });
  });

  it('keeps a trace ID and a labelled error name, and drops a trace ID of another shape', () => {
    const lines: string[] = [];
    createLogger((line) => lines.push(line)).error({
      traceId: '0123456789abcdef0123456789abcdef',
      errorName: 'RecoveryStart:TypeError',
    });
    createLogger((line) => lines.push(line)).error({ traceId: 'someone@example.test' });
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      {
        level: 'error',
        traceId: '0123456789abcdef0123456789abcdef',
        errorName: 'RecoveryStart:TypeError',
      },
      { level: 'error' },
    ]);
  });
});

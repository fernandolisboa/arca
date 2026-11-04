import { describe, expect, it } from 'vitest';
import type { LogEntry, Logger } from '@arca/telemetry';
import { StepError, withStepError } from '../src/workflows/step-error.js';

function recordingLogger() {
  const errors: LogEntry[] = [];
  const reported: [unknown, string][] = [];
  const logger: Logger = { info: () => undefined, error: (entry) => errors.push(entry) };
  const report = (error: unknown, code: string) => {
    reported.push([error, code]);
    return Promise.resolve();
  };
  return { errors, reported, logger, report };
}

describe('withStepError (spec 0001, R6)', () => {
  it('returns the work result', async () => {
    const { errors, reported, logger, report } = recordingLogger();
    await expect(
      withStepError('database_unavailable', { logger, report }, () => Promise.resolve(42)),
    ).resolves.toBe(42);
    expect(errors).toEqual([]);
    expect(reported).toEqual([]);
  });

  it('rethrows any failure as a code, and logs only the cause class', async () => {
    const { errors, reported, logger, report } = recordingLogger();
    const cause = new Error('password authentication failed for user "app_jobs" at db.example');
    const thrown = await withStepError('database_unavailable', { logger, report }, () =>
      Promise.reject(cause),
    ).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(StepError);
    expect(thrown).toMatchObject({ code: 'database_unavailable', message: 'database_unavailable' });
    expect(thrown).not.toHaveProperty('cause');
    expect(errors).toEqual([{ errorCode: 'database_unavailable', errorName: 'Error' }]);
    expect(reported).toEqual([[cause, 'database_unavailable']]);
  });

  it('names a thrown value that is not an Error by its type', async () => {
    const { errors, reported, logger, report } = recordingLogger();
    await expect(
      withStepError('database_unavailable', { logger, report }, () =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the case under test
        Promise.reject('secret detail'),
      ),
    ).rejects.toBeInstanceOf(StepError);
    expect(errors).toEqual([{ errorCode: 'database_unavailable', errorName: 'string' }]);
    expect(reported).toEqual([['secret detail', 'database_unavailable']]);
  });

  it('still throws the step error when reporting fails', async () => {
    const { logger } = recordingLogger();
    const report = () => Promise.reject(new Error('monitoring unavailable'));
    await expect(
      withStepError('database_unavailable', { logger, report }, () =>
        Promise.reject(new Error('boom')),
      ),
    ).rejects.toMatchObject({ code: 'database_unavailable' });
  });
});

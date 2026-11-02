import { describe, expect, it } from 'vitest';
import type { LogEntry, Logger } from '../src/logger.js';
import { StepError, withStepError } from '../src/workflows/step-error.js';

function recordingLogger() {
  const errors: LogEntry[] = [];
  const logger: Logger = { info: () => undefined, error: (entry) => errors.push(entry) };
  return { errors, logger };
}

describe('withStepError (spec 0001, R6)', () => {
  it('returns the work result', async () => {
    const { errors, logger } = recordingLogger();
    await expect(
      withStepError('database_unavailable', logger, () => Promise.resolve(42)),
    ).resolves.toBe(42);
    expect(errors).toEqual([]);
  });

  it('rethrows any failure as a code, and logs only the cause class', async () => {
    const { errors, logger } = recordingLogger();
    const cause = new Error('password authentication failed for user "app_jobs" at db.example');
    const thrown = await withStepError('database_unavailable', logger, () =>
      Promise.reject(cause),
    ).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(StepError);
    expect(thrown).toMatchObject({ code: 'database_unavailable', message: 'database_unavailable' });
    expect(thrown).not.toHaveProperty('cause');
    expect(errors).toEqual([{ errorCode: 'database_unavailable', errorName: 'Error' }]);
  });

  it('names a thrown value that is not an Error by its type', async () => {
    const { errors, logger } = recordingLogger();
    await expect(
      withStepError('database_unavailable', logger, () =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the case under test
        Promise.reject('secret detail'),
      ),
    ).rejects.toBeInstanceOf(StepError);
    expect(errors).toEqual([{ errorCode: 'database_unavailable', errorName: 'string' }]);
  });
});

import type { Logger } from '@arca/telemetry';

export type StepErrorCode = 'database_unavailable';

/** Step errors carry a code only: the SDK logs and stores them (ADR-0009). */
export class StepError extends Error {
  override name = 'StepError';
  readonly code: StepErrorCode;
  constructor(code: StepErrorCode) {
    super(code);
    this.code = code;
  }
}

/**
 * Runs a step's work and turns any failure into a StepError with `code`. The cause is logged by its
 * class name only, since its message may carry connection details.
 */
export async function withStepError<T>(
  code: StepErrorCode,
  logger: Logger,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    logger.error({
      errorCode: code,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    throw new StepError(code);
  }
}

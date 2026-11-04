import type { Logger } from '@arca/telemetry';

export type StepErrorCode = 'database_unavailable' | 'email_unavailable' | 'delivery_unavailable';

/** Step errors carry a code only: the SDK logs and stores them (ADR-0009). */
export class StepError extends Error {
  override name = 'StepError';
  readonly code: StepErrorCode;
  constructor(code: StepErrorCode) {
    super(code);
    this.code = code;
  }
}

export interface StepTelemetry {
  readonly logger: Logger;
  /** Sends the cause to error monitoring, which keeps its class and frames, never its message. */
  readonly report: (error: unknown, errorCode: StepErrorCode) => Promise<void>;
}

/**
 * Runs a step's work and turns any failure into a StepError with `code`. The cause is logged by its
 * class name only, since its message may carry connection details.
 */
export async function withStepError<T>(
  code: StepErrorCode,
  { logger, report }: StepTelemetry,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    logger.error({
      errorCode: code,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    // A report that fails must not replace the step's own error.
    await report(error, code).catch(() => undefined);
    throw new StepError(code);
  }
}

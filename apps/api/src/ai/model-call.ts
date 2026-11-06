import type { Logger } from '@arca/telemetry';

/** What a model port answers: the reply as untrusted data, and the call's metadata. */
export interface ModelReply {
  readonly reply: unknown;
  readonly model: string;
  readonly promptVersion: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/** A port's failure: a fixed code and nothing of the request or the reply. */
export type ModelFailure = Error & { readonly code: string };

export interface ModelCallLog {
  /** The route pattern the call serves. */
  readonly route: string;
  readonly logger: Logger;
  /** Monotonic milliseconds, for the call's latency. */
  readonly now: () => number;
}

/**
 * One model call, logged with its metadata alone: never the prompt, the input or the reply. Any
 * error becomes the port's own failure, so nothing an SDK or a bug carries travels on.
 */
export async function loggedModelCall<Reply extends ModelReply>(
  call: () => Promise<Reply>,
  { route, logger, now }: ModelCallLog,
  failureOf: (error: unknown) => ModelFailure,
): Promise<Reply> {
  const started = now();
  try {
    const reply = await call();
    logger.info({
      route,
      model: reply.model,
      promptVersion: reply.promptVersion,
      ...(reply.inputTokens === undefined ? {} : { inputTokens: reply.inputTokens }),
      ...(reply.outputTokens === undefined ? {} : { outputTokens: reply.outputTokens }),
      durationMs: now() - started,
    });
    return reply;
  } catch (error) {
    const failure = failureOf(error);
    logger.error({ route, errorCode: failure.code, durationMs: now() - started });
    throw failure;
  }
}

/** Model calls one parsed reply may take: the first and one retry on an unparsable reply. */
export const modelAttempts = 2;

export interface OneRetry {
  /** Whether a thrown failure means the model's reply did not parse. */
  readonly isUnparsable: (error: unknown) => boolean;
  /** The failure to throw when no attempt parses. */
  readonly unparsable: () => Error;
  /** Called for each reply that arrived but did not parse. */
  readonly onUnparsable: () => void;
}

/** The model's reply parsed, asked for again once when it does not parse. */
export async function parsedWithOneRetry<Parsed>(
  ask: () => Promise<unknown>,
  parse: (reply: unknown) => Parsed | undefined,
  { isUnparsable, unparsable, onUnparsable }: OneRetry,
): Promise<Parsed> {
  for (let attempt = 0; attempt < modelAttempts; attempt += 1) {
    try {
      const parsed = parse(await ask());
      if (parsed !== undefined) return parsed;
      onUnparsable();
    } catch (error) {
      if (!isUnparsable(error)) throw error;
    }
  }
  throw unparsable();
}

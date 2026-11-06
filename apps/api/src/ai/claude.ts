import { type AnthropicLanguageModelOptions, createAnthropic } from '@ai-sdk/anthropic';
import { APICallError, type JSONSchema7, Output, generateText, jsonSchema } from 'ai';

/** Pinned in code: the provider would otherwise take `ANTHROPIC_BASE_URL` from the environment. */
export const anthropicBaseUrl = 'https://api.anthropic.com/v1';

export interface ClaudeSettings {
  readonly apiKey: string;
  /** For tests: the HTTP client the provider calls. */
  readonly fetch?: typeof globalThis.fetch;
}

/** One structured-output call: no tools, one schema, a token cap and a timeout. */
export interface StructuredCall {
  readonly model: string;
  readonly instructions: string;
  readonly prompt: string;
  readonly schema: JSONSchema7;
  readonly schemaName: string;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly anthropic?: Pick<AnthropicLanguageModelOptions, 'effort' | 'thinking'>;
}

export interface StructuredReply {
  /** Untrusted: the caller parses it against its own schema. */
  readonly output: unknown;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export type ClaudeFailure = 'timeout' | 'unavailable' | 'unparsable' | 'failed';

/** Carries a fixed kind and nothing of the request or the reply. */
export class ClaudeCallError extends Error {
  override name = 'ClaudeCallError';
  readonly kind: ClaudeFailure;
  constructor(kind: ClaudeFailure) {
    super(kind);
    this.kind = kind;
  }
}

const parsedByTheApi = new Set(['AI_JSONParseError', 'AI_TypeValidationError']);

/**
 * The SDK's own errors carry the request body or the model's reply, so none of them leaves this
 * file: each becomes a fixed kind, with no message and no cause.
 */
function failureOf(error: unknown): ClaudeFailure {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'timeout';
  }
  if (APICallError.isInstance(error)) return 'unavailable';
  if (
    error instanceof Error &&
    (parsedByTheApi.has(error.name) || /NoObject|NoContent/.test(error.name))
  ) {
    return 'unparsable';
  }
  return 'failed';
}

/**
 * Claude behind one call shape (ADR-0004): the host pinned, telemetry off, no retry inside the
 * SDK, and every failure a `ClaudeCallError` with a fixed kind.
 */
export function claudeClient({ apiKey, fetch }: ClaudeSettings) {
  const anthropic = createAnthropic({
    apiKey,
    baseURL: anthropicBaseUrl,
    ...(fetch === undefined ? {} : { fetch }),
  });
  return {
    async object(call: StructuredCall): Promise<StructuredReply> {
      try {
        const result = await generateText({
          model: anthropic(call.model),
          instructions: call.instructions,
          prompt: call.prompt,
          output: Output.object({ schema: jsonSchema(call.schema), name: call.schemaName }),
          maxOutputTokens: call.maxOutputTokens,
          ...(call.anthropic === undefined
            ? {}
            : { providerOptions: { anthropic: call.anthropic } }),
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(call.timeoutMs),
          telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
        });
        const { inputTokens, outputTokens } = result.usage;
        return {
          output: result.output,
          ...(inputTokens === undefined ? {} : { inputTokens }),
          ...(outputTokens === undefined ? {} : { outputTokens }),
        };
      } catch (error) {
        throw new ClaudeCallError(failureOf(error));
      }
    },
  };
}

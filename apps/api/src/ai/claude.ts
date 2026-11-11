import { type AnthropicLanguageModelOptions, createAnthropic } from '@ai-sdk/anthropic';
import {
  APICallError,
  type JSONSchema7,
  Output,
  type SystemModelMessage,
  generateText,
  jsonSchema,
} from 'ai';

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
  /** Every input token: read from the prompt cache, written to it, or neither. */
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  /** Input tokens read from the prompt cache, at a fraction of the input price. */
  readonly cacheReadTokens?: number;
  /** Input tokens written to the prompt cache, at a premium over the input price. */
  readonly cacheWriteTokens?: number;
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
 * The instructions as the request's cached prefix. They are the only bytes two calls of one kind
 * share: what follows is a different rule, page or description each time, so the one breakpoint
 * sits here and nothing volatile may come before it. One hour, not the default five minutes: a
 * person reviewing rules calls minutes apart, and the write premium on a prefix this small is
 * a fraction of a cent. Instructions under the model's minimum cacheable length are sent uncached,
 * with no error.
 */
function cachedInstructions(instructions: string): SystemModelMessage {
  return {
    role: 'system',
    content: instructions,
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } },
  };
}

/**
 * Claude behind one call shape (ADR-0004): the host pinned, telemetry off, no retry inside the
 * SDK, the instructions as the cached prefix, and every failure a `ClaudeCallError` with a fixed kind.
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
          instructions: cachedInstructions(call.instructions),
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
        const { inputTokens, outputTokens, inputTokenDetails } = result.usage;
        const { cacheReadTokens, cacheWriteTokens } = inputTokenDetails;
        return {
          output: result.output,
          ...(inputTokens === undefined ? {} : { inputTokens }),
          ...(outputTokens === undefined ? {} : { outputTokens }),
          ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
          ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
        };
      } catch (error) {
        throw new ClaudeCallError(failureOf(error));
      }
    },
  };
}

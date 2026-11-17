import { type AnthropicLanguageModelOptions, createAnthropic } from '@ai-sdk/anthropic';
import {
  APICallError,
  type JSONSchema7,
  type LanguageModelUsage,
  Output,
  type ProviderMetadata,
  StreamProviderError,
  type SystemModelMessage,
  generateText,
  jsonSchema,
  streamText,
} from 'ai';

/** Pinned in code: the provider would otherwise take `ANTHROPIC_BASE_URL` from the environment. */
export const anthropicBaseUrl = 'https://api.anthropic.com/v1';

/** One request that spends no tokens and proves the key works: listing one model. */
export const anthropicKeyProbe = (key: string): [string, RequestInit] => [
  `${anthropicBaseUrl}/models?limit=1`,
  { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } },
];

/** The key itself, or where each call reads it: settings, then the variable (ADR-0031). */
export type ClaudeKey = string | (() => Promise<string | undefined>);

export interface ClaudeSettings {
  readonly apiKey: ClaudeKey;
  /** For tests: the HTTP client the provider calls. */
  readonly fetch?: typeof globalThis.fetch;
}

type CacheLifetime = '5m' | '1h';

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
  /**
   * Text every call of one subject shares after the instructions, such as a route's current
   * version: a second cached prefix, with the five-minute lifetime, so a request's later stage
   * reads it from the cache (ADR-0031).
   */
  readonly context?: string;
  /**
   * The instructions' cache lifetime: an hour by default, so calls across requests share it;
   * five minutes where the cache serves one request only, as an update request's (ADR-0031).
   */
  readonly cacheLifetime?: CacheLifetime;
  /** Anthropic's web search and fetch server tools, limited to these hosts and their subdomains. */
  readonly web?: {
    readonly allowedDomains: readonly string[];
    readonly maxSearches: number;
    readonly maxFetches: number;
  };
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
  /** Web searches the server tool ran, which are billed apart from tokens. */
  readonly webSearches?: number;
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
  if (error instanceof ClaudeCallError) return error.kind;
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'timeout';
  }
  if (APICallError.isInstance(error) || StreamProviderError.isInstance(error)) return 'unavailable';
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
function cachedInstructions(instructions: string, ttl: CacheLifetime = '1h'): SystemModelMessage {
  return {
    role: 'system',
    content: instructions,
    providerOptions: {
      anthropic: {
        cacheControl: ttl === '1h' ? { type: 'ephemeral', ttl } : { type: 'ephemeral' },
      },
    },
  };
}

/** The shared context as a second cached prefix, with the five-minute lifetime (ADR-0031). */
function cachedContext(context: string): SystemModelMessage {
  return {
    role: 'system',
    content: context,
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
  };
}

/** The web searches the provider reports in its raw usage, if it reports them. */
function webSearchesOf(metadata: ProviderMetadata | undefined): number | undefined {
  const usage = metadata?.['anthropic']?.['usage'];
  const tools = isRecord(usage) ? usage['server_tool_use'] : undefined;
  const count = isRecord(tools) ? tools['web_search_requests'] : undefined;
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The reply with its usage; a count the provider left out stays out. */
function replyOf(
  output: unknown,
  usage: LanguageModelUsage,
  metadata?: ProviderMetadata,
): StructuredReply {
  const { inputTokens, outputTokens, inputTokenDetails } = usage;
  const { cacheReadTokens, cacheWriteTokens } = inputTokenDetails;
  const webSearches = webSearchesOf(metadata);
  return {
    output,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(webSearches === undefined ? {} : { webSearches }),
  };
}

/**
 * Claude behind one call shape (ADR-0004): the host pinned, telemetry off, no retry inside the
 * SDK, the instructions as the cached prefix, and every failure a `ClaudeCallError` with a fixed
 * kind. A streamed call sends the same request as a plain one, so both share one cached prefix.
 */
export function claudeClient({ apiKey, fetch }: ClaudeSettings) {
  const provider = (key: string) =>
    createAnthropic({
      apiKey: key,
      baseURL: anthropicBaseUrl,
      ...(fetch === undefined ? {} : { fetch }),
    });
  const fixed = typeof apiKey === 'string' ? provider(apiKey) : undefined;
  /** No key to call with is a provider that cannot be reached. */
  const anthropic = async () => {
    if (fixed !== undefined) return fixed;
    const key = typeof apiKey === 'string' ? apiKey : await apiKey();
    if (key === undefined) throw new ClaudeCallError('unavailable');
    return provider(key);
  };
  const request = async (call: StructuredCall) => {
    const provider = await anthropic();
    return {
      model: provider(call.model),
      instructions:
        call.context === undefined
          ? cachedInstructions(call.instructions, call.cacheLifetime)
          : [
              cachedInstructions(call.instructions, call.cacheLifetime),
              cachedContext(call.context),
            ],
      ...(call.web === undefined
        ? {}
        : {
            tools: {
              web_search: provider.tools.webSearch_20260209({
                maxUses: call.web.maxSearches,
                allowedDomains: [...call.web.allowedDomains],
              }),
              web_fetch: provider.tools.webFetch_20260209({
                maxUses: call.web.maxFetches,
                allowedDomains: [...call.web.allowedDomains],
              }),
            },
          }),
      prompt: call.prompt,
      output: Output.object({ schema: jsonSchema(call.schema), name: call.schemaName }),
      maxOutputTokens: call.maxOutputTokens,
      ...(call.anthropic === undefined ? {} : { providerOptions: { anthropic: call.anthropic } }),
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(call.timeoutMs),
      telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
    };
  };
  return {
    async object(call: StructuredCall): Promise<StructuredReply> {
      try {
        const result = await generateText(await request(call));
        return replyOf(result.output, result.usage, result.finalStep.providerMetadata);
      } catch (error) {
        throw new ClaudeCallError(failureOf(error));
      }
    },

    /**
     * The same call, streamed: `onPartial` sees the output as it grows, each value untrusted and
     * possibly cut mid-entry, and the reply is the complete output, parsed as `object` parses it.
     * The SDK reports a failure mid-stream to `onError`, never to the console, and that failure
     * is the one classified.
     */
    async objectStream(
      call: StructuredCall,
      onPartial: (partial: unknown) => void,
    ): Promise<StructuredReply> {
      let streamFailure: unknown;
      try {
        const result = streamText({
          ...(await request(call)),
          onError: ({ error }) => {
            streamFailure ??= error;
          },
        });
        for await (const partial of result.partialOutputStream) onPartial(partial);
        const [output, usage] = await Promise.all([result.output, result.usage]);
        return replyOf(output, usage);
      } catch (error) {
        throw new ClaudeCallError(failureOf(streamFailure ?? error));
      }
    },
  };
}

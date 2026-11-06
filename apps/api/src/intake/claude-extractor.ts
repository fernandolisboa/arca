import { createAnthropic } from '@ai-sdk/anthropic';
import { intakeDraftSchema } from '@arca/domain';
import { APICallError, type JSONSchema7, Output, generateText, jsonSchema } from 'ai';
import { z } from 'zod';
import { type Extractor, ExtractorError, type ExtractorFailure } from './extractor.js';
import { intakeModel } from './model.js';
import { intakeInstructions, intakeMessage, intakePromptVersion } from './prompt.js';

export interface ClaudeExtractorSettings {
  readonly apiKey: string;
  /** For tests: the HTTP client the provider calls. */
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

const draftJsonSchema = z.toJSONSchema(intakeDraftSchema, { io: 'input' }) as JSONSchema7;
const parsedByTheApi = new Set(['AI_JSONParseError', 'AI_TypeValidationError']);

/**
 * The SDK's own errors carry the request body (the masked text) or the model's reply, so none of
 * them leaves this file: each becomes a fixed code, with no message and no cause.
 */
function failureOf(error: unknown): ExtractorFailure {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'intake_timeout';
  }
  if (APICallError.isInstance(error)) return 'intake_unavailable';
  if (
    error instanceof Error &&
    (parsedByTheApi.has(error.name) || /NoObject|NoContent/.test(error.name))
  ) {
    return 'intake_unparsable';
  }
  return 'intake_failed';
}

/**
 * The Claude adapter of the `Extractor` port (spec 0008, R1): one call with structured output
 * against the draft schema, no tools, telemetry off, a timeout and a token cap. The SDK retries
 * nothing; the API retries an unparsable reply once.
 */
export function claudeExtractor({
  apiKey,
  fetch,
  timeoutMs = 25_000,
}: ClaudeExtractorSettings): Extractor {
  const anthropic = createAnthropic({ apiKey, ...(fetch === undefined ? {} : { fetch }) });
  return {
    async draft(maskedText, knownPlaceholders) {
      try {
        const result = await generateText({
          model: anthropic(intakeModel),
          instructions: intakeInstructions,
          prompt: intakeMessage(maskedText, knownPlaceholders),
          output: Output.object({ schema: jsonSchema(draftJsonSchema), name: 'intake_draft' }),
          maxOutputTokens: 2_048,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(timeoutMs),
          telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
        });
        return {
          reply: result.output,
          model: intakeModel,
          promptVersion: intakePromptVersion,
          ...(result.usage.inputTokens === undefined
            ? {}
            : { inputTokens: result.usage.inputTokens }),
          ...(result.usage.outputTokens === undefined
            ? {}
            : { outputTokens: result.usage.outputTokens }),
        };
      } catch (error) {
        throw new ExtractorError(failureOf(error));
      }
    },
  };
}

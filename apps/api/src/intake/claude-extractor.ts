import { intakeDraftSchema } from '@arca/domain';
import type { JSONSchema7 } from 'ai';
import { z } from 'zod';
import { ClaudeCallError, type ClaudeSettings, claudeClient } from '../ai/claude.js';
import { type Extractor, ExtractorError } from './extractor.js';
import { intakeModel } from './model.js';
import { intakeInstructions, intakeMessage, intakePromptVersion } from './prompt.js';

export interface ClaudeExtractorSettings extends ClaudeSettings {
  readonly timeoutMs?: number;
}

const draftJsonSchema = z.toJSONSchema(intakeDraftSchema, { io: 'input' }) as JSONSchema7;

/**
 * The Claude adapter of the `Extractor` port (spec 0008, R1): one call with structured output
 * against the draft schema, no tools, telemetry off, a timeout and a token cap. The SDK retries
 * nothing; the API retries an unparsable reply once.
 */
export function claudeExtractor({
  timeoutMs = 25_000,
  ...settings
}: ClaudeExtractorSettings): Extractor {
  const claude = claudeClient(settings);
  return {
    async draft(maskedText, knownPlaceholders, writerPlaceholder) {
      try {
        const { output, ...usage } = await claude.object({
          model: intakeModel,
          instructions: intakeInstructions,
          prompt: intakeMessage(maskedText, knownPlaceholders, writerPlaceholder),
          schema: draftJsonSchema,
          schemaName: 'intake_draft',
          maxOutputTokens: 8_192,
          timeoutMs,
          // Extraction needs no reasoning, and thinking tokens would count against the cap.
          anthropic: { thinking: { type: 'disabled' } },
        });
        return { reply: output, model: intakeModel, promptVersion: intakePromptVersion, ...usage };
      } catch (error) {
        if (error instanceof ClaudeCallError) throw new ExtractorError(`intake_${error.kind}`);
        throw error;
      }
    },
  };
}

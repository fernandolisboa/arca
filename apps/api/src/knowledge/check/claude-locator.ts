import type { JSONSchema7 } from 'ai';
import { z } from 'zod';
import { ClaudeCallError, type ClaudeSettings, claudeClient } from '../../ai/claude.js';
import {
  passageLocateInstructions,
  passageLocateMessage,
  passageLocatePromptVersion,
} from './locate-prompt.js';
import { PassageLocation, type PassageLocator, PassageLocatorError } from './locator.js';
import { passageLocateModel } from './model.js';

const locationJsonSchema = z.toJSONSchema(PassageLocation, { io: 'input' }) as JSONSchema7;

/**
 * The Claude adapter of the `PassageLocator` port (ADR-0027): one structured-output call on the
 * shared call shape to a fast model, with no tools, no thinking, a small token cap and a timeout.
 * The SDK retries nothing, and neither does the check: a page whose passages could not be picked
 * is sent cut, as a page over the size cap is.
 */
export function claudePassageLocator(settings: ClaudeSettings): PassageLocator {
  const claude = claudeClient(settings);
  return {
    async locate(request) {
      try {
        const { output, ...usage } = await claude.object({
          model: passageLocateModel,
          instructions: passageLocateInstructions,
          prompt: passageLocateMessage(request),
          schema: locationJsonSchema,
          schemaName: 'passage_location',
          maxOutputTokens: 4_000,
          timeoutMs: 90_000,
          // Picking from an outline is classification, and thinking tokens would count against the cap.
          anthropic: { thinking: { type: 'disabled' } },
        });
        return {
          reply: output,
          model: passageLocateModel,
          promptVersion: passageLocatePromptVersion,
          ...usage,
        };
      } catch (error) {
        if (error instanceof ClaudeCallError) throw new PassageLocatorError(`locate_${error.kind}`);
        throw error;
      }
    },
  };
}

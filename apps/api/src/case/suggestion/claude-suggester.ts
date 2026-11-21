import { SuggestedCriteria } from '@arca/api-contract/routes';
import type { JSONSchema7 } from 'ai';
import { z } from 'zod';
import { ClaudeCallError, type ClaudeSettings, claudeClient } from '../../ai/claude.js';
import { criterionSuggestionModel } from './model.js';
import {
  criterionSuggestionInstructions,
  criterionSuggestionMessage,
  criterionSuggestionPromptVersion,
} from './prompt.js';
import { type CriterionSuggester, SuggesterError } from './suggester.js';

const suggestionsJsonSchema = z.toJSONSchema(SuggestedCriteria, { io: 'input' }) as JSONSchema7;

/**
 * The Claude adapter of the `CriterionSuggester` port: one structured-output call, no tools, low
 * effort, a small token cap and a timeout. The SDK retries nothing.
 */
export function claudeSuggester(settings: ClaudeSettings): CriterionSuggester {
  const claude = claudeClient(settings);
  return {
    async suggest(known) {
      try {
        const { output, ...usage } = await claude.object({
          model: criterionSuggestionModel,
          instructions: criterionSuggestionInstructions,
          prompt: criterionSuggestionMessage(known),
          schema: suggestionsJsonSchema,
          schemaName: 'criterion_suggestions',
          maxOutputTokens: 2_048,
          timeoutMs: 30_000,
          anthropic: { effort: 'low' },
        });
        return {
          reply: output,
          model: criterionSuggestionModel,
          promptVersion: criterionSuggestionPromptVersion,
          ...usage,
        };
      } catch (error) {
        if (error instanceof ClaudeCallError) {
          throw new SuggesterError(`suggestions_${error.kind}`);
        }
        throw error;
      }
    },
  };
}

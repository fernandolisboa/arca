import { RuleSummary } from '@arca/api-contract/routes';
import type { JSONSchema7 } from 'ai';
import { z } from 'zod';
import { ClaudeCallError, type ClaudeSettings, claudeClient } from '../../ai/claude.js';
import { ruleSummaryModel } from './model.js';
import { ruleSummaryInstructions, ruleSummaryMessage, ruleSummaryPromptVersion } from './prompt.js';
import { type Summarizer, SummarizerError } from './summarizer.js';

const summaryJsonSchema = z.toJSONSchema(RuleSummary, { io: 'input' }) as JSONSchema7;

/**
 * The Claude adapter of the `Summarizer` port (ADR-0025): one structured-output call, no tools,
 * medium effort, a token cap that covers thinking and the reply, and a timeout. The SDK retries
 * nothing.
 */
export function claudeSummarizer(settings: ClaudeSettings): Summarizer {
  const claude = claudeClient(settings);
  return {
    async summarize(content) {
      try {
        const { output, ...usage } = await claude.object({
          model: ruleSummaryModel,
          instructions: ruleSummaryInstructions,
          prompt: ruleSummaryMessage(content),
          schema: summaryJsonSchema,
          schemaName: 'rule_summary',
          maxOutputTokens: 8_192,
          timeoutMs: 60_000,
          anthropic: { effort: 'medium' },
        });
        return {
          reply: output,
          model: ruleSummaryModel,
          promptVersion: ruleSummaryPromptVersion,
          ...usage,
        };
      } catch (error) {
        if (error instanceof ClaudeCallError) throw new SummarizerError(`summary_${error.kind}`);
        throw error;
      }
    },
  };
}

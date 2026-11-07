import type { JSONSchema7 } from 'ai';
import { z } from 'zod';
import { ClaudeCallError, type ClaudeSettings, claudeClient } from '../../ai/claude.js';
import { RuleCheckAnswer } from './answer.js';
import { type RuleChecker, type RuleCheckerChoice, RuleCheckerError } from './checker.js';
import { ruleCheckModel } from './model.js';
import { ruleCheckInstructions, ruleCheckMessage, ruleCheckPromptVersion } from './prompt.js';

const answerJsonSchema = z.toJSONSchema(RuleCheckAnswer, { io: 'input' }) as JSONSchema7;

/**
 * The Claude adapter of the `RuleChecker` port (ADR-0027): one structured-output call on the shared
 * call shape, with no tools, medium effort, a token cap that covers thinking and the reply, and a
 * timeout. The SDK retries nothing; the check retries once on an unparsable reply.
 */
export function claudeRuleChecker(settings: ClaudeSettings): RuleChecker {
  const claude = claudeClient(settings);
  return {
    async check(request) {
      try {
        const { output, ...usage } = await claude.object({
          model: ruleCheckModel,
          instructions: ruleCheckInstructions,
          prompt: ruleCheckMessage(request),
          schema: answerJsonSchema,
          schemaName: 'rule_check',
          maxOutputTokens: 12_000,
          timeoutMs: 240_000,
          anthropic: { effort: 'medium' },
        });
        return {
          reply: output,
          model: ruleCheckModel,
          promptVersion: ruleCheckPromptVersion,
          ...usage,
        };
      } catch (error) {
        if (error instanceof ClaudeCallError) throw new RuleCheckerError(`check_${error.kind}`);
        throw error;
      }
    },
  };
}

/** The Claude checker and what its reports are stored under. */
export function claudeRuleCheckerChoice(settings: ClaudeSettings): RuleCheckerChoice {
  return {
    checker: claudeRuleChecker(settings),
    model: ruleCheckModel,
    promptVersion: ruleCheckPromptVersion,
  };
}

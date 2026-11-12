import type { JSONSchema7 } from 'ai';
import { z } from 'zod';
import { ClaudeCallError, type ClaudeSettings, claudeClient } from '../../ai/claude.js';
import { RuleCheckAnswer } from './answer.js';
import { type RuleChecker, type RuleCheckerChoice, RuleCheckerError } from './checker.js';
import { ruleCheckModel } from './model.js';
import { ruleCheckInstructions, ruleCheckMessage, ruleCheckPromptVersion } from './prompt.js';

const answerJsonSchema = z.toJSONSchema(RuleCheckAnswer, { io: 'input' }) as JSONSchema7;

const itemsOf = (output: unknown): unknown =>
  typeof output === 'object' && output !== null && 'items' in output ? output.items : undefined;

/**
 * Hands on each entry of a growing `items` array once: an entry is complete when the next one
 * has begun, and the last ones when the whole output arrived.
 */
function completedEntries(onEntry: (entry: unknown) => void) {
  let handed = 0;
  const handOn = (output: unknown, whole: boolean) => {
    const items = itemsOf(output);
    if (!Array.isArray(items)) return;
    const complete = whole ? items.length : items.length - 1;
    for (; handed < complete; handed += 1) onEntry(items[handed]);
  };
  return {
    partial: (output: unknown) => {
      handOn(output, false);
    },
    whole: (output: unknown) => {
      handOn(output, true);
    },
  };
}

/**
 * The Claude adapter of the `RuleChecker` port (ADR-0027): one streamed structured-output call on
 * the shared call shape, with no tools, medium effort, a token cap that covers thinking and the
 * reply, and a timeout. Each answer entry is handed on as soon as it is complete; the reply is the
 * whole output. The SDK retries nothing; the check retries once on an unparsable reply.
 */
export function claudeRuleChecker(settings: ClaudeSettings): RuleChecker {
  const claude = claudeClient(settings);
  return {
    async check(request, onEntry) {
      const entries = completedEntries(onEntry ?? (() => undefined));
      try {
        const { output, ...usage } = await claude.objectStream(
          {
            model: ruleCheckModel,
            instructions: ruleCheckInstructions,
            prompt: ruleCheckMessage(request),
            schema: answerJsonSchema,
            schemaName: 'rule_check',
            maxOutputTokens: 12_000,
            timeoutMs: 240_000,
            anthropic: { effort: 'medium' },
          },
          entries.partial,
        );
        entries.whole(output);
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

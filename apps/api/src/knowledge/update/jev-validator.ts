import { validatorVerdicts } from '@arca/domain';
import { z } from 'zod';
import { typesafeBaseUrl } from '../../ai/typesafe.js';
import {
  type RuleValidator,
  RuleValidatorError,
  type ValidationItem,
  type ValidatorAnswer,
} from './ports.js';

/** Bumped only when what Jev is asked changes; part of each stored answer's key, so it asks again. */
export const jevValidatorPromptVersion = 'rule-validate-1';

const timeoutMs = 60_000;

/** The question each item gets, about its own entry of the state. */
const instructions = (id: string) =>
  `Read \`items.${id}.quote\`, a passage copied verbatim from an official government page, and ` +
  `\`items.${id}.rule\` with \`items.${id}.values\`, an immigration requirement as a rule ` +
  'database records it. Does the passage state this requirement with these values?';

const criteria = {
  supports: 'The passage states this requirement, and every listed value matches what it says.',
  contradicts:
    'The passage is about this requirement but states a different value, condition or outcome.',
  cannot_tell:
    'The passage does not say enough about this requirement to confirm or contradict it.',
} as const satisfies Record<(typeof validatorVerdicts)[number], string>;

const responseSchema = z.object({
  answers: z.record(
    z.string(),
    z.object({
      type: z.literal('choice'),
      choice: z.enum(validatorVerdicts),
      confidence: z.number().min(0).max(1),
    }),
  ),
  usage: z
    .object({ input_tokens: z.number().int().min(0), output_tokens: z.number().int().min(0) })
    .optional(),
});

export interface JevSettings {
  /** Read on every call, so a key changed in settings applies at once. */
  readonly apiKey: () => Promise<string | undefined>;
  /** For tests: the HTTP client. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * The validator on TypeSafe's Jev (ADR-0031): one request per stage, the state holding every item
 * with its verified quote, and one Choice question per item. Only public rule data and official
 * page text are sent. Every failure is a `RuleValidatorError` with a fixed code, so nothing of the
 * provider's reply travels on; the answers are checked against the items asked.
 */
export function jevRuleValidator({ apiKey, fetch = globalThis.fetch }: JevSettings): RuleValidator {
  return {
    promptVersion: jevValidatorPromptVersion,
    validate: async (items, { model }) => {
      const key = await apiKey();
      if (key === undefined) throw new RuleValidatorError();
      const state = {
        items: Object.fromEntries(
          items.map(({ id, title, values, quote }) => [id, { rule: title, values, quote }]),
        ),
      };
      const questions = Object.fromEntries(
        items.map(({ id }) => [id, { type: 'choice', instructions: instructions(id), criteria }]),
      );
      let body: unknown;
      try {
        const response = await fetch(`${typesafeBaseUrl}/systemone`, {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model, state, questions }),
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new RuleValidatorError();
        }
        body = await response.json();
      } catch {
        throw new RuleValidatorError();
      }
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success) throw new RuleValidatorError();
      const asked = new Set(items.map(({ id }: ValidationItem) => id));
      const reply: ValidatorAnswer[] = Object.entries(parsed.data.answers)
        .filter(([id]) => asked.has(id))
        .map(([id, answer]) => ({ id, choice: answer.choice, confidence: answer.confidence }));
      const { usage } = parsed.data;
      return {
        reply,
        model,
        promptVersion: jevValidatorPromptVersion,
        ...(usage === undefined
          ? {}
          : { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }),
      };
    },
  };
}

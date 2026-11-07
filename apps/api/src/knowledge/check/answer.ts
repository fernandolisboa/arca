import { type CheckAnswer, checkStatuses, maxCheckItemKeyLength } from '@arca/domain';
import { z } from 'zod';

const optionalText = z
  .string()
  .max(4_000)
  .nullish()
  .transform((value) => value ?? undefined);

/**
 * The closed schema of a checker's answer (ADR-0027): one entry per item key with a status and,
 * except for could not be checked, a quote and its URL; a short note on a difference is the only
 * free text. Lengths here only bound the parse; code checks every quote, URL and note after.
 */
export const RuleCheckAnswer = z.strictObject({
  items: z
    .array(
      z.strictObject({
        key: z.string().max(maxCheckItemKeyLength),
        status: z.enum(checkStatuses),
        quote: optionalText,
        url: optionalText,
        note: optionalText,
      }),
    )
    .max(200),
});

/** The answer's entries, or undefined when the reply does not parse. */
export function parseCheckAnswer(reply: unknown): readonly CheckAnswer[] | undefined {
  const parsed = RuleCheckAnswer.safeParse(reply);
  return parsed.success ? parsed.data.items : undefined;
}

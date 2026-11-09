import { type CheckAnswer, checkStatuses, maxCheckItemKeyLength } from '@arca/domain';
import { z } from 'zod';

const text = z.string().max(4_000);

const optionalText = text.nullish().transform((value) => value ?? undefined);

/**
 * How many quotes an entry may carry and still parse. Looser than `maxQuotes` on purpose: an entry
 * with a few too many is refused on its own, as `quote_count`, instead of failing the whole reply.
 */
const maxParsedQuotes = 10;

/**
 * The closed schema of a checker's answer (ADR-0027): one entry per item key with a status and,
 * except for could not be checked, the quotes it rests on, each with the URL of its page; a short
 * note, on a difference or on why an item could not be checked, is the only free text. Lengths and
 * counts here only bound the parse; code checks every quote, URL and note after, and refuses an
 * item with more than `maxQuotes` quotes.
 */
export const RuleCheckAnswer = z.strictObject({
  items: z
    .array(
      z.strictObject({
        key: z.string().max(maxCheckItemKeyLength),
        status: z.enum(checkStatuses),
        quotes: z
          .array(z.strictObject({ quote: text, url: text }))
          .max(maxParsedQuotes)
          .nullish()
          .transform((value) => value ?? undefined),
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

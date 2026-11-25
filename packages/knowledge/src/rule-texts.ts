import { routeIdSchema } from '@arca/domain';
import { z } from 'zod';

/** The one locale rule texts are written for so far; its folder is `rule-texts/pt-BR/`. */
export const ruleTextLocale = 'pt-BR';

const translation = z.string().min(1).max(400);

/**
 * One route's texts in the screen's language, as the repository keeps them (ADR-0037): each pairs
 * a title as a route version writes it, in English, with its translation. Not rule data: a
 * version's content and hash stay as they are, and a title with no entry shows in English.
 */
export const ruleTextFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  routeId: routeIdSchema,
  texts: z
    .array(z.strictObject({ en: z.string().min(1).max(200), text: translation }))
    .min(1)
    .max(1000),
});

export type RuleTextFile = z.infer<typeof ruleTextFileSchema>;

/**
 * The texts as the API ships them: each English title only by its SHA-256, so the server bundle
 * carries no route version content (ADR-0031) and the rules still come only from the database.
 */
export const shippedRuleTextsSchema = z.array(
  z.strictObject({
    routeId: routeIdSchema,
    texts: z.array(z.strictObject({ key: z.string().regex(/^[0-9a-f]{64}$/u), text: translation })),
  }),
);

export type ShippedRuleTexts = z.infer<typeof shippedRuleTextsSchema>;

/** A hex SHA-256 of a text's UTF-8; the API and the build pass Node's. */
export type Sha256 = (text: string) => string;

/** The repository's files in the shape the API ships. */
export function shipRuleTexts(files: readonly RuleTextFile[], sha256: Sha256): ShippedRuleTexts {
  return files.map(({ routeId, texts }) => ({
    routeId,
    texts: texts.map(({ en, text }) => ({ key: sha256(en), text })),
  }));
}

/** A route version's title in the screen's language, or undefined when it has no translation. */
export type RuleTexts = (routeId: string, english: string) => string | undefined;

/** The lookup over every route's texts; a route or a title it does not hold has no translation. */
export function createRuleTexts(shipped: ShippedRuleTexts, sha256: Sha256): RuleTexts {
  const byRoute = new Map(
    shipped.map(({ routeId, texts }) => [
      routeId,
      new Map(texts.map(({ key, text }) => [key, text])),
    ]),
  );
  return (routeId, english) => byRoute.get(routeId)?.get(sha256(english));
}

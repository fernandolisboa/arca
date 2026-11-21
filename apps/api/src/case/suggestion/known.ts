import { resources } from '@arca/i18n';

const { compare } = resources['pt-BR'].translation;

/**
 * The names the comparison screen shows before any model call: its criteria and its ready
 * suggestions, as the catalog words them. The only text a suggestion request sends; nothing a
 * person typed is in it.
 */
export const criterionNamesByKey: Readonly<Record<string, string>> = {
  ...compare.criterion,
  ...compare.suggestion,
};

export const knownCriterionNames: readonly string[] = Object.values(criterionNamesByKey);

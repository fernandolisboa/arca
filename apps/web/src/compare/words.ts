import type { DestinationComparison } from '@arca/api-contract/client';
import { useTranslation } from 'react-i18next';
import { useKnowledgeWords } from '../knowledge/words.js';

export type Criterion = DestinationComparison['criteria'][number];
export type Reading = NonNullable<
  DestinationComparison['countries'][number]['scores'][number]['reading']
>;

/** Criteria read from country data; the others are scored from the person's own stars. */
export const measured = (criterion: Criterion) =>
  criterion.kind === 'indicator' || criterion.kind === 'category';

/** The words the comparison screen names its data with, in the screen's language. */
export function useCompareWords() {
  const words = useKnowledgeWords();
  const { i18n } = useTranslation();
  const { t } = words;
  // Comparison data may name a criterion a newer catalog labels; until then it shows as written.
  const known = (key: string) => i18n.exists(key);
  const label = (criterion: Criterion) => {
    if (criterion.kind === 'own') return criterion.name;
    const key = `compare.criterion.${criterion.id}`;
    return known(key) ? t(key as 'compare.title') : criterion.title;
  };
  return {
    ...words,
    label,
    /** An exact decimal from the API, such as a score, in the screen's language. */
    score: (value: string) => words.decimal(value),
    /** The value behind an objective score with its year, such as "4,49 homicídios… (2023)". */
    reading: (criterion: Criterion, { value, year }: Reading) => {
      const tokenKey = `compare.token.${criterion.id}.${value}`;
      const shown =
        criterion.kind === 'indicator'
          ? words.decimal(value)
          : known(tokenKey)
            ? t(tokenKey as 'compare.title')
            : value;
      const phraseKey = `compare.reading.${criterion.id}`;
      return t('compare.inYear', {
        reading: known(phraseKey) ? t(phraseKey as 'compare.title', { value: shown }) : shown,
        year: String(year),
      });
    },
  };
}

export type CompareWords = ReturnType<typeof useCompareWords>;

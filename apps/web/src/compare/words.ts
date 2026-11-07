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

/**
 * The words the comparison screen names its data with, in the screen's language. Data the
 * catalog has no label for yet shows as written, so a new criterion or indicator needs no code.
 */
export function useCompareWords() {
  const words = useKnowledgeWords();
  const { i18n } = useTranslation();
  const { t, labelled } = words;
  return {
    ...words,
    label: (criterion: Criterion) =>
      criterion.kind === 'own'
        ? criterion.name
        : labelled(`compare.criterion.${criterion.id}`, criterion.title),
    /** The value behind an objective score with its year, such as "4,49 homicídios… (2023)". */
    reading: (criterion: Criterion, { value, year }: Reading) => {
      const indicator = criterion.kind === 'own' ? undefined : criterion.indicator;
      const shown =
        criterion.kind === 'indicator'
          ? words.decimal(value)
          : labelled(`compare.token.${indicator?.id ?? ''}.${value}`, value);
      const phraseKey = `compare.reading.${indicator?.id ?? ''}`;
      const phrase =
        indicator === undefined
          ? shown
          : i18n.exists(phraseKey)
            ? t(phraseKey as 'compare.reading.homicides', { value: shown })
            : t('compare.valueUnit', { value: shown, unit: indicator.unit });
      return t('compare.inYear', { reading: phrase, year: String(year) });
    },
  };
}

export type CompareWords = ReturnType<typeof useCompareWords>;

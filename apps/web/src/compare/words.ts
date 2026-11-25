import type { DestinationComparison } from '@arca/api-contract/client';
import { useTranslation } from 'react-i18next';
import { useKnowledgeWords } from '../knowledge/words.js';

export type Criterion = DestinationComparison['criteria'][number];
export type Reading = NonNullable<
  DestinationComparison['countries'][number]['scores'][number]['reading']
>;
export type Suggested = NonNullable<
  DestinationComparison['countries'][number]['scores'][number]['suggested']
>;
export type ComparedCountry = DestinationComparison['countries'][number];
export type ComparedRegion = ComparedCountry['regions'][number];
export type CriterionScore = ComparedCountry['scores'][number];

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
    /** A region's name (ADR-0042); one the catalog lacks shows its ISO 3166-2 code. */
    region: (code: string) => labelled(`regions.${code}`, code),
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
    /**
     * Why Arca suggests the stars it does, such as "desemprego de 4,2% (2025)". A region's reason
     * has its own wording where the value means something else there, as housing does.
     */
    suggestionReason: ({ key, value, year }: Suggested, regional = false) => {
      const regionKeys = regional
        ? [`compare.regionReason.${key}.${value}`, `compare.regionReason.${key}`]
        : [];
      const phraseKey = [...regionKeys, `compare.suggested.reason.${key}`].find((each) =>
        i18n.exists(each),
      );
      if (phraseKey === undefined) return value;
      const numeric = /^-?\d/.test(value);
      const reason = t(phraseKey as 'compare.suggested.reason.jobs', {
        value: numeric ? words.decimal(value) : value,
        n: numeric ? Number(value) : 0,
      });
      return year === undefined
        ? reason
        : t('compare.inYear', { reading: reason, year: String(year) });
    },
  };
}

export type CompareWords = ReturnType<typeof useCompareWords>;

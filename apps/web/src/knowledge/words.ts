import { useTranslation } from 'react-i18next';
import { useNames } from '../questions/editors.js';
import { formatAmount, formatDateValue, majorUnits } from '../questions/format.js';

/** A fact node of a version view: the reference as written and the catalog key it resolves to. */
export interface FactWords {
  readonly reference: string;
  readonly key: string | null;
  readonly target: string | null;
}

const durationPattern = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?$/;
const durationUnits = ['year', 'month', 'day'] as const;

/** The words the activation screen names rule data with, in the screen's language. */
export function useKnowledgeWords() {
  const { t, i18n } = useTranslation();
  const { country } = useNames();
  const language = i18n.language;
  const list = (items: readonly string[]) =>
    new Intl.ListFormat(language, { type: 'conjunction' }).format(items);
  const labelled = (key: string, fallback: string) =>
    // Rule data may name a key a newer catalog added; it shows as written rather than missing.
    i18n.exists(key) ? t(key as 'knowledge.title') : fallback;
  return {
    t,
    list,
    country,
    date: (value: string) => formatDateValue(value, language),
    money: (amount: number, currency: string) => {
      const digits =
        new Intl.NumberFormat(language, { style: 'currency', currency }).resolvedOptions()
          .maximumFractionDigits ?? 2;
      return formatAmount({ amount: majorUnits(amount, digits), currency }, language);
    },
    duration: (value: string) => {
      const match = durationPattern.exec(value);
      if (match === null) return value;
      const parts = durationUnits.flatMap((unit, index) => {
        const count = Number(match[index + 1] ?? '0');
        return count === 0 ? [] : [t(`knowledge.duration.${unit}`, { n: count })];
      });
      return list(parts);
    },
    fact: ({ reference, key, target }: FactWords) => {
      if (key === null || target === null) return reference;
      return t('knowledge.factOf', {
        fact: labelled(`knowledge.fact.${key}`, key),
        target: labelled(`knowledge.target.${target}`, target),
      });
    },
    collection: (name: string) => labelled(`knowledge.collection.${name}`, name),
    step: (name: string) => labelled(`knowledge.step.${name}`, name),
    op: (op: string, values: Record<string, unknown>) =>
      i18n.exists(`knowledge.op.${op}`)
        ? t(`knowledge.op.${op}` as 'knowledge.op.all', values)
        : op,
  };
}

export type KnowledgeWords = ReturnType<typeof useKnowledgeWords>;

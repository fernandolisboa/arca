import type { VersionView } from '@arca/api-contract/client';
import { useTranslation } from 'react-i18next';
import { useNames } from '../questions/editors.js';
import { formatAmount, formatDateValue } from '../questions/format.js';
import { durationParts } from './duration.js';

/** A fact of a version view: the reference as written and the catalog key it resolves to. */
export type FactWords = VersionView['requirements'][number]['facts'][number];

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
    language,
    labelled,
    list,
    country,
    date: (value: string) => formatDateValue(value, language),
    // A decimal string is formatted exactly, never through a floating-point number.
    decimal: (value: string) =>
      new Intl.NumberFormat(language, { maximumFractionDigits: 20 }).format(
        value as Intl.StringNumericLiteral,
      ),
    // A check's cost, in millionths of a dollar, shown to the cent.
    usd: (microUsd: number) => {
      const cents = Math.round(microUsd / 10_000);
      if (cents === 0 && microUsd > 0) return t('knowledge.checkRun.underCent');
      return new Intl.NumberFormat(language, { style: 'currency', currency: 'USD' }).format(
        cents / 100,
      );
    },
    // The view writes each amount in the currency's units, as a decimal.
    money: (amount: string, currency: string) => formatAmount({ amount, currency }, language),
    duration: (value: string) => {
      const parts = durationParts(value);
      if (parts === null) return value;
      return list(parts.map(({ unit, count }) => t(`knowledge.duration.${unit}`, { n: count })));
    },
    fact: ({ reference, key, target }: FactWords) => {
      if (key === null || target === null) return reference;
      return t('knowledge.factOf', {
        fact: labelled(`knowledge.fact.${key}`, key),
        target: labelled(`knowledge.target.${target}`, target),
      });
    },
    collection: (name: string) => labelled(`knowledge.collection.${name}`, name),
    field: (name: string) => labelled(`knowledge.field.${name}`, name),
    costKind: (kind: string) => labelled(`knowledge.costKinds.${kind}`, kind),
    referenceDate: (name: string) => labelled(`knowledge.referenceDate.${name}`, name),
    step: (name: string) => labelled(`knowledge.step.${name}`, name),
    op: (op: string, values: Record<string, unknown>) =>
      i18n.exists(`knowledge.op.${op}`)
        ? t(`knowledge.op.${op}` as 'knowledge.op.all', values)
        : op,
  };
}

export type KnowledgeWords = ReturnType<typeof useKnowledgeWords>;

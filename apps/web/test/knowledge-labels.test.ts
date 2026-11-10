import {
  collectionNames,
  expressionOperators,
  factKeys,
  factTargets,
  relationshipSteps,
  maxQuotes,
  checkReasons,
} from '@arca/api-contract/client';
import { createI18n } from '@arca/i18n';
import { describe, expect, it } from 'vitest';
import { listedSections } from '../src/knowledge/steps.js';

describe('Activation screen labels', () => {
  it('has a pt-BR label for every operator, fact, target, collection, step and review step', async () => {
    const i18n = await createI18n();
    const keys = [
      ...expressionOperators.map((op) => `knowledge.op.${op}`),
      ...factKeys.map((key) => `knowledge.fact.${key}`),
      ...factTargets.map((target) => `knowledge.target.${target}`),
      ...collectionNames.map((name) => `knowledge.collection.${name}`),
      ...relationshipSteps.map((step) => `knowledge.step.${step}`),
      ...listedSections.map((section) => `knowledge.section.${section}`),
    ];
    expect(keys.filter((key) => !i18n.exists(key))).toEqual([]);
  });

  it('fills the quote limit into every check reason and the footer', async () => {
    const i18n = await createI18n();
    const texts = [
      ...checkReasons.map((reason) => i18n.t('knowledge.check.reason', { reason, max: maxQuotes })),
      i18n.t('knowledge.check.footer', { max: maxQuotes }),
    ];
    expect(texts.filter((text) => text.includes('{'))).toEqual([]);
    expect(texts.filter((text) => text.includes(String(maxQuotes)))).toHaveLength(2);
  });
});

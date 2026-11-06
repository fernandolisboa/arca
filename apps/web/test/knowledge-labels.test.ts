import {
  collectionNames,
  expressionOperators,
  factKeys,
  factTargets,
  relationshipSteps,
} from '@arca/api-contract/client';
import { createI18n } from '@arca/i18n';
import { describe, expect, it } from 'vitest';
import { majorUnits } from '../src/questions/format.js';

describe('Activation screen labels', () => {
  it('has a pt-BR label for every operator, fact, target, collection and step', async () => {
    const i18n = await createI18n();
    const keys = [
      ...expressionOperators.map((op) => `knowledge.op.${op}`),
      ...factKeys.map((key) => `knowledge.fact.${key}`),
      ...factTargets.map((target) => `knowledge.target.${target}`),
      ...collectionNames.map((name) => `knowledge.collection.${name}`),
      ...relationshipSteps.map((step) => `knowledge.step.${step}`),
    ];
    expect(keys.filter((key) => !i18n.exists(key))).toEqual([]);
  });
});

describe('majorUnits', () => {
  it.each([
    [80_000_000, 2, '800000.00'],
    [5, 2, '0.05'],
    [-150, 2, '-1.50'],
    [1200, 0, '1200'],
    [7, 3, '0.007'],
  ])('writes %i minor units with %i digits as %s', (amount, digits, expected) => {
    expect(majorUnits(amount, digits)).toBe(expected);
  });
});

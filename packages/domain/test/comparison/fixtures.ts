import type { ComparisonEntry } from '../../src/comparison/select.js';
import type {
  ComparisonCriterion,
  ComparisonPreferences,
  CountryIndicator,
} from '../../src/comparison/schema.js';
import { noPreferences } from '../../src/comparison/schema.js';
import { parseDecimal } from '../../src/money/decimal.js';
import type { Source } from '../../src/rules/route-version.js';

export const freshSource: Source = {
  id: 'fresh',
  url: 'https://data.fixture.example/fresh',
  title: 'Fixture statistics office',
  kind: 'official',
  verifiedAt: '2026-10-01' as Source['verifiedAt'],
};

export const oldSource: Source = {
  ...freshSource,
  id: 'old',
  verifiedAt: '2026-06-01' as Source['verifiedAt'],
};

export function decimalIndicator(
  id: string,
  values: readonly (readonly [string, string, ('fresh' | 'old')?])[],
): CountryIndicator {
  return {
    schemaVersion: 1,
    id,
    number: 1,
    title: `Fixture ${id}`,
    unit: 'per 100,000 people',
    valueType: 'decimal',
    sources: [freshSource, oldSource],
    values: values.map(([country, value, source = 'fresh']) => ({
      country,
      value,
      year: 2024,
      source,
    })),
    countries: { id: 'countries', number: 1 },
    officialDomains: [{ id: 'fixture-gov', number: 1 }],
  };
}

export function tokenIndicator(
  id: string,
  values: readonly (readonly [string, string])[],
): CountryIndicator {
  return { ...decimalIndicator(id, values), valueType: 'token' };
}

export const indicatorCriterion = (
  id: string,
  indicator: string,
  zeroAt: string,
  tenAt: string,
  defaultWeight = 3,
): ComparisonCriterion => ({
  id,
  title: `Fixture ${id}`,
  kind: 'indicator',
  indicator,
  zeroAt: parseDecimal(zeroAt),
  tenAt: parseDecimal(tenAt),
  defaultWeight,
});

export const personalCriterion = (id: string, defaultWeight = 3): ComparisonCriterion => ({
  id,
  title: `Fixture ${id}`,
  kind: 'personal',
  defaultWeight,
});

export function entry(
  criteria: readonly ComparisonCriterion[],
  indicators: readonly CountryIndicator[],
): ComparisonEntry {
  return {
    identity: { comparisonId: 'destinations', number: 1, hash: 'a'.repeat(64) },
    version: {
      schemaVersion: 1,
      id: 'destinations',
      number: 1,
      title: 'Fixture comparison',
      indicators: indicators.map(({ id, number }) => ({ id, number })),
      criteria: [...criteria],
    },
    indicators,
  };
}

export function preferences(overrides: Partial<ComparisonPreferences> = {}): ComparisonPreferences {
  return { ...noPreferences, ...overrides };
}

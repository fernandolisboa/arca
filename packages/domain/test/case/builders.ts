import {
  type CaseSnapshot,
  type FactBinding,
  type FactEnvironment,
  type FactKey,
  type Value,
  caseSnapshotSchema,
  factCatalog,
  fxTableSchema,
  indexSnapshot,
  parseCalendarDate,
} from '../../src/index.js';

/** Synthetic snapshots only: invented IDs, dates and amounts. */
export function snapshot(input: Partial<Record<keyof CaseSnapshot, unknown>>): CaseSnapshot {
  return caseSnapshotSchema.parse({
    members: ['p1'],
    people: [{ id: 'p1' }],
    relationships: [],
    assets: [],
    ...input,
  });
}

export function environment(
  value: CaseSnapshot,
  overrides: Partial<FactEnvironment> = {},
): FactEnvironment {
  return {
    snapshot: indexSnapshot(value),
    principalId: 'p1',
    currency: 'EUR',
    fx: fxTableSchema.parse({
      rates: [{ from: 'USD', to: 'EUR', rate: '0.5', date: '2026-11-01', source: 'fixture' }],
    }),
    leapDayBirthday: 'feb-28',
    routeCountry: 'QM',
    ...overrides,
  };
}

export function derive(
  key: FactKey,
  binding: Omit<FactBinding, 'environment'> & { environment: FactEnvironment },
  at = '2026-11-03',
): { value: Value; missingRates?: readonly unknown[] } {
  return factCatalog[key].derive(binding, parseCalendarDate(at));
}

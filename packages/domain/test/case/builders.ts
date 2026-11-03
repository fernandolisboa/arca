import { parseCalendarDate } from '../../src/calendar/calendar-date.js';
import {
  type FactBinding,
  type FactEnvironment,
  type FactKey,
  deriveFact,
} from '../../src/case/facts.js';
import { indexSnapshot } from '../../src/case/graph.js';
import { type CaseSnapshot, caseSnapshotSchema } from '../../src/case/snapshot.js';
import type { Value } from '../../src/logic/value.js';
import { fxTableSchema } from '../../src/money/fx.js';

/** Synthetic snapshots only: invented IDs, dates and amounts. */
export function snapshot(input: Partial<Record<keyof CaseSnapshot, unknown>>): CaseSnapshot {
  return caseSnapshotSchema.parse({
    recordedOn: '2026-11-03',
    members: ['p1'],
    people: [{ id: 'p1' }],
    relationships: [],
    assets: [],
    ...input,
  });
}

export function environment(
  value: CaseSnapshot,
  overrides: { readonly unit?: NonNullable<FactEnvironment['unit']> } = {},
): FactEnvironment {
  return {
    snapshot: indexSnapshot(value),
    principalId: 'p1',
    currency: 'EUR',
    fx: fxTableSchema.parse({
      rates: [{ from: 'USD', to: 'EUR', rate: '0.5', date: '2026-11-01', source: 'fixture' }],
    }),
    factsAsOf: parseCalendarDate('2026-11-03'),
    leapDayBirthday: 'feb-28',
    routeCountry: 'QM',
    ...overrides,
  };
}

export function derive(
  key: FactKey,
  binding: Omit<FactBinding, 'environment'> & { environment: FactEnvironment },
  at = '2026-11-03',
): { value: Value; missingRates?: readonly unknown[]; missingMarkers?: readonly unknown[] } {
  return deriveFact(key, binding, parseCalendarDate(at));
}

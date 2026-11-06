import { describe, expect, it } from 'vitest';
import {
  displayNameSchema,
  storedAssetSchema,
  storedFinancesSchema,
  storedOwnerShareSchema,
  storedProfileSchema,
  storedRelationshipSchema,
} from '../../src/index.js';

const alice = '0b9c3d6e-1f2a-4b5c-8d7e-9f0a1b2c3d4e';
const child = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';

const accepts = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe('stored profile (spec 0007, R1)', () => {
  it.each([
    ['no facts yet', { facts: {}, dependenceAnswered: false }],
    [
      'facts and the relationship markers',
      {
        facts: {
          birthDate: '1990-05',
          citizenships: [{ country: 'BR', basis: 'birth' }],
          studying: false,
          recordedInFull: ['children', 'parents'],
        },
        dependenceAnswered: true,
      },
    ],
  ])('accepts %s', (_case, value) => {
    expect(accepts(storedProfileSchema, value)).toBe(true);
  });

  it.each([
    ['an opaque ID', { id: 'p1' }],
    ['incomes, which are finances', { incomes: [] }],
    ['dependence, which is a row of its own', { financiallyDependentOn: ['p2'] }],
    ['the assets marker, which is in the finances', { recordedInFull: ['assets'] }],
    ['a marker twice', { recordedInFull: ['children', 'children'] }],
    ['an unknown field', { name: 'Alice' }],
  ])('refuses %s', (_case, facts) => {
    expect(accepts(storedProfileSchema, { facts, dependenceAnswered: false })).toBe(false);
  });
});

describe('stored finances, assets and shares', () => {
  it('accepts unknown incomes, no incomes and some', () => {
    for (const incomes of [
      undefined,
      [],
      [{ kind: 'active', monthly: { amount: 500000, currency: 'BRL' }, sourceCountry: 'BR' }],
    ]) {
      expect(accepts(storedFinancesSchema, { incomes, assetsRecordedInFull: false })).toBe(true);
    }
  });

  it('keeps owners out of the asset, which has rows of its own', () => {
    const asset = {
      kind: 'real_estate',
      value: { amount: 80000000, currency: 'BRL' },
      valuedAt: '2026-01-01',
      sold: 'none',
    };
    expect(accepts(storedAssetSchema, asset)).toBe(true);
    expect(accepts(storedAssetSchema, { ...asset, owners: [] })).toBe(false);
    expect(accepts(storedAssetSchema, { ...asset, id: 'a1' })).toBe(false);
  });

  it.each([
    ['0.5', true],
    ['1', true],
    ['1.000000', true],
    ['0.000001', true],
    ['0', false],
    ['0.000000', false],
    ['1.000001', false],
    ['0.1234567', false],
    ['-0.5', false],
    ['.5', false],
  ])('a share of %s is accepted: %s', (share, valid) => {
    expect(accepts(storedOwnerShareSchema, share)).toBe(valid);
  });
});

describe('stored relationships', () => {
  it.each([
    ['a marriage', { kind: 'spouse', from: alice, to: child, details: { start: '2010-03-01' } }],
    [
      'an adoption',
      {
        kind: 'parent',
        from: alice,
        to: child,
        details: { parentKind: 'adoptive', custody: 'full' },
      },
    ],
  ])('accepts %s', (_case, value) => {
    expect(accepts(storedRelationshipSchema, value)).toBe(true);
  });

  it.each([
    ['opaque IDs', { kind: 'spouse', from: 'p1', to: 'p2', details: {} }],
    ['a person related to themselves', { kind: 'parent', from: alice, to: alice, details: {} }],
    [
      'parent details on a couple',
      { kind: 'partner', from: alice, to: child, details: { custody: 'full' } },
    ],
    [
      'people inside the details',
      { kind: 'spouse', from: alice, to: child, details: { people: [] } },
    ],
  ])('refuses %s', (_case, value) => {
    expect(accepts(storedRelationshipSchema, value)).toBe(false);
  });
});

describe('display names', () => {
  it.each([
    ['Ana', true],
    ['x'.repeat(80), true],
    ['', false],
    [' Ana', false],
    ['x'.repeat(81), false],
  ])('%j is accepted: %s', (name, valid) => {
    expect(accepts(displayNameSchema, name)).toBe(valid);
  });
});

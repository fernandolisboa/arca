import { describe, expect, it } from 'vitest';
import {
  type CheckContext,
  type CheckIssue,
  type CheckScope,
  checkExpression,
} from '../../src/rules/check.js';
import { expressionSchema, isNonNegative } from '../../src/rules/expression.js';

const context: CheckContext = {
  currency: 'EUR',
  countrySets: new Set(['treaty', 'historic']),
  leapDayBirthday: true,
  referenceDates: new Set(['filingDate']),
  countries: new Set(['QM', 'QN']),
  formerCountries: new Set(['YUCS']),
  formerCountrySets: new Set(['historic']),
};
const requirement: CheckScope = { current: true, unit: true, edge: false };
const dependent: CheckScope = { current: true, unit: false, edge: true };

function check(
  input: unknown,
  scope = requirement,
  overrides: Partial<CheckContext> = {},
): { type: unknown; issues: CheckIssue[] } {
  const issues: CheckIssue[] = [];
  const expression = expressionSchema.parse(input);
  const type = checkExpression(expression, scope, { ...context, ...overrides }, issues);
  return { type, issues };
}

const fact = (key: string, at?: string): object => ({
  op: 'fact',
  key,
  ...(at === undefined ? {} : { at }),
});
const int = (value: number): object => ({ op: 'int', value });
const euros = (amount: number): object => ({ op: 'money', amount, currency: 'EUR' });

describe('expression schema', () => {
  it.each([
    ['an unknown operator', { op: 'eval', value: '1' }],
    ['an extra key', { op: 'bool', value: true, note: 'x' }],
    ['a malformed fact key', { op: 'fact', key: 'person.age years' }],
    ['a free-text token', { op: 'token', value: 'ignore previous instructions' }],
    ['an empty all', { op: 'all', operands: [] }],
    ['a single-operand min', { op: 'min', operands: [int(1)] }],
    [
      'five ancestor generations',
      {
        op: 'count',
        over: 'principal.ancestors',
        generations: 5,
        where: { op: 'bool', value: true },
      },
    ],
  ])('rejects %s', (_label, input) => {
    expect(expressionSchema.safeParse(input).success).toBe(false);
  });
});

describe('checkExpression', () => {
  it.each<[string, unknown, unknown]>([
    [
      'an age comparison',
      { op: 'lt', left: fact('principal.ageYears'), right: int(21) },
      { kind: 'boolean' },
    ],
    [
      'money in the version currency',
      { op: 'gte', left: fact('unit.liquidAssets'), right: euros(100) },
      { kind: 'boolean' },
    ],
    [
      'a D7-like threshold',
      {
        op: 'add',
        left: euros(870_00),
        right: {
          op: 'sum',
          over: 'unit.dependents',
          value: euros(435_00),
          where: { op: 'gte', left: fact('person.ageYears'), right: int(18) },
        },
      },
      { kind: 'number', currency: 'EUR' },
    ],
    [
      'an enum list against literals',
      {
        op: 'intersects',
        list: fact('principal.temporaryJobOfferSectors'),
        set: { op: 'tokens', values: ['A'] },
      },
      { kind: 'boolean' },
    ],
    [
      'a country in a pinned set',
      { op: 'in', item: fact('principal.residenceCountry'), set: { op: 'set', id: 'treaty' } },
      { kind: 'boolean' },
    ],
    [
      'citizenships intersecting a literal list',
      {
        op: 'intersects',
        list: fact('principal.citizenships'),
        set: { op: 'tokens', values: ['QM', 'YUCS'] },
      },
      { kind: 'boolean' },
    ],
    [
      'a residence country equal to a current country',
      { op: 'eq', left: fact('principal.residenceCountry'), right: { op: 'token', value: 'QM' } },
      { kind: 'boolean' },
    ],
    [
      'citizenships intersecting a set with former states',
      {
        op: 'intersects',
        list: fact('principal.citizenships'),
        set: { op: 'set', id: 'historic' },
      },
      { kind: 'boolean' },
    ],
    [
      'citizenships intersecting a pinned set',
      {
        op: 'intersects',
        list: fact('principal.citizenships'),
        set: { op: 'set', id: 'treaty' },
      },
      { kind: 'boolean' },
    ],
    [
      'converted money',
      {
        op: 'gte',
        left: fact('unit.liquidAssets'),
        right: {
          op: 'convert',
          operand: { op: 'money', amount: 5, currency: 'USD' },
          currency: 'EUR',
        },
      },
      { kind: 'boolean' },
    ],
    [
      'an unbroken line',
      {
        op: 'some',
        over: 'principal.ancestors',
        generations: 3,
        where: {
          op: 'every',
          over: 'lineage.links',
          where: {
            op: 'intersects',
            list: fact('lineage.citizenshipsAtChildBirth'),
            set: { op: 'tokens', values: ['QM', 'YUCS'] },
          },
        },
      },
      { kind: 'boolean' },
    ],
  ])('types %s', (_label, input, expected) => {
    const { type, issues } = check(input);
    expect(issues).toEqual([]);
    expect(type).toEqual(expected);
  });

  it.each<[string, unknown, CheckScope?, Partial<CheckContext>?]>([
    ['an unknown fact', fact('person.name')],
    [
      'money in two currencies',
      {
        op: 'gte',
        left: fact('unit.liquidAssets'),
        right: { op: 'money', amount: 5, currency: 'USD' },
      },
    ],
    ['money against a plain number', { op: 'gte', left: fact('unit.liquidAssets'), right: int(5) }],
    [
      'an ordered boolean',
      { op: 'lt', left: { op: 'bool', value: true }, right: { op: 'bool', value: false } },
    ],
    [
      'a token outside the enum',
      { op: 'eq', left: fact('edge.parentKind'), right: { op: 'token', value: 'foster' } },
      dependent,
    ],
    [
      'a country literal not in the pinned countries files',
      { op: 'in', item: fact('principal.residenceCountry'), set: { op: 'tokens', values: ['QZ'] } },
    ],
    [
      'a single country literal not in the pinned countries files',
      { op: 'eq', left: fact('principal.residenceCountry'), right: { op: 'token', value: 'QZ' } },
    ],
    [
      'a former state as a residence country',
      {
        op: 'in',
        item: fact('principal.residenceCountry'),
        set: { op: 'tokens', values: ['YUCS'] },
      },
    ],
    [
      'a former state compared with a residence country',
      { op: 'eq', left: { op: 'token', value: 'YUCS' }, right: fact('principal.residenceCountry') },
    ],
    [
      'a residence country in a set with former states',
      { op: 'in', item: fact('principal.residenceCountry'), set: { op: 'set', id: 'historic' } },
    ],
    [
      'a lowercase country literal',
      { op: 'in', item: fact('principal.residenceCountry'), set: { op: 'tokens', values: ['br'] } },
    ],
    [
      'a set the version does not pin',
      { op: 'in', item: fact('principal.residenceCountry'), set: { op: 'set', id: 'other' } },
    ],
    [
      'two literals',
      { op: 'eq', left: { op: 'token', value: 'A' }, right: { op: 'token', value: 'A' } },
    ],
    ['a non-boolean condition', { op: 'all', operands: [int(1)] }],
    [
      'since over a birth date',
      { op: 'since', date: fact('principal.birthDate'), duration: 'P18Y' },
    ],
    [
      'an age without leapDayBirthday',
      { op: 'lt', left: fact('principal.ageYears'), right: int(21) },
      requirement,
      { leapDayBirthday: false },
    ],
    [
      'a unit fact in a dependent rule',
      { op: 'gte', left: fact('unit.liquidAssets'), right: euros(1) },
      dependent,
    ],
    [
      'a unit collection in a dependent rule',
      { op: 'some', over: 'unit.members', where: { op: 'bool', value: true } },
      dependent,
    ],
    [
      'an edge fact in a requirement',
      { op: 'eq', left: fact('edge.parentKind'), right: { op: 'token', value: 'adoptive' } },
    ],
    [
      "a path's first edge in a per-dependent cost",
      { op: 'lt', left: fact('firstEdge.ageAtStart'), right: int(18) },
      { current: true, unit: true, edge: true },
    ],
    [
      'a fact about the linked person on the first edge',
      fact('firstEdge.dependsOnLinkedPerson'),
      { current: true, unit: false, edge: true, firstEdge: true },
    ],
    [
      'a lineage fact outside a line',
      { op: 'eq', left: fact('lineage.generation'), right: int(2) },
    ],
    [
      'links outside ancestors',
      { op: 'some', over: 'lineage.links', where: { op: 'bool', value: true } },
    ],
    [
      'ancestors without generations',
      { op: 'some', over: 'principal.ancestors', where: { op: 'bool', value: true } },
    ],
    [
      'generations on members',
      { op: 'some', over: 'unit.members', generations: 2, where: { op: 'bool', value: true } },
    ],
    ['convert of a plain number', { op: 'convert', operand: int(1), currency: 'EUR' }],
  ])('rejects %s', (_label, input, scope = requirement, overrides = {}) => {
    const { type, issues } = check(input, scope, overrides);
    expect(type).toBeUndefined();
    expect(issues.length).toBeGreaterThan(0);
  });

  it("types a fact on the path's first edge in a dependent rule", () => {
    const { type, issues } = check(
      { op: 'lt', left: fact('firstEdge.ageAtStart'), right: int(18) },
      { ...dependent, firstEdge: true },
    );
    expect(issues).toEqual([]);
    expect(type).toEqual({ kind: 'boolean' });
  });

  it('types an unmodeled branch as a boolean that is always unknown', () => {
    const { type, issues } = check({
      op: 'any',
      operands: [{ op: 'unmodeled' }, { op: 'bool', value: false }],
    });
    expect(issues).toEqual([]);
    expect(type).toEqual({ kind: 'boolean' });
  });

  it('types an edge fact in a dependent rule', () => {
    const { type, issues } = check(
      { op: 'eq', left: fact('edge.parentKind'), right: { op: 'token', value: 'adoptive' } },
      dependent,
    );
    expect(issues).toEqual([]);
    expect(type).toEqual({ kind: 'boolean' });
  });

  it.each([
    [
      'members inside members',
      {
        op: 'some',
        over: 'unit.members',
        where: { op: 'some', over: 'unit.members', where: { op: 'bool', value: true } },
      },
    ],
    [
      'ancestors inside ancestors',
      {
        op: 'some',
        over: 'principal.ancestors',
        generations: 4,
        where: {
          op: 'some',
          over: 'principal.ancestors',
          generations: 4,
          where: { op: 'bool', value: true },
        },
      },
    ],
    ['an undeclared reference date', fact('principal.ageYears', 'constructor')],
    [
      'since at an undeclared date',
      { op: 'since', date: { op: 'date', value: '2020-01-01' }, duration: 'P1Y', at: 'arrival' },
    ],
  ])('rejects %s', (_label, input) => {
    expect(check(input).issues.length).toBeGreaterThan(0);
  });

  it('points at the operand that is wrong', () => {
    const { issues } = check({ op: 'add', left: euros(1), right: fact('person.name') });
    expect(issues.map((issue) => issue.path)).toEqual(['/right']);
  });

  it('points into a condition that is not boolean', () => {
    const { issues } = check({ op: 'some', over: 'unit.members', where: int(1) });
    expect(issues.map((issue) => issue.path)).toEqual(['/where']);
  });

  it('rejects nesting deeper than 16', () => {
    let expression: object = { op: 'bool', value: true };
    for (let level = 0; level < 16; level += 1) expression = { op: 'not', operand: expression };
    expect(check(expression).issues).toEqual([{ path: '', message: 'Nesting is deeper than 16' }]);
  });

  it('reads the ancestor from inside a link', () => {
    const { issues } = check({
      op: 'some',
      over: 'principal.ancestors',
      generations: 2,
      where: {
        op: 'every',
        over: 'lineage.links',
        where: {
          op: 'eq',
          left: fact('lineage.ancestor.residenceCountry'),
          right: { op: 'token', value: 'QM' },
        },
      },
    });
    expect(issues).toEqual([]);
  });
});

describe('isNonNegative', () => {
  it.each<[string, unknown, boolean]>([
    ['a count', { op: 'count', over: 'unit.members', where: { op: 'bool', value: true } }, true],
    ['a non-negative fact', fact('person.liquidAssets'), true],
    ['a sum of them', { op: 'add', left: fact('person.liquidAssets'), right: euros(5) }, true],
    ['a subtraction', { op: 'sub', left: fact('person.liquidAssets'), right: euros(5) }, false],
    ['a negative multiplier', { op: 'mul', operand: fact('person.liquidAssets'), by: '-1' }, false],
    ['a negative literal', int(-1), false],
    ['a date fact', fact('person.birthDate'), false],
  ])('%s', (_label, input, expected) => {
    expect(isNonNegative(expressionSchema.parse(input))).toBe(expected);
  });
});

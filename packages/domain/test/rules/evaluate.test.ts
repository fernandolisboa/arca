import { describe, expect, it } from 'vitest';
import { parseCalendarDate } from '../../src/calendar/calendar-date.js';
import type { FactEnvironment } from '../../src/case/facts.js';
import type { CaseSnapshot } from '../../src/case/snapshot.js';
import { type Frame, type Trace, evaluate, truthOf } from '../../src/rules/evaluate.js';
import { expressionSchema } from '../../src/rules/expression.js';
import { environment, snapshot } from '../case/builders.js';

/** Synthetic cases only. */
function frame(
  value: CaseSnapshot,
  options: {
    unit?: NonNullable<FactEnvironment['unit']>;
    referenceDates?: Record<string, string>;
  } = {},
): Frame {
  return {
    environment: environment(value, options.unit === undefined ? {} : { unit: options.unit }),
    at: parseCalendarDate('2026-11-03'),
    referenceDates: new Map(
      Object.entries(options.referenceDates ?? {}).map(([name, date]) => [
        name,
        parseCalendarDate(date),
      ]),
    ),
    countrySets: new Map([['treaty', ['QM', 'QN']]]),
    current: 'p1',
  };
}

function run(input: unknown, at: Frame): Trace {
  return evaluate(expressionSchema.parse(input), at);
}

const fact = (key: string, extra: object = {}): object => ({ op: 'fact', key, ...extra });
const int = (value: number): object => ({ op: 'int', value });
const euros = (amount: number): object => ({ op: 'money', amount, currency: 'EUR' });
const yes = { op: 'bool', value: true };
const no = { op: 'bool', value: false };
const unknown = fact('principal.studying');
const range = (min?: bigint, max?: bigint, currency?: string): object => ({
  type: 'number',
  ...(currency === undefined ? {} : { currency }),
  ...(min === undefined ? {} : { min: { units: min, scale: 0 } }),
  ...(max === undefined ? {} : { max: { units: max, scale: 0 } }),
});

describe('Kleene logic', () => {
  const base = frame(snapshot({}));
  it.each([
    ['all with a false', { op: 'all', operands: [unknown, no] }, false],
    ['all with an unknown', { op: 'all', operands: [unknown, yes] }, 'unknown'],
    ['any with a true', { op: 'any', operands: [unknown, yes] }, true],
    ['any with an unknown', { op: 'any', operands: [unknown, no] }, 'unknown'],
    ['not unknown', { op: 'not', operand: unknown }, 'unknown'],
    ['not true', { op: 'not', operand: yes }, false],
  ])('%s', (_label, input, expected) => {
    expect(truthOf(run(input, base))).toBe(expected);
  });
});

describe('comparisons over intervals', () => {
  const person = (birthDate?: string): Frame =>
    frame(snapshot({ people: [birthDate === undefined ? { id: 'p1' } : { id: 'p1', birthDate }] }));
  const under21 = { op: 'lt', left: fact('principal.ageYears'), right: int(21) };

  it.each([
    ['a known birth date', '2010-05-01', true],
    ['a birth year that decides it', '2010', true],
    ['a birth year on the boundary', '2005', 'unknown'],
    ['no birth date', undefined, 'unknown'],
    ['an adult', '1990', false],
  ])('age under 21 with %s', (_label, birthDate, expected) => {
    expect(truthOf(run(under21, person(birthDate)))).toBe(expected);
  });

  it('compares dates and tokens', () => {
    const at = frame(snapshot({ people: [{ id: 'p1', residenceCountry: 'QM' }] }));
    expect(
      truthOf(
        run(
          {
            op: 'eq',
            left: fact('principal.residenceCountry'),
            right: { op: 'token', value: 'QM' },
          },
          at,
        ),
      ),
    ).toBe(true);
    expect(
      truthOf(
        run(
          {
            op: 'ne',
            left: fact('principal.residenceCountry'),
            right: { op: 'token', value: 'QM' },
          },
          at,
        ),
      ),
    ).toBe(false);
    expect(
      truthOf(
        run(
          {
            op: 'lt',
            left: { op: 'date', value: '2020-01-01' },
            right: { op: 'date', value: '2021-01-01' },
          },
          at,
        ),
      ),
    ).toBe(true);
  });

  it('reads sets: in and intersects', () => {
    const at = frame(
      snapshot({
        people: [
          {
            id: 'p1',
            residenceCountry: 'QN',
            citizenships: [
              { country: 'QZ', basis: 'birth', lost: 'none' },
              { country: 'QM', acquired: '2010-01-01' },
            ],
          },
        ],
      }),
    );
    const treaty = { op: 'set', id: 'treaty' };
    expect(
      truthOf(run({ op: 'in', item: fact('principal.residenceCountry'), set: treaty }, at)),
    ).toBe(true);
    // QM is only possibly held (its loss is unknown), so the intersection is unknown.
    expect(
      truthOf(run({ op: 'intersects', list: fact('principal.citizenships'), set: treaty }, at)),
    ).toBe('unknown');
    expect(
      truthOf(
        run(
          {
            op: 'intersects',
            list: fact('principal.citizenships'),
            set: { op: 'tokens', values: ['QY'] },
          },
          at,
        ),
      ),
    ).toBe(false);
  });
});

describe('since', () => {
  const at = frame(
    snapshot({
      people: [{ id: 'p1', citizenships: [{ country: 'QM', acquired: '2021', lost: 'none' }] }],
      relationships: [],
    }),
  );
  const married = (start: string): Frame =>
    frame(
      snapshot({
        people: [{ id: 'p1' }, { id: 'p2' }],
        relationships: [{ kind: 'spouse', people: ['p1', 'p2'], start, end: 'none' }],
      }),
    );
  const edgeFrame = (value: Frame): Frame => {
    const edge = value.environment.snapshot.snapshot.relationships[0];
    return { ...value, current: 'p2', ...(edge === undefined ? {} : { edge }) };
  };
  const twoYears = { op: 'since', date: fact('edge.start'), duration: 'P2Y' };

  it.each([
    ['long enough', '2020-01-01', true],
    ['too recent', '2025-01-01', false],
    ['a partial date across the boundary', '2024', 'unknown'],
  ])('%s', (_label, start, expected) => {
    expect(truthOf(run(twoYears, edgeFrame(married(start))))).toBe(expected);
  });

  it('reports a missing named reference date', () => {
    const trace = run(
      { op: 'since', date: { op: 'date', value: '2000-01-01' }, duration: 'P1Y', at: 'filingDate' },
      at,
    );
    expect(trace.value).toEqual({ type: 'boolean', value: 'unknown' });
    expect(trace.missingDate).toBe('filingDate');
  });

  it('reads a fact at a named reference date, or reports it missing', () => {
    const value = snapshot({ people: [{ id: 'p1', birthDate: '2005-06-01' }] });
    const age = fact('principal.ageYears', { at: 'filingDate' });
    expect(run(age, frame(value, { referenceDates: { filingDate: '2026-01-01' } })).value).toEqual(
      range(20n, 20n),
    );
    const missing = run(age, frame(value));
    expect(missing.value).toEqual(range());
    expect(missing.missingDate).toBe('filingDate');
  });
});

describe('arithmetic and money', () => {
  const at = frame(snapshot({}));

  it('converts at the rate on factsAsOf, or opens and reports a missing rate', () => {
    const usd = (amount: number): object => ({ op: 'money', amount, currency: 'USD' });
    expect(run({ op: 'convert', operand: usd(1000), currency: 'EUR' }, at).value).toEqual(
      range(500n, 500n, 'EUR'),
    );
    const missing = run(
      { op: 'convert', operand: { op: 'money', amount: 5, currency: 'BRL' }, currency: 'EUR' },
      at,
    );
    expect(missing.value).toEqual(range(undefined, undefined, 'EUR'));
    expect(missing.missingRates).toEqual([{ from: 'BRL', to: 'EUR' }]);
  });

  it('adds, subtracts, multiplies and bounds', () => {
    expect(run({ op: 'sub', left: euros(10), right: euros(3) }, at).value).toEqual(
      range(7n, 7n, 'EUR'),
    );
    expect(run({ op: 'mul', operand: euros(10), by: '-0.5' }, at).value).toEqual(
      range(-5n, -5n, 'EUR'),
    );
    expect(run({ op: 'min', operands: [euros(10), euros(3)] }, at).value).toEqual(
      range(3n, 3n, 'EUR'),
    );
  });
});

describe('collections over the unit', () => {
  const people = [
    { id: 'p1', birthDate: '1980-01-01' },
    { id: 'p2', birthDate: '1982-01-01' },
    { id: 'p3', birthDate: '2015-01-01' },
    { id: 'p4' },
  ];
  const value = snapshot({ members: ['p1', 'p2', 'p3', 'p4'], people });
  const unit = (open = false): Frame =>
    frame(value, { unit: { included: ['p1', 'p2', 'p3'], possible: ['p4'], open } });
  const adult = { op: 'gte', left: fact('person.ageYears'), right: int(18) };

  it('counts certain and possible members, and opens for an open unit', () => {
    const count = { op: 'count', over: 'unit.dependents', where: adult };
    expect(run(count, unit()).value).toEqual(range(1n, 2n));
    expect(run(count, unit(true)).value).toEqual(range(1n));
  });

  it('decides some and every only when the unknowns cannot change them', () => {
    const some = { op: 'some', over: 'unit.members', where: adult };
    const every = { op: 'every', over: 'unit.members', where: adult };
    expect(truthOf(run(some, unit(true)))).toBe(true);
    expect(truthOf(run(every, unit()))).toBe(false);
    const noneUnder = {
      op: 'every',
      over: 'unit.dependents',
      where: { op: 'gte', left: fact('person.ageYears'), right: int(10) },
    };
    expect(truthOf(run(noneUnder, unit()))).toBe('unknown');
  });

  it('sums a D7-like threshold and decides it when the bounds agree', () => {
    const threshold = {
      op: 'add',
      left: euros(870_00),
      right: {
        op: 'sum',
        over: 'unit.dependents',
        value: euros(435_00),
        where: adult,
      },
    };
    const trace = run(threshold, unit());
    expect(trace.value).toEqual(range(1305_00n, 1740_00n, 'EUR'));
    expect(truthOf(run({ op: 'lt', left: euros(1000_00), right: threshold }, unit()))).toBe(true);
    expect(truthOf(run({ op: 'gte', left: euros(1500_00), right: threshold }, unit()))).toBe(
      'unknown',
    );
  });

  it('opens a sum of a possibly negative summand on both sides', () => {
    const sum = (summand: object): object => ({ op: 'sum', over: 'unit.members', value: summand });
    expect(run(sum(euros(1)), unit(true)).value).toEqual(range(3n, undefined, 'EUR'));
    expect(run(sum({ op: 'sub', left: euros(1), right: euros(2) }), unit(true)).value).toEqual(
      range(undefined, undefined, 'EUR'),
    );
  });

  it('records each member in the trace', () => {
    const trace = run({ op: 'some', over: 'unit.dependents', where: adult }, unit());
    expect(trace.children.map((child) => child.item)).toEqual([
      { personId: 'p2', membership: true },
      { personId: 'p3', membership: true },
      { personId: 'p4', membership: 'unknown' },
    ]);
  });
});

describe('lines of ancestors', () => {
  // Synthetic line: g2 -> g1 -> m1 -> p1, all recorded in full up to g2.
  const line = (g1Citizenships: object[]): Frame =>
    frame(
      snapshot({
        people: [
          { id: 'p1', birthDate: '1990-04-02', recordedInFull: ['parents'] },
          { id: 'm1', birthDate: '1961-01-01', recordedInFull: ['parents'] },
          {
            id: 'g1',
            birthDate: '1930-01-01',
            citizenships: g1Citizenships,
            recordedInFull: ['parents'],
          },
          { id: 'g2', citizenships: [{ country: 'QM', basis: 'birth', lost: 'none' }] },
        ],
        relationships: [
          { kind: 'parent', parent: 'm1', child: 'p1', parentKind: 'biological' },
          { kind: 'parent', parent: 'g1', child: 'm1', parentKind: 'biological' },
          { kind: 'parent', parent: 'g2', child: 'g1', parentKind: 'biological' },
        ],
      }),
    );
  const citizenAtNextBirth = {
    op: 'intersects',
    list: fact('lineage.citizenshipsAtChildBirth'),
    set: { op: 'tokens', values: ['QM'] },
  };
  const unbroken = {
    op: 'some',
    over: 'principal.ancestors',
    generations: 3,
    where: {
      op: 'all',
      operands: [
        { op: 'eq', left: fact('lineage.generation'), right: int(3) },
        citizenAtNextBirth,
        { op: 'every', over: 'lineage.links', where: citizenAtNextBirth },
      ],
    },
  };

  it('finds an unbroken line', () => {
    const passed = [{ country: 'QM', basis: 'birth', lost: 'none' }];
    // m1 has no citizenships recorded, so its link is unknown.
    expect(truthOf(run(unbroken, line(passed)))).toBe('unknown');
  });

  it('rejects a line broken at a known link', () => {
    expect(truthOf(run(unbroken, line([])))).toBe(false);
  });

  it('is unknown when a line may go further than recorded', () => {
    const value = snapshot({ people: [{ id: 'p1' }] });
    expect(
      truthOf(
        run({ op: 'some', over: 'principal.ancestors', generations: 2, where: yes }, frame(value)),
      ),
    ).toBe('unknown');
  });
});

describe('regressions from review', () => {
  it('keeps the currency of an empty sum, so convert works for a family of one', () => {
    const alone = frame(snapshot({}), { unit: { included: ['p1'], possible: [], open: false } });
    const fees = {
      op: 'sum',
      over: 'unit.dependents',
      value: { op: 'money', amount: 500, currency: 'USD' },
    };
    const trace = run(
      {
        op: 'lte',
        left: { op: 'convert', operand: fees, currency: 'EUR' },
        right: { op: 'money', amount: 0, currency: 'EUR' },
      },
      alone,
    );
    expect(truthOf(trace)).toBe(true);
  });

  it('never reads a reference date as an inherited property', () => {
    const value = snapshot({});
    const trace = run(
      {
        op: 'since',
        date: { op: 'date', value: '2026-11-01' },
        duration: 'P10Y',
        at: 'constructor',
      },
      frame(value),
    );
    expect(trace.value).toEqual({ type: 'boolean', value: 'unknown' });
    expect(trace.missingDate).toBe('constructor');
  });

  it('refuses a since reference date after the date the snapshot describes', () => {
    expect(() =>
      run(
        {
          op: 'since',
          date: { op: 'date', value: '2020-01-01' },
          duration: 'P1Y',
          at: 'filingDate',
        },
        frame(snapshot({}), { referenceDates: { filingDate: '2027-01-01' } }),
      ),
    ).toThrow(RangeError);
  });

  it('names the markers that leave a line of ancestors open', () => {
    const trace = run(
      { op: 'some', over: 'principal.ancestors', generations: 1, where: yes },
      frame(snapshot({})),
    );
    expect(trace.incomplete).toEqual({ missingMarkers: [{ personId: 'p1', marker: 'parents' }] });
  });
});

import { describe, expect, it } from 'vitest';
import { parseCalendarDate } from '../../src/calendar/calendar-date.js';
import type { CaseSnapshot } from '../../src/case/snapshot.js';
import { type Frame, type Trace, evaluate, truthOf } from '../../src/rules/evaluate.js';
import { expressionSchema } from '../../src/rules/expression.js';
import { decisiveFacts } from '../../src/rules/missing.js';
import { environment, snapshot } from '../case/builders.js';

/** Synthetic work histories only: invented dates, codes and countries. */
function frame(people: readonly object[], referenceDates: Record<string, string> = {}): Frame {
  const value: CaseSnapshot = snapshot({ members: ['p1'], people });
  return {
    environment: environment(value),
    at: parseCalendarDate('2026-11-03'),
    referenceDates: new Map(
      Object.entries(referenceDates).map(([name, date]) => [name, parseCalendarDate(date)]),
    ),
    countrySets: new Map(),
    current: 'p1',
  };
}

const worker = (workPeriods?: readonly object[]) =>
  frame([workPeriods === undefined ? { id: 'p1' } : { id: 'p1', workPeriods }]);

function run(input: unknown, at: Frame): Trace {
  return evaluate(expressionSchema.parse(input), at);
}

const noUnit = { member: () => [], all: () => [] };
const gaps = (trace: Trace) =>
  decisiveFacts(trace, noUnit).map((missing) =>
    missing.kind === 'fact'
      ? `${missing.reference}@${missing.personId}`
      : missing.kind === 'records'
        ? `records ${missing.list}@${missing.personId}`
        : missing.kind,
  );

const fact = (key: string): object => ({ op: 'fact', key });
const token = (value: string): object => ({ op: 'token', value });
const tokens = (...values: string[]): object => ({ op: 'tokens', values });

/** "At least one continuous year as a manager or executive in the last three years" (L-1A). */
const managerYear = {
  op: 'covers',
  over: 'person.workPeriods',
  where: { op: 'in', item: fact('workPeriod.capacity'), set: tokens('executive', 'manager') },
  atLeast: 'P1Y',
  window: 'P3Y',
  continuous: true,
};

/** "A relationship with the employer, seated abroad, for at least three months" (telework). */
const threeMonthsAbroad = {
  op: 'covers',
  over: 'person.workPeriods',
  where: {
    op: 'all',
    operands: [
      { op: 'in', item: fact('workPeriod.relation'), set: tokens('employee', 'contractor') },
      { op: 'ne', left: fact('workPeriod.employerCountry'), right: token('QM') },
    ],
  },
  atLeast: 'P3M',
  window: 'P3M',
  continuous: true,
};

/** "Two years of experience in the occupation, added up, at any time." */
const twoYearsInAll = {
  op: 'covers',
  over: 'person.workPeriods',
  where: { op: 'eq', left: fact('workPeriod.occupation'), right: token('2211') },
  atLeast: 'P2Y',
  continuous: false,
};

const manager = (start: string, end: string) => ({ capacity: 'manager', start, end });

describe('covers: time in periods inside a trailing window (ADR-0036)', () => {
  it.each<[string, readonly object[] | undefined, boolean | 'unknown']>([
    ['an ongoing manager role for over a year', [manager('2024-02', 'none')], true],
    [
      'a year that ended before the window, with only months inside it',
      [manager('2020-01-01', '2024-06-30')],
      false,
    ],
    [
      'touching roles that join into a year, one as executive',
      [
        manager('2024-01-01', '2024-06-30'),
        { capacity: 'executive', start: '2024-07-01', end: '2025-03-31' },
      ],
      true,
    ],
    [
      'two half-years apart, never a continuous year',
      [manager('2024-01-01', '2024-07-31'), manager('2025-01-01', '2025-06-30')],
      false,
    ],
    ['a role with no management', [{ capacity: 'other', start: '2020', end: 'none' }], false],
    ['a role whose capacity is unknown', [{ start: '2020', end: 'none' }], 'unknown'],
    ['a role whose end is unknown', [{ capacity: 'manager', start: '2024-01' }], 'unknown'],
    ['no jobs at all', [], false],
    ['work periods not answered', undefined, 'unknown'],
  ])('a continuous year as a manager in the last three years, with %s', (_, periods, expected) => {
    expect(truthOf(run(managerYear, worker(periods)))).toBe(expected);
  });

  it.each<[string, object, boolean | 'unknown']>([
    ['exactly three months, to the day', { start: '2026-08-03' }, true],
    ['three months less a day', { start: '2026-08-04' }, false],
    ['a start known only by its month', { start: '2026-08' }, 'unknown'],
    ['an employer seated in the route country', { start: '2025-01', employerCountry: 'QM' }, false],
    ['an engagement that ended last month', { start: '2025-01', end: '2026-10-15' }, false],
  ])('three months with an employer abroad, with %s', (_, period, expected) => {
    const remote = { relation: 'contractor', employerCountry: 'QN', end: 'none', ...period };
    expect(truthOf(run(threeMonthsAbroad, worker([remote])))).toBe(expected);
  });

  it('adds up periods apart when the time need not be continuous', () => {
    const periods = [
      { occupation: '2211', start: '2015-01-01', end: '2015-12-31' },
      { occupation: '2512', start: '2016-01-01', end: '2019-12-31' },
      { occupation: '2211', start: '2020-01-01', end: '2020-12-31' },
    ];
    expect(truthOf(run(twoYearsInAll, worker(periods)))).toBe(true);
    expect(truthOf(run(twoYearsInAll, worker(periods.slice(0, 2))))).toBe(false);
    expect(truthOf(run({ ...twoYearsInAll, continuous: true }, worker(periods)))).toBe(false);
  });

  it('never counts overlapping periods twice', () => {
    const periods = [
      { occupation: '2211', start: '2024-01-01', end: '2024-12-31' },
      { occupation: '2211', start: '2024-06-01', end: '2025-05-31' },
    ];
    expect(truthOf(run(twoYearsInAll, worker(periods)))).toBe(false);
  });

  it('reads a named reference date, and stays open while the case has none', () => {
    const filed = { ...threeMonthsAbroad, at: 'filingDate' };
    const remote = [
      { relation: 'employee', employerCountry: 'QN', start: '2026-07-01', end: 'none' },
    ];
    const missing = run(filed, worker(remote));
    expect(truthOf(missing)).toBe('unknown');
    expect(missing.missingDate).toBe('filingDate');
    const dated = frame([{ id: 'p1', workPeriods: remote }], { filingDate: '2026-09-15' });
    expect(truthOf(run(filed, dated))).toBe(false);
  });

  it('asks only what could change the answer: the unknown list, or the unknown parts', () => {
    expect(gaps(run(managerYear, worker(undefined)))).toEqual(['records workPeriods@p1']);
    expect(
      gaps(
        run(
          managerYear,
          worker([
            { start: '2020', end: 'none' },
            { capacity: 'other', start: '2010' },
          ]),
        ),
      ),
    ).toEqual(['workPeriod.capacity@p1']);
    // Nothing of a period that cannot reach into the window is asked.
    expect(
      gaps(
        run(
          managerYear,
          worker([
            { start: '2000-01-01', end: '2005-12-31' },
            { capacity: 'manager', start: '2025-11', end: 'none' },
          ]),
        ),
      ),
    ).toEqual(['workPeriod.start@p1']);
    expect(
      gaps(
        run(
          managerYear,
          worker([
            { capacity: 'manager', end: '2020-12-31' },
            { start: '2025-01-01', end: '2025-12-31' },
          ]),
        ),
      ),
    ).toEqual(['workPeriod.capacity@p1']);
    expect(gaps(run(managerYear, worker([{ capacity: 'manager', start: '2024-01' }])))).toEqual([
      'workPeriod.start@p1',
      'workPeriod.end@p1',
    ]);
  });
});

describe('collections over work periods', () => {
  const remote = {
    relation: 'contractor',
    employerCountry: 'QN',
    workplaceCountry: 'BR',
    fullTime: true,
    start: '2022',
    end: 'none',
  };
  const partTime = { relation: 'employee', fullTime: false, start: '2019', end: '2021' };
  const worksRemotely = {
    op: 'some',
    over: 'person.workPeriods',
    where: {
      op: 'ne',
      left: fact('workPeriod.employerCountry'),
      right: fact('workPeriod.workplaceCountry'),
    },
  };
  const allFullTime = {
    op: 'every',
    over: 'person.workPeriods',
    where: fact('workPeriod.fullTime'),
  };
  const fullTimeJobs = {
    op: 'count',
    over: 'person.workPeriods',
    where: fact('workPeriod.fullTime'),
  };

  it.each<[string, object, readonly object[] | undefined, unknown]>([
    ['a remote contractor works remotely', worksRemotely, [remote], true],
    ['a job with no countries may be remote', worksRemotely, [partTime], 'unknown'],
    ['nobody with no jobs works remotely', worksRemotely, [], false],
    ['unanswered work may be remote', worksRemotely, undefined, 'unknown'],
    ['a part-time job breaks every-full-time', allFullTime, [remote, partTime], false],
    ['no jobs are all full time', allFullTime, [], true],
  ])('%s', (_label, expression, periods, expected) => {
    expect(truthOf(run(expression, worker(periods)))).toBe(expected);
  });

  it('counts full-time jobs, open above while the list is unanswered', () => {
    expect(run(fullTimeJobs, worker([remote, partTime, remote])).value).toEqual({
      type: 'number',
      min: { units: 2n, scale: 0 },
      max: { units: 2n, scale: 0 },
    });
    expect(run(fullTimeJobs, worker(undefined)).value).toEqual({
      type: 'number',
      min: { units: 0n, scale: 0 },
    });
  });

  it('reads the principal’s jobs from a candidate dependent, and the owner as person', () => {
    const family = frame([
      { id: 'p1', birthDate: '1980-01-01', workPeriods: [remote] },
      { id: 'p2', workPeriods: [] },
    ]);
    const asCandidate: Frame = { ...family, current: 'p2' };
    expect(truthOf(run({ ...worksRemotely, over: 'principal.workPeriods' }, asCandidate))).toBe(
      true,
    );
    expect(truthOf(run(worksRemotely, asCandidate))).toBe(false);
    const ownerBorn = {
      op: 'some',
      over: 'principal.workPeriods',
      where: { op: 'lt', left: fact('person.birthDate'), right: fact('workPeriod.start') },
    };
    expect(truthOf(run(ownerBorn, asCandidate))).toBe(true);
  });
});

describe('collections over qualifications and registrations', () => {
  const masterIn = (field: string) => ({
    op: 'some',
    over: 'person.qualifications',
    where: {
      op: 'all',
      operands: [
        { op: 'gte', left: fact('qualification.level'), right: { op: 'int', value: 7 } },
        { op: 'eq', left: fact('qualification.field'), right: token(field) },
      ],
    },
  });
  const licensedIn = (country: string) => ({
    op: 'some',
    over: 'person.registrations',
    where: { op: 'eq', left: fact('registration.country'), right: token(country) },
  });
  const person = (facts: object) => frame([{ id: 'p1', ...facts }]);
  const doctor = person({
    educationLevel: 7,
    qualifications: [{ level: 7, field: '0912', country: 'BR', completed: '2012-12' }],
    registrations: [{ country: 'BR', occupation: '2211', since: '2013-02' }],
  });

  it.each<[string, object, Frame, unknown]>([
    ['a master’s in the field meets it', masterIn('0912'), doctor, true],
    ['a master’s in another field does not', masterIn('0613'), doctor, false],
    [
      'a field not known may meet it',
      masterIn('0912'),
      person({ qualifications: [{ level: 7 }] }),
      'unknown',
    ],
    [
      'a level not known stays under the education level',
      masterIn('0912'),
      person({ educationLevel: 6, qualifications: [{ field: '0912' }] }),
      false,
    ],
    ['no qualifications meet nothing', masterIn('0912'), person({ qualifications: [] }), false],
    [
      'an unfinished master’s does not',
      masterIn('0912'),
      person({ qualifications: [{ level: 7, field: '0912', status: 'incomplete' }] }),
      false,
    ],
    [
      'a master’s still being taken does not',
      masterIn('0912'),
      person({ qualifications: [{ level: 7, field: '0912', status: 'studying' }] }),
      false,
    ],
    [
      'a finished master’s does',
      masterIn('0912'),
      person({ qualifications: [{ level: 7, field: '0912', status: 'completed' }] }),
      true,
    ],
    ['unanswered qualifications may meet it', masterIn('0912'), person({}), 'unknown'],
    ['a licence in the country meets it', licensedIn('BR'), doctor, true],
    ['a licence elsewhere does not', licensedIn('PT'), doctor, false],
    [
      'a licence with no country may meet it',
      licensedIn('PT'),
      person({ registrations: [{}] }),
      'unknown',
    ],
    ['unanswered registrations may meet it', licensedIn('PT'), person({}), 'unknown'],
  ])('%s', (_label, expression, at, expected) => {
    expect(truthOf(run(expression, at))).toBe(expected);
  });

  it('asks for the unanswered list, or the unknown fact of a record', () => {
    expect(gaps(run(masterIn('0912'), person({})))).toEqual(['records qualifications@p1']);
    expect(gaps(run(licensedIn('PT'), person({ registrations: [{}] })))).toEqual([
      'registration.country@p1',
    ]);
  });
});

describe('job offers as a record collection (ADR-0036)', () => {
  const personWithOffers = (jobOffers?: readonly object[]) =>
    frame([jobOffers === undefined ? { id: 'p1' } : { id: 'p1', jobOffers }]);

  /** "A sponsored offer in QM as a software developer paying at least 40,000 euros a year." */
  const salaryOffer = {
    op: 'some',
    over: 'person.jobOffers',
    where: {
      op: 'all',
      operands: [
        { op: 'eq', left: fact('jobOffer.country'), right: token('QM') },
        { op: 'eq', left: fact('jobOffer.occupation'), right: token('2512') },
        fact('jobOffer.sponsored'),
        {
          op: 'gte',
          left: fact('jobOffer.annualSalary'),
          right: { op: 'money', amount: 4_000_000, currency: 'EUR' },
        },
      ],
    },
  };
  const offer = (fields: object = {}) => ({
    country: 'QM',
    sector: 'J',
    temporary: false,
    occupation: '2512',
    sponsored: true,
    annualSalary: { amount: 4_500_000, currency: 'EUR' },
    ...fields,
  });
  const salaryInDollars = (amount: number) => ({ annualSalary: { amount, currency: 'USD' } });

  it.each<[string, readonly object[] | undefined, boolean | 'unknown', readonly string[]]>([
    ['a salary above the threshold', [offer()], true, []],
    ['a salary in dollars that converts above it', [offer(salaryInDollars(9_000_000))], true, []],
    ['a salary in dollars that converts below it', [offer(salaryInDollars(7_000_000))], false, []],
    [
      'a salary below it',
      [offer({ annualSalary: { amount: 3_000_000, currency: 'EUR' } })],
      false,
      [],
    ],
    [
      'a salary not known',
      [offer({ annualSalary: undefined })],
      'unknown',
      ['jobOffer.annualSalary@p1'],
    ],
    [
      'a salary exactly at the threshold',
      [offer({ annualSalary: { amount: 4_000_000, currency: 'EUR' } })],
      true,
      [],
    ],
    [
      'a salary in dollars that converts exactly to it',
      [offer(salaryInDollars(8_000_000))],
      true,
      [],
    ],
    [
      'one offer that meets it beside one whose salary is not known',
      [offer(), offer({ annualSalary: undefined })],
      true,
      [],
    ],
    ['an offer in another country', [offer({ country: 'QN' })], false, []],
    ['an unsponsored offer', [offer({ sponsored: false })], false, []],
    [
      'sponsorship not known',
      [offer({ sponsored: undefined })],
      'unknown',
      ['jobOffer.sponsored@p1'],
    ],
    ['no offers', [], false, []],
    ['offers unanswered', undefined, 'unknown', ['records jobOffers@p1']],
  ])('%s', (_label, offers, expected, missing) => {
    const trace = run(salaryOffer, personWithOffers(offers));
    expect(truthOf(trace)).toBe(expected);
    expect(gaps(trace)).toEqual(missing);
  });

  it('leaves a salary in a currency with no rate unknown, asking nothing of the family', () => {
    const trace = run(
      salaryOffer,
      personWithOffers([
        offer(salaryInDollars(0)),
        offer({ annualSalary: { amount: 9_000_000, currency: 'GBP' } }),
      ]),
    );
    expect(truthOf(trace)).toBe('unknown');
    expect(gaps(trace)).toEqual([]);
    const rates = (node: Trace): unknown[] => [
      ...(node.missingRates ?? []),
      ...node.children.flatMap(rates),
    ];
    expect(rates(trace)).toEqual([{ from: 'GBP', to: 'EUR' }]);
  });
});

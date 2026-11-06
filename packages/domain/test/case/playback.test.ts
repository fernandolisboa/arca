import { describe, expect, it } from 'vitest';
import {
  type SentenceKind,
  caseSnapshotSchema,
  describeCase,
  parseCalendarDate,
  renamePeople,
  sentenceSchema,
} from '../../src/index.js';

const at = parseCalendarDate('2026-11-06');
const seen = { profile: true, finances: true };

const snapshot = caseSnapshotSchema.parse({
  recordedOn: at,
  members: ['p1', 'p2'],
  people: [
    {
      id: 'p1',
      birthDate: '1985-04',
      citizenships: [
        { country: 'BR', basis: 'birth' },
        { country: 'IT', basis: 'descent', acquired: '2019', lost: 'none' },
      ],
      residenceCountry: 'BR',
      educationLevel: 6,
      studying: false,
      languages: [{ language: 'pt', level: 'native' }],
      jobOffers: [{ country: 'PT', sector: 'J', temporary: false }],
      immigrationHistory: [{ country: 'US', kind: 'visa_refusal', date: '2018' }],
      financiallyDependentOn: [],
      incomes: [
        { kind: 'active', monthly: { amount: 900050, currency: 'BRL' }, sourceCountry: 'BR' },
      ],
      recordedInFull: ['children', 'assets'],
    },
    {
      id: 'p2',
      birthDate: '1984-02-29',
      citizenships: [],
      languages: [],
      jobOffers: [],
      immigrationHistory: [],
      incomes: [],
      financiallyDependentOn: ['p1'],
    },
    { id: 'p3', birthDate: '2015' },
    { id: 'p4' },
  ],
  relationships: [
    { kind: 'spouse', people: ['p1', 'p2'], start: '2010-05', end: 'none' },
    {
      kind: 'parent',
      parent: 'p1',
      child: 'p3',
      parentKind: 'adoptive',
      custody: 'shared',
      start: '2018',
      custodyStart: '2016',
    },
  ],
  assets: [
    {
      id: 'a1',
      kind: 'real_estate',
      owners: [
        { person: 'p1', share: '0.5' },
        { person: 'p2', share: '0.5' },
      ],
      value: { amount: 50000000, currency: 'BRL' },
      valuedAt: '2026-01-10',
      liquid: false,
    },
  ],
});

const visibility = new Map([
  ['p1', seen],
  ['p2', seen],
  ['p3', { profile: true, finances: false }],
  ['p4', { profile: false, finances: false }],
]);

const said = describeCase(snapshot, visibility, at);
const of = (person: string, kind: SentenceKind) =>
  said.filter(
    (sentence) => sentence.kind === kind && 'person' in sentence && sentence.person === person,
  );

describe('playing the case back (spec 0007, R5)', () => {
  it.each<[string, SentenceKind, Record<string, unknown>]>([
    ['p1', 'born', { question: 'birthDate', date: '1985-04', age: { min: 41, max: 41 } }],
    ['p1', 'citizenship', { question: 'citizenships', country: 'BR', basis: 'birth' }],
    ['p1', 'residence', { question: 'residenceCountry', country: 'BR' }],
    ['p1', 'education', { question: 'educationLevel', level: 6 }],
    ['p1', 'studying', { question: 'studying', studying: false }],
    ['p1', 'language', { question: 'languages', language: 'pt', level: 'native' }],
    ['p1', 'jobOffer', { question: 'jobOffers', country: 'PT', sector: 'J', temporary: false }],
    [
      'p1',
      'immigrationEvent',
      { question: 'immigrationHistory', country: 'US', event: 'visa_refusal', date: '2018' },
    ],
    ['p1', 'independent', { question: 'dependsOn' }],
    [
      'p1',
      'income',
      {
        question: 'incomes',
        income: 'active',
        monthly: { amount: '9000.5', currency: 'BRL' },
        sourceCountry: 'BR',
      },
    ],
    ['p1', 'recordedInFull', { question: 'allChildren', marker: 'children' }],
    ['p2', 'born', { date: '1984-02-29', age: { min: 42, max: 42 } }],
    ['p2', 'noCitizenship', { question: 'citizenships' }],
    ['p2', 'noLanguage', { question: 'languages' }],
    ['p2', 'noJobOffer', { question: 'jobOffers' }],
    ['p2', 'noImmigrationEvent', { question: 'immigrationHistory' }],
    ['p2', 'noIncome', { question: 'incomes' }],
    ['p2', 'dependsOn', { question: 'dependsOn', on: ['p1'] }],
    ['p3', 'born', { date: '2015', age: { min: 10, max: 11 } }],
    ['p3', 'financesHidden', {}],
    ['p4', 'profileHidden', {}],
    ['p4', 'financesHidden', {}],
  ])('says %s %s', (person, kind, expected) => {
    expect(of(person, kind)[0]).toMatchObject({ kind, about: [person], person, ...expected });
  });

  it('says what is still unanswered, never for what the viewer does not see', () => {
    const questions = (person: string) =>
      of(person, 'unanswered').map((sentence) => sentence.question);
    expect(questions('p1')).toEqual([]);
    expect(questions('p2')).toEqual(['residenceCountry', 'educationLevel', 'studying']);
    expect(questions('p3')).toEqual([
      'citizenships',
      'residenceCountry',
      'educationLevel',
      'studying',
      'languages',
      'jobOffers',
      'dependsOn',
      'immigrationHistory',
    ]);
    expect(questions('p4')).toEqual([]);
    expect(said.filter((sentence) => 'person' in sentence && sentence.person === 'p4')).toEqual([
      { kind: 'profileHidden', about: ['p4'], person: 'p4' },
      { kind: 'financesHidden', about: ['p4'], person: 'p4' },
    ]);
  });

  it('marks the assets recorded in full only with the finances in view', () => {
    expect(of('p1', 'recordedInFull').map((sentence) => sentence.question)).toEqual([
      'allChildren',
      'allAssets',
    ]);
    const hidden = describeCase(
      snapshot,
      new Map([...visibility, ['p1', { profile: true, finances: false }]]),
      at,
    );
    expect(
      hidden
        .filter((sentence) => sentence.kind === 'recordedInFull')
        .map(({ question }) => question),
    ).toEqual(['allChildren']);
  });

  it('says relationships and assets after the people, with their dates and shares', () => {
    expect(said.slice(-3)).toEqual([
      {
        kind: 'couple',
        question: 'relationships',
        about: ['p1', 'p2'],
        couple: 'spouse',
        people: ['p1', 'p2'],
        start: '2010-05',
        end: 'none',
      },
      {
        kind: 'parent',
        question: 'relationships',
        about: ['p1', 'p3'],
        parent: 'p1',
        child: 'p3',
        parentKind: 'adoptive',
        custody: 'shared',
        start: '2018',
        custodyStart: '2016',
      },
      {
        kind: 'asset',
        question: 'assets',
        about: ['p1', 'p2'],
        asset: 'real_estate',
        value: { amount: '500000', currency: 'BRL' },
        valuedAt: '2026-01-10',
        owners: [
          { person: 'p1', share: '0.5' },
          { person: 'p2', share: '0.5' },
        ],
        liquid: false,
      },
    ]);
  });

  it.each([
    ['2026', { min: 0, max: 0 }],
    ['2025-11', { min: 0, max: 1 }],
    ['2026-11-07', undefined],
  ])('gives someone born in %s the age %j', (birthDate, age) => {
    const [born] = describeCase(
      caseSnapshotSchema.parse({
        recordedOn: at,
        members: ['p1'],
        people: [{ id: 'p1', birthDate }],
        relationships: [],
        assets: [],
      }),
      new Map([['p1', seen]]),
      at,
    );
    expect(born).toMatchObject({ kind: 'born', date: birthDate });
    expect(born !== undefined && 'age' in born ? born.age : undefined).toEqual(age);
  });

  it('gives no age before a birth date that may still be ahead', () => {
    const born = describeCase(
      caseSnapshotSchema.parse({
        recordedOn: at,
        members: ['p1'],
        people: [{ id: 'p1', birthDate: '2026-12' }],
        relationships: [],
        assets: [],
      }),
      new Map([['p1', seen]]),
      at,
    );
    expect(born[0]).toEqual({
      kind: 'born',
      question: 'birthDate',
      about: ['p1'],
      person: 'p1',
      date: '2026-12',
    });
  });

  it('renames every person ID, and every sentence fits the schema', () => {
    const renamed = renamePeople(said, (id) => `${id}x`);
    for (const sentence of renamed) expect(sentenceSchema.safeParse(sentence).success).toBe(true);
    const ids = JSON.stringify(renamed).match(/"p\d+x?"/g) ?? [];
    expect(ids.every((id) => id.endsWith('x"'))).toBe(true);
  });
});

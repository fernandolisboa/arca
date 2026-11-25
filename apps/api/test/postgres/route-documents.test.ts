import { randomUUID } from 'node:crypto';
import {
  type CatalogEntry,
  type DecisionStates,
  type DocumentGuideEntry,
  type RouteCatalog,
  durationSchema,
  identityKey,
  parseCalendarDate,
  routeVersionSchema,
} from '@arca/domain';
import { comparisonCatalog } from '@arca/knowledge';
import { RouteDocuments } from '@arca/api-contract/routes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog } from '../../src/audit/log.js';
import { type CaseFiles, type CaseWritten, createCaseFiles } from '../../src/case/case-files.js';
import { authTestDatabase, type AuthTestDatabase } from './auth-database.js';

// A route's document checklist on the real migrations, as app_api (spec #519): synthetic people,
// an invented route and an invented guide only.
let testDatabase: AuthTestDatabase;

const source = {
  id: 'law',
  url: 'https://www.gov.example/law',
  title: 'Residence act',
  kind: 'official',
  verifiedAt: '2026-10-01',
};
const fact = (key: string): object => ({ op: 'fact', key });
const int = (value: number): object => ({ op: 'int', value });

const fixtureVersion = {
  schemaVersion: 1,
  routeId: 'qm-documents',
  number: 1,
  title: 'Sample residence route',
  country: 'PT',
  tags: ['family'],
  effectiveFrom: '2020-01-01',
  status: 'open',
  currency: 'EUR',
  leapDayBirthday: 'feb-28',
  leapDayBirthdaySources: ['law'],
  sources: [source],
  countries: { id: 'countries', number: 1 },
  formerCountries: { id: 'former-countries', number: 1 },
  countrySets: [],
  officialDomains: [{ id: 'qm-gov', number: 1 }],
  requirements: [],
  assessments: [],
  dependents: [
    {
      id: 'children',
      title: 'Children under 21',
      path: ['child'],
      condition: { op: 'lt', left: fact('person.ageYears'), right: int(21) },
      sources: ['law'],
    },
  ],
  costs: [],
  durations: [],
  documents: [
    {
      id: 'passport',
      title: 'Valid passport',
      kind: 'passport',
      appliesTo: 'principal',
      translation: 'none',
      validity: 'P6M',
      sources: ['law'],
    },
    {
      id: 'pension',
      title: 'Proof of pension',
      kind: 'pension_proof',
      appliesTo: 'principal',
      condition: { op: 'gte', left: fact('principal.ageYears'), right: int(70) },
      sources: ['law'],
    },
    {
      id: 'birth-certificate',
      title: 'Birth certificate',
      kind: 'birth_certificate',
      appliesTo: 'each_dependent',
      apostille: true,
      translation: 'sworn',
      note: 'Full form',
      sources: ['law'],
    },
    {
      id: 'enrollment',
      title: 'School enrollment',
      kind: 'school_enrollment',
      appliesTo: 'each_dependent',
      condition: fact('person.studying'),
      sources: ['law'],
    },
    {
      id: 'bank-statement',
      title: 'Bank statement',
      kind: 'bank_statement',
      appliesTo: 'unit',
      sources: ['law'],
    },
  ],
};

function fixtureEntry(patch: object = {}): CatalogEntry {
  const version = routeVersionSchema.parse({ ...fixtureVersion, ...patch });
  return {
    identity: {
      routeId: version.routeId,
      number: version.number,
      effectiveFrom: version.effectiveFrom,
      status: version.status,
      hash: String(version.number).padStart(64, 'a'),
    },
    version,
    countrySets: [],
  };
}

const catalogOf = (entries: readonly CatalogEntry[]): RouteCatalog => ({
  identities: (routeId) =>
    entries.filter(({ identity }) => identity.routeId === routeId).map(({ identity }) => identity),
  activeEntry: (identity) =>
    entries.find((entry) => identityKey(entry.identity) === identityKey(identity)),
});

const guides: DocumentGuideEntry[] = [
  {
    country: 'BR',
    kind: 'birth_certificate',
    onlineUrl: 'https://www.gov.example/certidao',
    cost: { min: 5000, max: 8000, currency: 'BRL' },
    leadTime: {
      min: durationSchema.parse('P1D'),
      max: durationSchema.parse('P5D'),
      businessDays: true,
    },
    sources: [
      {
        url: 'https://www.gov.example/guide',
        title: 'Guide',
        verifiedAt: parseCalendarDate('2026-10-02'),
      },
    ],
  },
];

function filesWith(entries: readonly CatalogEntry[], states: DecisionStates): CaseFiles {
  return createCaseFiles({
    db: () => testDatabase.apiDb,
    audit: auditLog(testDatabase.auditDb),
    today: () => new Date('2026-11-06T12:00:00Z'),
    countries: { countries: ['BR', 'PT'], formerCountries: [] },
    occupations: [],
    evaluation: {
      rules: () =>
        Promise.resolve({
          catalog: catalogOf(entries),
          routeIds: [...new Set(entries.map(({ identity }) => identity.routeId))],
        }),
      comparisons: comparisonCatalog,
      guides,
      texts: (_routeId, english) => (english === 'Birth certificate' ? 'Certidão' : undefined),
      states: () => Promise.resolve(states),
      today: () => parseCalendarDate('2026-11-06'),
      engineCommit: 'test',
    },
  });
}

const listed = fixtureEntry();
const activeStates = new Map([[identityKey(listed.identity), 'active' as const]]);
let files: CaseFiles;

beforeAll(async () => {
  testDatabase = await authTestDatabase();
  files = filesWith([listed], activeStates);
});

afterAll(async () => {
  await testDatabase.drop();
});

const admin = async <Row extends object>(statement: string, values: unknown[] = []) =>
  (await testDatabase.asAdmin((client) => client.query<Row>(statement, values))).rows;

async function account() {
  const accountId = randomUUID();
  await admin(`INSERT INTO auth.user (id, name, email) VALUES ($1, '', $2)`, [
    accountId,
    `${accountId}@example.com`,
  ]);
  return accountId;
}

function viewOf(written: CaseWritten) {
  if (!written.ok) throw new Error(`refused: ${written.reason}`);
  return written.view;
}

/** Ana, a Brazilian born in 1980, and her child born in 2015, whom she keeps. */
async function family() {
  const ana = await account();
  const created = viewOf(await files.create(ana, 'Ana'));
  const withChild = viewOf(
    await files.addPerson(ana, { displayName: 'Criança', caseMember: true }),
  );
  const child = withChild.people.find(({ displayName }) => displayName === 'Criança')?.id ?? '';
  viewOf(
    await files.addRelationship(ana, { kind: 'parent', from: created.me, to: child, details: {} }),
  );
  for (const [personId, birthDate] of [
    [created.me, '1980-04-02'],
    [child, '2015-03-10'],
  ] as const) {
    viewOf(
      await files.answerQuestions(ana, {
        personId,
        answers: [
          { questionId: 'birthDate', answer: birthDate },
          { questionId: 'citizenships', answer: [{ country: 'BR', basis: 'birth' }] },
        ],
      }),
    );
  }
  return { ana, people: { ana: created.me, child } };
}

const read = async (accountId: string, principalId: string, on: CaseFiles = files) =>
  RouteDocuments.parse(await on.routeDocuments(accountId, 'qm-documents', principalId));

describe('a route’s document checklist (spec #519)', () => {
  it('lists each person’s items and the unit’s, with truth, sources and guides', async () => {
    const { ana, people } = await family();
    const checklist = await read(ana, people.ana);
    expect(checklist).toMatchObject({
      status: 'active',
      route: { title: 'Sample residence route', original: null, country: 'PT' },
      version: { number: 1 },
      newerProposedVersion: null,
    });
    if (checklist.documents?.kind !== 'listed') throw new Error('a listed checklist');
    const { people: lists, unit, asksNone } = checklist.documents;
    expect(asksNone).toBe(false);
    expect(lists.map(({ personId, role }) => [personId, role])).toEqual([
      [people.ana, 'principal'],
      [people.child, 'dependent'],
    ]);
    // The pension proof does not apply at 46, so it is left out with its truth.
    expect(lists[0]?.items.map(({ documentId }) => documentId)).toEqual(['passport']);
    expect(lists[0]?.items[0]).toMatchObject({
      applies: true,
      apostille: null,
      translation: 'none',
      validity: 'P6M',
      note: null,
      sources: [{ id: 'law', url: 'https://www.gov.example/law', verifiedAt: '2026-10-01' }],
      dependsOn: [],
      guides: [],
    });
    const [birth, enrollment] = lists[1]?.items ?? [];
    expect(birth).toMatchObject({
      title: 'Certidão',
      original: 'Birth certificate',
      applies: true,
      apostille: true,
      translation: 'sworn',
      validity: null,
      note: 'Full form',
      noteOriginal: null,
      guides: [
        {
          country: 'BR',
          onlineUrl: 'https://www.gov.example/certidao',
          cost: { min: { amount: '50', currency: 'BRL' }, max: { amount: '80', currency: 'BRL' } },
          leadTime: { min: 'P1D', max: 'P5D', businessDays: true },
        },
      ],
    });
    // Whether the child studies is not answered, so the item may apply and says what settles it.
    expect(enrollment).toMatchObject({
      documentId: 'enrollment',
      applies: 'unknown',
      dependsOn: [{ personId: people.child, question: 'studying', kept: true }],
    });
    expect(unit.map(({ documentId }) => documentId)).toEqual(['bank-statement']);
  });

  it('reads apart a route with no document list and one that asks for none', async () => {
    const { ana, people } = await family();
    const absent = fixtureEntry({ documents: undefined });
    const none = fixtureEntry({ number: 2, documents: [] });
    const notCovered = await read(
      ana,
      people.ana,
      filesWith([absent], new Map([[identityKey(absent.identity), 'active']])),
    );
    expect(notCovered.documents).toEqual({ kind: 'not_covered' });
    const empty = await read(
      ana,
      people.ana,
      filesWith([none], new Map([[identityKey(none.identity), 'active']])),
    );
    expect(empty.documents).toMatchObject({ kind: 'listed', asksNone: true, unit: [] });
    expect(empty.documents?.kind === 'listed' && empty.documents.people[1]?.items).toEqual([]);
  });

  it('shows a version waiting for activation as pending, with none of its content (rule 5)', async () => {
    const { ana, people } = await family();
    expect(await read(ana, people.ana, filesWith([listed], new Map()))).toEqual({
      routeId: 'qm-documents',
      principalId: people.ana,
      status: 'pending_activation',
      route: null,
      version: { number: 1 },
      newerProposedVersion: null,
      documents: null,
    });
    const newer = fixtureEntry({ number: 2, effectiveFrom: '2027-01-01' });
    const withNewer = await read(ana, people.ana, filesWith([listed, newer], activeStates));
    expect(withNewer.newerProposedVersion).toEqual({ number: 2, from: '2027-01-01' });
  });

  it('answers nothing outside a case or for a principal who is not a member', async () => {
    const { ana, people } = await family();
    const outsider = await account();
    expect(await files.routeDocuments(outsider, 'qm-documents', people.ana)).toBeNull();
    expect(await files.routeDocuments(ana, 'qm-documents', randomUUID())).toBeNull();
    const parent = viewOf(await files.addPerson(ana, { displayName: 'Avó', caseMember: false }));
    const grandmother = parent.people.find(({ displayName }) => displayName === 'Avó')?.id ?? '';
    expect(await files.routeDocuments(ana, 'qm-documents', grandmother)).toBeNull();
    const other = await family();
    expect(await files.routeDocuments(ana, 'qm-documents', other.people.ana)).toBeNull();
  });

  it('reads another member’s facts only as shared, so a hidden fact may apply', async () => {
    const { ana, people } = await family();
    const bruno = await account();
    await admin(`INSERT INTO account.link (inviter_id, invitee_id) VALUES ($1, $2)`, [ana, bruno]);
    const joined = viewOf(await files.addMember(ana, { accountId: bruno, displayName: 'Bruno' }));
    const brunoPerson = joined.people.find(({ displayName }) => displayName === 'Bruno')?.id ?? '';
    // Bruno sees Ana's route with no birth dates and no citizenships, so no guide and no age.
    const seen = await read(bruno, people.ana);
    if (seen.documents?.kind !== 'listed') throw new Error('a listed checklist');
    expect(seen.documents.people.map(({ role }) => role)).toEqual([
      'principal',
      'possible_dependent',
    ]);
    const pension = seen.documents.people[0]?.items.find(
      ({ documentId }) => documentId === 'pension',
    );
    expect(pension).toMatchObject({
      applies: 'unknown',
      dependsOn: [{ personId: people.ana, question: 'birthDate', kept: false }],
    });
    expect(seen.documents.people[1]?.items.every(({ guides: found }) => found.length === 0)).toBe(
      true,
    );
    expect(await read(bruno, brunoPerson)).toMatchObject({ status: 'active' });
  });
});

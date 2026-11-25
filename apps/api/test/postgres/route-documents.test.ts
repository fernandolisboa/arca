import { randomBytes, randomUUID } from 'node:crypto';
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
import { RouteDocuments, maxChecklistMarks } from '@arca/api-contract/routes';
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
    studyFields: [],
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
    expect(unit.items.map(({ documentId }) => documentId)).toEqual(['bank-statement']);
  });

  it('reads apart a route with no document list, one that asks for none and one whose items do not apply', async () => {
    const { ana, people } = await family();
    const absent = fixtureEntry({ documents: undefined });
    const none = fixtureEntry({ number: 2, documents: [] });
    const notCovered = await read(
      ana,
      people.ana,
      filesWith([absent], new Map([[identityKey(absent.identity), 'active']])),
    );
    expect(notCovered.documents).toEqual({ kind: 'not_covered', noLongerAsked: [] });
    const empty = await read(
      ana,
      people.ana,
      filesWith([none], new Map([[identityKey(none.identity), 'active']])),
    );
    expect(empty.documents).toMatchObject({ kind: 'listed', asksNone: true, unit: { items: [] } });
    expect(empty.documents?.kind === 'listed' && empty.documents.people[1]?.items).toEqual([]);
    const pensionOnly = fixtureEntry({
      number: 3,
      documents: fixtureVersion.documents.filter(({ id }) => id === 'pension'),
    });
    const noneApply = await read(
      ana,
      people.ana,
      filesWith([pensionOnly], new Map([[identityKey(pensionOnly.identity), 'active']])),
    );
    expect(noneApply.documents).toMatchObject({
      kind: 'listed',
      asksNone: false,
      unit: { items: [] },
    });
    expect(
      noneApply.documents?.kind === 'listed' &&
        noneApply.documents.people.flatMap(({ items }) => items),
    ).toEqual([]);
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

/** A confirmed vault document of the account's, as the vault's own tests seed one. */
async function vaultDocument(accountId: string, confirmed = true) {
  const [row] = await admin<{ id: string }>(
    `INSERT INTO vault.document (owner_id, type_key, size, sha256, object_key, label, confirmed_at)
     VALUES ($1, 'other', 1, $2, 'documents/' || gen_random_uuid(), decode('01', 'hex'),
             CASE WHEN $3 THEN now() END)
     RETURNING id`,
    [accountId, randomBytes(32), confirmed],
  );
  return row?.id ?? '';
}

const countriesOf = async (documentId: string) =>
  (
    await admin<{ country: string }>(
      `SELECT country FROM vault.document_country WHERE document_id = $1 ORDER BY country`,
      [documentId],
    )
  ).map(({ country }) => country);

const mark = (
  personId: string,
  documentId: string,
  value: { state: 'had' | 'missing'; vaultDocumentId: string | null } | null,
) => ({ routeId: 'qm-documents', personId, documentId, mark: value });

function listedOf(checklist: RouteDocuments) {
  if (checklist.documents?.kind !== 'listed') throw new Error('a listed checklist');
  return checklist.documents;
}

describe('checklist marks (spec #519)', () => {
  it('sets, reads and clears a mark, with progress per person and for the route', async () => {
    const { ana, people } = await family();
    expect(
      await files.setMark(
        ana,
        mark(people.ana, 'passport', { state: 'had', vaultDocumentId: null }),
      ),
    ).toBe('set');
    expect(
      await files.setMark(
        ana,
        mark(people.child, 'birth-certificate', { state: 'missing', vaultDocumentId: null }),
      ),
    ).toBe('set');
    // The unit's items are marked on the principal.
    expect(
      await files.setMark(
        ana,
        mark(people.ana, 'bank-statement', { state: 'had', vaultDocumentId: null }),
      ),
    ).toBe('set');
    const marked = listedOf(await read(ana, people.ana));
    expect(marked.people[0]).toMatchObject({
      editable: true,
      marksShown: true,
      progress: { had: 1, total: 1 },
      items: [
        { documentId: 'passport', mark: { state: 'had', linked: false, vaultDocumentId: null } },
      ],
    });
    expect(marked.people[1]?.progress).toEqual({ had: 0, total: 2 });
    expect(marked.people[1]?.items.map(({ mark: shown }) => shown?.state ?? null)).toEqual([
      'missing',
      null,
    ]);
    expect(marked.unit).toMatchObject({ editable: true, progress: { had: 1, total: 1 } });
    expect(marked.progress).toEqual({ had: 2, total: 4 });
    expect(marked.noLongerAsked).toEqual([]);

    expect(await files.setMark(ana, mark(people.ana, 'passport', null))).toBe('set');
    const cleared = listedOf(await read(ana, people.ana));
    expect(cleared.people[0]?.items[0]?.mark).toBeNull();
    expect(cleared.progress).toEqual({ had: 1, total: 4 });
  });

  it('links only a confirmed document of the keeper’s, filing it under the route’s country; unlinking keeps it', async () => {
    const { ana, people } = await family();
    const own = await vaultDocument(ana);
    expect(
      await files.setMark(
        ana,
        mark(people.child, 'birth-certificate', { state: 'had', vaultDocumentId: own }),
      ),
    ).toBe('set');
    expect(await countriesOf(own)).toEqual(['PT']);
    const linked = listedOf(await read(ana, people.ana));
    expect(linked.people[1]?.items[0]?.mark).toEqual({
      state: 'had',
      linked: true,
      vaultDocumentId: own,
    });

    // Linking it again, or to another item, files it once.
    expect(
      await files.setMark(
        ana,
        mark(people.ana, 'passport', { state: 'had', vaultDocumentId: own }),
      ),
    ).toBe('set');
    expect(await countriesOf(own)).toEqual(['PT']);

    expect(
      await files.setMark(
        ana,
        mark(people.child, 'birth-certificate', { state: 'had', vaultDocumentId: null }),
      ),
    ).toBe('set');
    expect(await files.setMark(ana, mark(people.ana, 'passport', null))).toBe('set');
    expect(await countriesOf(own)).toEqual(['PT']);
    expect(await admin(`SELECT id FROM vault.document WHERE id = $1`, [own])).toHaveLength(1);

    const pending = await vaultDocument(ana, false);
    const someoneElses = await vaultDocument(await account());
    for (const vaultDocumentId of [pending, someoneElses, randomUUID()]) {
      expect(
        await files.setMark(ana, mark(people.ana, 'passport', { state: 'had', vaultDocumentId })),
      ).toBe('not_found');
    }
    expect(await countriesOf(someoneElses)).toEqual([]);
  });

  it('clears the link, not the mark, when the linked document is deleted', async () => {
    const { ana, people } = await family();
    const own = await vaultDocument(ana);
    await files.setMark(ana, mark(people.ana, 'passport', { state: 'had', vaultDocumentId: own }));
    await admin(`DELETE FROM vault.document WHERE id = $1`, [own]);
    expect(listedOf(await read(ana, people.ana)).people[0]?.items[0]?.mark).toEqual({
      state: 'had',
      linked: false,
      vaultDocumentId: null,
    });
  });

  it('refuses a person the viewer does not keep, a route with no active version and a mark past the limit', async () => {
    const { ana, people } = await family();
    const other = await family();
    expect(
      await files.setMark(
        ana,
        mark(other.people.ana, 'passport', { state: 'had', vaultDocumentId: null }),
      ),
    ).toBe('not_found');
    expect(await files.setMark(ana, mark(other.people.ana, 'passport', null))).toBe('not_found');
    expect(await files.setMark(await account(), mark(people.ana, 'passport', null))).toBe(
      'not_found',
    );
    const pending = filesWith([listed], new Map());
    expect(
      await pending.setMark(
        ana,
        mark(people.ana, 'passport', { state: 'had', vaultDocumentId: null }),
      ),
    ).toBe('not_found');
    expect(
      await files.setMark(ana, {
        ...mark(people.ana, 'passport', { state: 'had', vaultDocumentId: null }),
        routeId: 'qm-other',
      }),
    ).toBe('not_found');

    await admin(
      `INSERT INTO cases.checklist_mark (case_id, person_id, route_id, document_id, state)
       SELECT p.case_id, p.id, 'qm-documents', 'item-' || n, 'missing'
         FROM cases.person p, generate_series(1, $2) n WHERE p.id = $1`,
      [people.ana, maxChecklistMarks],
    );
    expect(
      await files.setMark(
        ana,
        mark(people.ana, 'passport', { state: 'had', vaultDocumentId: null }),
      ),
    ).toBe('case_limit');
    // A mark already there still changes.
    expect(
      await files.setMark(ana, mark(people.ana, 'item-1', { state: 'had', vaultDocumentId: null })),
    ).toBe('set');
  });

  it('keeps a mark through a version that keeps its item, and lists it as no longer asked once one drops it', async () => {
    const { ana, people } = await family();
    await files.setMark(ana, mark(people.ana, 'passport', { state: 'had', vaultDocumentId: null }));
    await files.setMark(
      ana,
      mark(people.child, 'enrollment', { state: 'missing', vaultDocumentId: null }),
    );
    const kept = fixtureEntry({ number: 2, effectiveFrom: '2026-01-01' });
    const dropped = fixtureEntry({
      number: 3,
      effectiveFrom: '2026-06-01',
      documents: fixtureVersion.documents.filter(({ id }) => id !== 'enrollment'),
    });
    const states = (entries: readonly CatalogEntry[]) =>
      new Map(entries.map(({ identity }) => [identityKey(identity), 'active' as const]));
    const second = listedOf(
      await read(ana, people.ana, filesWith([listed, kept], states([listed, kept]))),
    );
    expect(second.people[0]?.items[0]?.mark?.state).toBe('had');
    expect(second.noLongerAsked).toEqual([]);

    const all = [listed, kept, dropped];
    const third = listedOf(await read(ana, people.ana, filesWith(all, states(all))));
    expect(third.people[0]?.items[0]?.mark?.state).toBe('had');
    expect(third.people[1]?.items.map(({ documentId }) => documentId)).toEqual([
      'birth-certificate',
    ]);
    expect(third.noLongerAsked).toEqual([
      {
        personId: people.child,
        documentId: 'enrollment',
        title: 'School enrollment',
        original: null,
        editable: true,
        mark: { state: 'missing', linked: false, vaultDocumentId: null },
      },
    ]);

    // A version with no document list asks nothing the family knows of, so every mark comes apart.
    const uncovered = fixtureEntry({
      number: 4,
      effectiveFrom: '2026-09-01',
      documents: undefined,
    });
    const fourth = await read(
      ana,
      people.ana,
      filesWith([...all, uncovered], states([...all, uncovered])),
    );
    expect(
      fourth.documents?.kind === 'not_covered' &&
        fourth.documents.noLongerAsked.map(({ documentId }) => documentId).toSorted(),
    ).toEqual(['enrollment', 'passport']);
  });

  it('shows marks to a member the keeper shared the checklist with, read only, and to no one else', async () => {
    const { ana, people } = await family();
    const own = await vaultDocument(ana);
    await files.setMark(
      ana,
      mark(people.child, 'birth-certificate', { state: 'had', vaultDocumentId: own }),
    );
    const bruno = await account();
    await admin(`INSERT INTO account.link (inviter_id, invitee_id) VALUES ($1, $2)`, [ana, bruno]);
    viewOf(await files.addMember(ana, { accountId: bruno, displayName: 'Bruno' }));

    const hidden = listedOf(await read(bruno, people.ana));
    expect(
      hidden.people.map(({ editable, marksShown, progress }) => ({
        editable,
        marksShown,
        progress,
      })),
    ).toEqual([
      { editable: false, marksShown: false, progress: null },
      { editable: false, marksShown: false, progress: null },
    ]);
    expect(hidden.progress).toBeNull();
    expect(
      hidden.people.flatMap(({ items }) => items).every(({ mark: shown }) => shown === null),
    ).toBe(true);

    viewOf(
      await files.replaceShares(ana, {
        personId: people.child,
        profile: [],
        finances: [],
        checklist: [bruno],
      }),
    );
    const shared = listedOf(await read(bruno, people.ana));
    expect(shared.people[1]).toMatchObject({ editable: false, marksShown: true });
    // Bruno sees that a document is linked, never which one.
    expect(
      shared.people[1]?.items.find(({ documentId }) => documentId === 'birth-certificate')?.mark,
    ).toEqual({
      state: 'had',
      linked: true,
      vaultDocumentId: null,
    });
    expect(shared.people[0]?.marksShown).toBe(false);
    expect(await files.setMark(bruno, mark(people.child, 'birth-certificate', null))).toBe(
      'not_found',
    );

    // Handed over, the child keeps the mark but not Ana's link, which Bruno could never open.
    viewOf(await files.handOver(ana, { personId: people.child, accountId: bruno }));
    const handed = listedOf(await read(bruno, people.ana));
    expect(
      handed.people[1]?.items.find(({ documentId }) => documentId === 'birth-certificate')?.mark,
    ).toEqual({ state: 'had', linked: false, vaultDocumentId: null });
  });
});

import { randomUUID } from 'node:crypto';
import { parseCalendarDate } from '@arca/domain';
import { comparisonCatalog, recognitionTracks } from '@arca/knowledge';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog } from '../../src/audit/log.js';
import { type CaseFiles, type CaseWritten, createCaseFiles } from '../../src/case/case-files.js';
import { authTestDatabase, type AuthTestDatabase } from './auth-database.js';

// Whom the recognition tracks concern, on the real migrations, as app_api (ADR-0041): synthetic
// people only.
let testDatabase: AuthTestDatabase;
let files: CaseFiles;

beforeAll(async () => {
  testDatabase = await authTestDatabase();
  files = createCaseFiles({
    db: () => testDatabase.apiDb,
    audit: auditLog(testDatabase.auditDb),
    today: () => new Date('2026-11-25T12:00:00Z'),
    countries: { countries: ['BR', 'PT'], formerCountries: [] },
    occupations: ['2211', '2512'],
    studyFields: ['0912'],
    evaluation: {
      rules: () =>
        Promise.resolve({
          catalog: { identities: () => [], activeEntry: () => undefined },
          routeIds: [],
        }),
      comparisons: comparisonCatalog,
      states: () => Promise.resolve(new Map()),
      today: () => parseCalendarDate('2026-11-25'),
      engineCommit: 'test',
    },
  });
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

/** Ana, a doctor registered in Brazil, and her partner Caio, a software developer she keeps. */
async function family() {
  const ana = await account();
  const created = viewOf(await files.create(ana, 'Ana'));
  const withCaio = viewOf(await files.addPerson(ana, { displayName: 'Caio', caseMember: true }));
  const caio = withCaio.people.find(({ displayName }) => displayName === 'Caio')?.id ?? '';
  viewOf(
    await files.answerQuestions(ana, {
      personId: created.me,
      answers: [{ questionId: 'registrations', answer: [{ country: 'BR', occupation: '2211' }] }],
    }),
  );
  viewOf(
    await files.answerQuestions(ana, {
      personId: caio,
      answers: [{ questionId: 'registrations', answer: [{ country: 'BR', occupation: '2512' }] }],
    }),
  );
  return { ana, people: { ana: created.me, caio } };
}

describe('whom the recognition tracks concern (ADR-0041)', () => {
  it('names the people whose facts carry the profession', async () => {
    const { ana, people } = await family();
    expect(await files.recognitionHolders(ana, recognitionTracks)).toEqual([
      { trackId: 'physician', personIds: [people.ana] },
    ]);
  });

  it('names nobody from facts the viewer does not see, and answers nothing outside a case', async () => {
    const { ana } = await family();
    const bruno = await account();
    await admin(`INSERT INTO account.link (inviter_id, invitee_id) VALUES ($1, $2)`, [ana, bruno]);
    viewOf(await files.addMember(ana, { accountId: bruno, displayName: 'Bruno' }));
    expect(await files.recognitionHolders(bruno, recognitionTracks)).toEqual([
      { trackId: 'physician', personIds: [] },
    ]);
    expect(await files.recognitionHolders(await account(), recognitionTracks)).toBeNull();
  });
});

import { randomUUID } from 'node:crypto';
import { parseCalendarDate } from '@arca/domain';
import { comparisonCatalog, routeCatalog, routeIds } from '@arca/knowledge';
import type { Logger } from '@arca/telemetry';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog } from '../../src/audit/log.js';
import { type CaseFiles, type CaseWritten, createCaseFiles } from '../../src/case/case-files.js';
import { createCaseIntake } from '../../src/case/intake.js';
import { type Extractor, ExtractorError } from '../../src/intake/extractor.js';
import { authTestDatabase, type AuthTestDatabase } from './auth-database.js';

// The intake service on the real migrations, as app_api, with a fake extractor (spec 0008, R3).
// Synthetic people only.
let testDatabase: AuthTestDatabase;
let files: CaseFiles;

beforeAll(async () => {
  testDatabase = await authTestDatabase();
  files = createCaseFiles({
    db: () => testDatabase.apiDb,
    audit: auditLog(testDatabase.auditDb),
    today: () => new Date('2026-11-06T12:00:00Z'),
    countries: { countries: ['BR', 'IT', 'PT', 'US'], formerCountries: [] },
    evaluation: {
      catalog: routeCatalog,
      routeIds,
      comparisons: comparisonCatalog,
      states: () => Promise.resolve(new Map()),
      today: () => parseCalendarDate('2026-11-06'),
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

const events = (accountId: string) =>
  admin<{ code: string; details: unknown }>(
    `SELECT code, details FROM audit.event WHERE subject_account_id = $1 ORDER BY time, id`,
    [accountId],
  );

/** Alice's case with her daughter Bruna, whom she keeps, and Caio, who keeps himself. */
async function family() {
  const alice = await account();
  viewOf(await files.create(alice, 'Alice Souza'));
  viewOf(await files.addPerson(alice, { displayName: 'Bruna', caseMember: true }));
  const caio = await account();
  await admin(`INSERT INTO account.link (inviter_id, invitee_id) VALUES ($1, $2)`, [alice, caio]);
  const view = viewOf(await files.addMember(alice, { accountId: caio, displayName: 'Caio' }));
  const idOf = (name: string) => view.people.find(({ displayName }) => displayName === name)?.id;
  return { alice, view, bruna: idOf('Bruna') ?? '', caio: idOf('Caio') ?? '' };
}

/** A fake model that answers each call in turn, and the calls and log lines it saw. */
function service(replies: readonly unknown[]) {
  const calls: { masked: string; known: readonly string[]; writer?: string }[] = [];
  const lines: { level: 'info' | 'error'; fields: unknown }[] = [];
  const logger: Logger = {
    info: (fields) => lines.push({ level: 'info', fields }),
    error: (fields) => lines.push({ level: 'error', fields }),
  };
  const extractor: Extractor = {
    draft: (masked, known, writer) => {
      calls.push({ masked, known, ...(writer === undefined ? {} : { writer }) });
      const reply = replies[calls.length - 1];
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve({
        reply,
        model: 'claude-test',
        promptVersion: 'intake-test',
        inputTokens: 100,
        outputTokens: 20,
      });
    },
  };
  let clock = 0;
  const intake = createCaseIntake({
    db: () => testDatabase.apiDb,
    audit: auditLog(testDatabase.auditDb),
    logger,
    extractor,
    today: () => parseCalendarDate('2026-11-06'),
    now: () => (clock += 5),
  });
  return { intake, calls, lines };
}

const text =
  'Minha filha Bruna nasceu em março de 2015 e é italiana. O Caio nasceu em 1990. ' +
  'Meu marido também tem cidadania italiana. Meu e-mail é alice@example.com.';

const reply = {
  people: [
    { ref: '[P2]', role: 'child', birthDate: '2015-03-12', citizenships: ['IT'] },
    { ref: '[P3]', role: 'other', birthDate: '1990' },
    { ref: 'n1', role: 'spouse', citizenships: ['IT'] },
  ],
  relationships: [{ kind: 'parent', parent: 'n1', child: '[P2]' }],
};

describe('the intake service (spec 0008, R3)', () => {
  it('sends masked text only and answers the draft in case IDs, writing nothing', async () => {
    const { alice, view, bruna, caio } = await family();
    const { intake, calls, lines } = service([reply]);
    const outcome = await intake.draft(alice, text);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    // Alice is [P1], unnamed in the text but sent as the writer, with Bruna's and Caio's.
    expect(call?.known).toEqual(['[P1]', '[P2]', '[P3]']);
    expect(call?.writer).toBe('[P1]');
    for (const name of ['Bruna', 'Caio', 'alice@example.com']) {
      expect(call?.masked).not.toContain(name);
    }
    expect(call?.masked).toContain('março de 2015');
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.value.draft).toEqual({
      people: [
        // Cut to the precision the text states.
        { ref: bruna, role: 'child', birthDate: '2015-03', citizenships: ['IT'] },
        // Caio keeps his own answers: Alice gets only the label.
        { ref: caio, role: 'other' },
        { ref: 'n1', role: 'spouse', citizenships: ['IT'] },
      ],
      relationships: [{ kind: 'parent', parent: 'n1', child: bruna }],
    });
    expect(JSON.stringify(outcome.value)).not.toContain('1990');
    expect(await files.view(alice)).toEqual(view);
    expect(lines).toEqual([
      {
        level: 'info',
        fields: {
          route: '/v1/case/intake/draft',
          model: 'claude-test',
          promptVersion: 'intake-test',
          inputTokens: 100,
          outputTokens: 20,
          durationMs: 5,
        },
      },
    ]);
    expect((await events(alice)).at(-1)).toEqual({
      code: 'intake_drafted',
      details: { caseId: view.caseId, people: 1, facts: 4 },
    });
  });

  it('answers only what the case takes: no less precise date, no edge between people Alice does not keep', async () => {
    const { alice, view, bruna, caio } = await family();
    viewOf(
      await files.answerQuestions(alice, {
        personId: bruna,
        answers: [{ questionId: 'birthDate', answer: '2015-03-12' }],
      }),
    );
    const dora = await account();
    await admin(`INSERT INTO account.link (inviter_id, invitee_id) VALUES ($1, $2)`, [alice, dora]);
    viewOf(await files.addMember(alice, { accountId: dora, displayName: 'Dora' }));
    const { intake } = service([
      {
        people: [{ ref: '[P2]', birthDate: '2015' }, { ref: '[P3]' }, { ref: '[P4]' }],
        relationships: [{ kind: 'spouse', people: ['[P3]', '[P4]'], start: '2010' }],
      },
    ]);
    const outcome = await intake.draft(
      alice,
      'A Bruna nasceu em 2015. O Caio e a Dora casaram em 2010.',
    );
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.value).toEqual({
      draft: {
        people: [{ ref: bruna }, { ref: caio }, { ref: expect.any(String) as string }],
        relationships: [],
      },
    });
    expect(view.people.map(({ id }) => id)).toContain(caio);
  });

  it('answers the writer as their own person, with only the facts they lack', async () => {
    const { alice, view, bruna } = await family();
    const me = view.people.find(({ displayName }) => displayName === 'Alice Souza')?.id ?? '';
    const { intake } = service([
      {
        people: [
          { ref: 'n1', role: 'self', birthDate: '1985', residenceCountry: 'PT' },
          { ref: '[P2]', role: 'child' },
        ],
        relationships: [{ kind: 'parent', parent: 'n1', child: '[P2]', parentKind: 'biological' }],
      },
    ]);
    const outcome = await intake.draft(alice, 'Nasci em 1985 e moro em Portugal com a Bruna.');
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.value.draft).toEqual({
      people: [
        { ref: me, role: 'self', birthDate: '1985', residenceCountry: 'PT' },
        { ref: bruna, role: 'child' },
      ],
      relationships: [{ kind: 'parent', parent: me, child: bruna, parentKind: 'biological' }],
    });
  });

  it('asks once more for an unparsable reply, then gives up', async () => {
    const { alice } = await family();
    const once = service([{ people: [{ ref: '[P9]' }], relationships: [] }, reply]);
    expect((await once.intake.draft(alice, text)).ok).toBe(true);
    expect(once.calls).toHaveLength(2);
    const twice = service([{ nope: true }, new ExtractorError('intake_unparsable'), reply]);
    expect(await twice.intake.draft(alice, text)).toEqual({
      ok: false,
      reason: 'intake_unparsable',
    });
    expect(twice.calls).toHaveLength(2);
    expect(twice.lines.filter(({ level }) => level === 'error')).toHaveLength(2);
  });

  it.each([
    [new ExtractorError('intake_timeout'), 'intake_timeout'],
    [new ExtractorError('intake_unavailable'), 'intake_unavailable'],
    [new Error('Bruna alice@example.com'), 'intake_failed'],
  ] as const)(
    'answers a failed call with its code, logging nothing of the text',
    async (error, reason) => {
      const { alice } = await family();
      const before = await events(alice);
      const { intake, lines } = service([error]);
      expect(await intake.draft(alice, text)).toEqual({ ok: false, reason });
      expect(lines).toEqual([
        {
          level: 'error',
          fields: { route: '/v1/case/intake/draft', errorCode: reason, durationMs: 5 },
        },
      ]);
      expect(await events(alice)).toEqual(before);
    },
  );

  it('answers not_found outside a case without calling the model', async () => {
    const { intake, calls } = service([reply]);
    expect(await intake.draft(await account(), text)).toEqual({ ok: false, reason: 'not_found' });
    expect(calls).toEqual([]);
  });
});

import { randomUUID } from 'node:crypto';
import {
  buildCaseSnapshot,
  parseCalendarDate,
  storedAssetSchema,
  storedProfileFactsSchema,
} from '@arca/domain';
import { withIdentity } from '@arca/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog } from '../../src/audit/log.js';
import { type CaseFiles, type CaseWritten, createCaseFiles } from '../../src/case/case-files.js';
import { readCase } from '../../src/case/view.js';
import { authTestDatabase, type AuthTestDatabase } from './auth-database.js';

// The case API's service on the real migrations, as app_api (spec 0007, R1 to R3). Synthetic
// people and amounts only.
let testDatabase: AuthTestDatabase;
let files: CaseFiles;

beforeAll(async () => {
  testDatabase = await authTestDatabase();
  files = createCaseFiles({
    db: () => testDatabase.apiDb,
    audit: auditLog(testDatabase.auditDb),
    today: () => new Date('2026-11-06T12:00:00Z'),
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

/** The view of a write that must succeed. */
function viewOf(written: CaseWritten) {
  if (!written.ok) throw new Error(`refused: ${written.reason}`);
  return written.view;
}

const refusal = (written: CaseWritten) => (written.ok ? 'written' : written.reason);

/** Joins a member the way ticket 3 will, which this ticket does not build. */
async function join(caseId: string, accountId: string, displayName: string) {
  await admin(`INSERT INTO cases.member (account_id, case_id) VALUES ($1, $2)`, [
    accountId,
    caseId,
  ]);
  const [row] = await admin<{ id: string }>(
    `INSERT INTO cases.person (case_id, keeper_account_id, account_id, display_name, case_member)
     VALUES ($1, $2, $2, $3, true) RETURNING id`,
    [caseId, accountId, displayName],
  );
  if (row === undefined) throw new Error('no person');
  return row.id;
}

/** Alice's case with Bruno as a member, and a child Alice keeps. */
async function family() {
  const alice = await account();
  const bruno = await account();
  const created = viewOf(await files.create(alice, 'Alice'));
  const brunoPerson = await join(created.caseId, bruno, 'Bruno');
  const withChild = viewOf(
    await files.addPerson(alice, { displayName: 'Criança', caseMember: true }),
  );
  const child = withChild.people.find((person) => person.displayName === 'Criança');
  if (child === undefined) throw new Error('no child');
  return {
    caseId: created.caseId,
    alice,
    bruno,
    people: { alice: created.me, bruno: brunoPerson, child: child.id },
  };
}

const events = (accountId: string) =>
  admin<{ code: string; details: Record<string, string> }>(
    `SELECT code, details FROM audit.event WHERE subject_account_id = $1 ORDER BY time, id`,
    [accountId],
  );

const house = storedAssetSchema.parse({
  kind: 'real_estate',
  value: { amount: 50000000, currency: 'BRL' },
  valuedAt: '2026-01-10',
});

describe('creating a case (spec 0007, R2)', () => {
  it('makes the account its first member, with its own person, once', async () => {
    const alice = await account();
    expect(await files.view(alice)).toBeNull();
    const view = viewOf(await files.create(alice, 'Alice'));
    expect(view.people).toEqual([
      {
        id: view.me,
        displayName: 'Alice',
        caseMember: true,
        accountId: alice,
        keptByMe: true,
        profile: null,
        finances: null,
        shares: { profile: [], finances: [] },
      },
    ]);
    expect(refusal(await files.create(alice, 'Alice again'))).toBe('case_exists');
    expect(await events(alice)).toEqual([
      { code: 'case_created', details: { caseId: view.caseId } },
    ]);
  });

  it('creates one case when the same account asks twice at once', async () => {
    const alice = await account();
    const outcomes = await Promise.all([
      files.create(alice, 'Alice'),
      files.create(alice, 'Alice'),
    ]);
    expect(outcomes.map(refusal).sort()).toEqual(['case_exists', 'written']);
    expect(await admin(`SELECT FROM cases.case_file`)).toHaveLength(
      (await admin(`SELECT DISTINCT case_id FROM cases.member`)).length,
    );
  });

  it('refuses writes outside a case', async () => {
    const stranger = await account();
    expect(refusal(await files.addPerson(stranger, { displayName: 'X', caseMember: false }))).toBe(
      'not_found',
    );
    expect(await files.leave(stranger)).toBe('not_found');
  });
});

describe('people', () => {
  it('lets the keeper add, rename and remove people without an account, never a member’s own', async () => {
    const { alice, bruno, people } = await family();
    const renamed = viewOf(
      await files.updatePerson(alice, {
        personId: people.child,
        displayName: 'Filha',
        caseMember: true,
      }),
    );
    expect(renamed.people.find((person) => person.id === people.child)?.displayName).toBe('Filha');
    expect(
      refusal(
        await files.updatePerson(bruno, {
          personId: people.child,
          displayName: 'Outro nome',
          caseMember: true,
        }),
      ),
    ).toBe('not_found');
    expect(
      refusal(
        await files.updatePerson(alice, {
          personId: people.alice,
          displayName: 'Alice',
          caseMember: false,
        }),
      ),
    ).toBe('case_invalid');
    expect(refusal(await files.removePerson(alice, people.alice))).toBe('not_found');
    expect(refusal(await files.removePerson(bruno, people.child))).toBe('not_found');
    const removed = viewOf(await files.removePerson(alice, people.child));
    expect(removed.people.map(({ id }) => id).sort()).toEqual([people.alice, people.bruno].sort());
    expect((await events(alice)).map(({ code }) => code)).toEqual([
      'case_created',
      'person_added',
      'person_removed',
    ]);
  });

  it('holds 60 people and 30 members per case, also against concurrent writes', async () => {
    const { caseId, alice } = await family();
    // Three people so far; fill up to 59 directly, then race for the last place.
    await admin(
      `INSERT INTO cases.person (case_id, keeper_account_id, display_name, case_member)
       SELECT $1, $2, 'Parente ' || n, n <= 26 FROM generate_series(1, 56) AS n`,
      [caseId, alice],
    );
    const raced = await Promise.all([
      files.addPerson(alice, { displayName: 'Primo', caseMember: true }),
      files.addPerson(alice, { displayName: 'Prima', caseMember: true }),
    ]);
    expect(raced.map(refusal).sort()).toEqual(['case_limit', 'written']);
    const view = await files.view(alice);
    expect(view?.people).toHaveLength(60);
    expect(view?.people.filter((person) => person.caseMember)).toHaveLength(30);
    expect(refusal(await files.addPerson(alice, { displayName: 'Tio', caseMember: false }))).toBe(
      'case_limit',
    );
  });
});

describe('profiles, finances and shares', () => {
  it('keeps dependence unknown until answered, and only names people of the case', async () => {
    const { alice, people } = await family();
    const profile = (dependsOn: string[] | null) =>
      files.writeProfile(alice, {
        personId: people.child,
        facts: storedProfileFactsSchema.parse({ birthDate: '2015-03', studying: true }),
        dependsOn,
      });
    const unknown = viewOf(await profile(null));
    expect(unknown.people.find(({ id }) => id === people.child)?.profile).toEqual({
      facts: { birthDate: '2015-03', studying: true },
      dependsOn: null,
    });
    const answered = viewOf(await profile([people.alice, people.bruno]));
    expect(answered.people.find(({ id }) => id === people.child)?.profile?.dependsOn).toEqual(
      [people.alice, people.bruno].sort(),
    );
    expect(viewOf(await profile([])).people.find(({ id }) => id === people.child)?.profile).toEqual(
      { facts: { birthDate: '2015-03', studying: true }, dependsOn: [] },
    );
    for (const wrong of [[people.child], [people.alice, people.alice], [randomUUID()]]) {
      expect(refusal(await profile(wrong))).toBe('case_invalid');
    }
  });

  it('shows a profile and finances only to the keeper and the members it shares them with', async () => {
    const { alice, bruno, people } = await family();
    await files.writeProfile(alice, {
      personId: people.child,
      facts: { studying: true },
      dependsOn: [],
    });
    await files.writeFinances(alice, {
      personId: people.alice,
      incomes: [
        { kind: 'active', monthly: { amount: 900000, currency: 'BRL' }, sourceCountry: 'BR' },
      ],
      assetsRecordedInFull: true,
    });
    const seenBy = async (accountId: string, personId: string) =>
      (await files.view(accountId))?.people.find(({ id }) => id === personId);
    expect((await seenBy(bruno, people.child))?.profile).toBeNull();
    expect((await seenBy(bruno, people.alice))?.finances).toBeNull();
    expect((await seenBy(bruno, people.alice))?.shares).toBeNull();

    viewOf(
      await files.replaceShares(alice, {
        personId: people.child,
        profile: [bruno],
        finances: [],
      }),
    );
    expect((await seenBy(bruno, people.child))?.profile?.facts).toEqual({ studying: true });
    expect((await seenBy(alice, people.child))?.shares).toEqual({ profile: [bruno], finances: [] });
    viewOf(await files.replaceShares(alice, { personId: people.child, profile: [], finances: [] }));
    expect((await seenBy(bruno, people.child))?.profile).toBeNull();

    for (const grantees of [[alice], [randomUUID()]]) {
      expect(
        refusal(
          await files.replaceShares(alice, {
            personId: people.child,
            profile: grantees,
            finances: [],
          }),
        ),
      ).toBe('case_invalid');
    }
    expect(
      refusal(
        await files.replaceShares(bruno, {
          personId: people.child,
          profile: [bruno],
          finances: [],
        }),
      ),
    ).toBe('not_found');
    expect((await events(alice)).filter(({ code }) => code.startsWith('share_'))).toEqual([
      {
        code: 'share_granted',
        details: { personId: people.child, accountId: bruno, scope: 'profile' },
      },
      {
        code: 'share_revoked',
        details: { personId: people.child, accountId: bruno, scope: 'profile' },
      },
    ]);
  });

  it('hands a person over to another member, dropping their shares', async () => {
    const { alice, bruno, people } = await family();
    await files.replaceShares(alice, {
      personId: people.child,
      profile: [bruno],
      finances: [bruno],
    });
    expect(refusal(await files.handOver(bruno, { personId: people.child, accountId: bruno }))).toBe(
      'not_found',
    );
    expect(refusal(await files.handOver(alice, { personId: people.alice, accountId: bruno }))).toBe(
      'not_found',
    );
    expect(
      refusal(await files.handOver(alice, { personId: people.child, accountId: randomUUID() })),
    ).toBe('not_found');
    const handed = viewOf(
      await files.handOver(alice, { personId: people.child, accountId: bruno }),
    );
    expect(handed.people.find(({ id }) => id === people.child)?.keptByMe).toBe(false);
    const brunoView = await files.view(bruno);
    expect(brunoView?.people.find(({ id }) => id === people.child)).toMatchObject({
      keptByMe: true,
      shares: { profile: [], finances: [] },
    });
    expect((await events(alice)).at(-1)).toEqual({
      code: 'person_handed_over',
      details: { personId: people.child, accountId: bruno },
    });
  });
});

describe('relationships', () => {
  it('adds edges a keeper of either person writes, and refuses cycles and repeats', async () => {
    const { alice, bruno, people } = await family();
    const parent = (from: string, to: string) =>
      ({ kind: 'parent', from, to, details: {} }) as const;
    const added = viewOf(await files.addRelationship(alice, parent(people.alice, people.child)));
    expect(
      added.relationships.map(({ editable, relationship }) => ({ editable, relationship })),
    ).toEqual([{ editable: true, relationship: parent(people.alice, people.child) }]);
    expect((await files.view(bruno))?.relationships[0]?.editable).toBe(false);
    viewOf(
      await files.addRelationship(bruno, {
        kind: 'spouse',
        from: people.alice,
        to: people.bruno,
        details: {},
      }),
    );
    expect(refusal(await files.addRelationship(alice, parent(people.alice, people.child)))).toBe(
      'case_invalid',
    );
    expect(refusal(await files.addRelationship(alice, parent(people.child, people.alice)))).toBe(
      'case_invalid',
    );
    expect(refusal(await files.addRelationship(alice, parent(people.alice, randomUUID())))).toBe(
      'not_found',
    );
    const other = await account();
    viewOf(await files.create(other, 'Outra família'));
    expect(refusal(await files.addRelationship(other, parent(people.alice, people.child)))).toBe(
      'not_found',
    );
    const relationshipId = added.relationships[0]?.id ?? '';
    expect(refusal(await files.removeRelationship(other, relationshipId))).toBe('not_found');
    expect(
      viewOf(await files.removeRelationship(alice, relationshipId)).relationships,
    ).toHaveLength(1);
  });

  it('holds 200 relationships per case', async () => {
    const { caseId, alice, people } = await family();
    await admin(
      `INSERT INTO cases.relationship (case_id, kind, from_person_id, to_person_id, details)
       SELECT $1, 'partner', $2, $3, jsonb_build_object('start', (2000 + n)::text)
         FROM generate_series(1, 200) AS n`,
      [caseId, people.alice, people.bruno],
    );
    expect(
      refusal(
        await files.addRelationship(alice, {
          kind: 'parent',
          from: people.alice,
          to: people.child,
          details: {},
        }),
      ),
    ).toBe('case_limit');
  });
});

describe('assets and owners', () => {
  it('adds an asset with its owner, names a pending co-owner, and counts only what each sees', async () => {
    const { alice, bruno, people } = await family();
    const added = viewOf(
      await files.addAsset(alice, { personId: people.alice, share: '0.5', asset: house }),
    );
    const assetId = added.assets[0]?.id ?? '';
    expect(added.assets).toEqual([
      {
        id: assetId,
        editable: true,
        asset: house,
        owners: [{ personId: people.alice, share: '0.500000', confirmed: true }],
      },
    ]);
    expect((await files.view(bruno))?.assets).toEqual([]);

    viewOf(await files.setOwner(alice, { assetId, personId: people.bruno, share: '0.5' }));
    const pending = await files.view(bruno);
    expect(pending?.assets[0]).toMatchObject({
      editable: false,
      owners: [{ personId: people.bruno, share: '0.500000', confirmed: false }],
    });
    expect(
      refusal(await files.setOwner(alice, { assetId, personId: people.child, share: '0.1' })),
    ).toBe('case_limit');
    expect(
      refusal(await files.setOwner(alice, { assetId, personId: people.bruno, share: '0.4' })),
    ).toBe('not_found');
    expect(refusal(await files.updateAsset(bruno, { assetId, asset: house }))).toBe('not_found');

    const confirmed = viewOf(await files.confirmOwner(bruno, { assetId, personId: people.bruno }));
    expect(confirmed.assets[0]?.editable).toBe(true);
    const snapshotFor = (accountId: string) =>
      withIdentity(testDatabase.apiDb, { accountId }, async (tx) => {
        const rows = await readCase(tx, accountId);
        if (rows === undefined) throw new Error('no case');
        return buildCaseSnapshot(rows, parseCalendarDate('2026-11-06')).snapshot.assets;
      });
    expect((await snapshotFor(bruno)).map(({ owners }) => owners)).toEqual([
      [{ person: 'p2', share: '0.500000' }],
    ]);
    expect((await snapshotFor(alice)).map(({ owners }) => owners)).toEqual([
      [{ person: 'p1', share: '0.500000' }],
    ]);

    viewOf(await files.removeOwner(alice, { assetId, personId: people.alice }));
    expect((await files.view(alice))?.assets).toEqual([]);
    viewOf(await files.removeOwner(bruno, { assetId, personId: people.bruno }));
    expect(await admin(`SELECT FROM cases.asset WHERE id = $1`, [assetId])).toEqual([]);
  });

  it('holds 100 assets per case and shares adding up to 1 against concurrent writes', async () => {
    const { caseId, alice, people } = await family();
    const asset = viewOf(
      await files.addAsset(alice, { personId: people.alice, share: '0.2', asset: house }),
    ).assets[0];
    const raced = await Promise.all([
      files.setOwner(alice, { assetId: asset?.id ?? '', personId: people.child, share: '0.5' }),
      files.setOwner(alice, { assetId: asset?.id ?? '', personId: people.bruno, share: '0.5' }),
    ]);
    expect(raced.map(refusal).sort()).toEqual(['case_limit', 'written']);
    await admin(
      `INSERT INTO cases.asset (case_id, kind, value_amount, value_currency, valued_at)
       SELECT $1, 'cash', n, 'BRL', '2026-01-01' FROM generate_series(1, 99) AS n`,
      [caseId],
    );
    expect(
      refusal(await files.addAsset(alice, { personId: people.alice, share: '1', asset: house })),
    ).toBe('case_limit');
  });
});

describe('leaving the case (spec 0007, R2)', () => {
  it('takes the people the member keeps and their shares, and the case with its last member', async () => {
    const { caseId, alice, bruno, people } = await family();
    const kept = viewOf(await files.addPerson(bruno, { displayName: 'Avó', caseMember: false }));
    const grandma = kept.people.find(({ displayName }) => displayName === 'Avó')?.id ?? '';
    await files.addRelationship(bruno, {
      kind: 'parent',
      from: grandma,
      to: people.bruno,
      details: {},
    });
    await files.replaceShares(alice, { personId: people.child, profile: [bruno], finances: [] });
    await files.addAsset(bruno, { personId: people.bruno, share: '1', asset: house });

    expect(await files.leave(bruno)).toBe('left');
    expect(await files.view(bruno)).toBeNull();
    const view = await files.view(alice);
    expect(view?.people.map(({ id }) => id).sort()).toEqual([people.alice, people.child].sort());
    expect(view?.relationships).toEqual([]);
    expect(view?.people.find(({ id }) => id === people.child)?.shares).toEqual({
      profile: [],
      finances: [],
    });
    expect(await admin(`SELECT FROM cases.asset WHERE case_id = $1`, [caseId])).toEqual([]);
    expect((await events(bruno)).at(-1)).toEqual({ code: 'member_left', details: { caseId } });

    expect(await files.leave(alice)).toBe('left');
    expect(await admin(`SELECT FROM cases.case_file WHERE id = $1`, [caseId])).toEqual([]);
  });
});

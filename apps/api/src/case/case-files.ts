import type {
  AddCaseMemberRequest,
  AnswerCaseQuestionsRequest,
  AuditEventCode,
  CasePlayback,
  CaseQuestions,
  CaseView,
  HandOverCasePersonRequest,
  ReportRuleRequest,
} from '@arca/api-contract/routes';
import type {
  AddCaseAssetRequest,
  AddCasePersonRequest,
  CaseAssetOwnerReference,
  ReplaceCaseSharesRequest,
  SetCaseAssetOwnerRequest,
  UpdateCaseAssetRequest,
  UpdateCasePersonRequest,
  WriteCaseFinancesRequest,
  WriteCaseProfileRequest,
} from '@arca/api-contract/routes';
import { withIdentity, type Database, type Transaction } from '@arca/db';
import {
  type CalendarDate,
  type DecisionStates,
  type HeldAsset,
  type RouteCatalog,
  type StoredFinances,
  type StoredProfile,
  applyAnswers,
  heldAssetChanges,
  maxCaseMembers,
  maxCasePeople,
  maxCaseRelationships,
  type ShareScope,
  type StoredAsset,
  type StoredRelationship,
  parseCalendarDate,
  shareScopes,
  questionFlow,
  validCaseStructure,
} from '@arca/domain';
import type { PinnedCountries } from '@arca/knowledge';
import { type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { AuditLog, AuditRecord } from '../audit/log.js';
import { caseQuestions, questionState } from './questions.js';
import { type CaseEvaluationsView, caseEvaluations } from './evaluations.js';
import { casePlayback } from './playback.js';
import { type CaseRows, caseView, memberCase, readCase } from './view.js';

/** Why a write was refused; each answers one status, and says nothing of a hidden row. */
export type CaseRefusal = 'not_found' | 'case_exists' | 'case_limit' | 'case_invalid';

export type CaseWritten =
  | { readonly ok: true; readonly view: CaseView }
  | {
      readonly ok: false;
      readonly reason: CaseRefusal;
    };

type Request<Schema extends z.ZodType> = z.infer<Schema>;

/**
 * The family's case (spec 0007, R1 to R3), on the app_api pool under the account's identity, so
 * row-level security decides what each account sees and writes. Every write takes the case's
 * transaction lock first, so its checks and the limits hold against concurrent writes, and
 * answers the case as the account now sees it.
 */
export interface CaseFiles {
  readonly view: (accountId: string) => Promise<CaseView | null>;
  readonly create: (accountId: string, displayName: string) => Promise<CaseWritten>;
  readonly addPerson: (
    accountId: string,
    request: Request<typeof AddCasePersonRequest>,
  ) => Promise<CaseWritten>;
  readonly updatePerson: (
    accountId: string,
    request: Request<typeof UpdateCasePersonRequest>,
  ) => Promise<CaseWritten>;
  readonly removePerson: (accountId: string, personId: string) => Promise<CaseWritten>;
  readonly handOver: (
    accountId: string,
    request: HandOverCasePersonRequest,
  ) => Promise<CaseWritten>;
  /** Adds an account linked to the viewer; answers the case unchanged when it is already in it. */
  readonly addMember: (accountId: string, request: AddCaseMemberRequest) => Promise<CaseWritten>;
  readonly writeProfile: (
    accountId: string,
    request: Request<typeof WriteCaseProfileRequest>,
  ) => Promise<CaseWritten>;
  readonly writeFinances: (
    accountId: string,
    request: Request<typeof WriteCaseFinancesRequest>,
  ) => Promise<CaseWritten>;
  readonly replaceShares: (
    accountId: string,
    request: Request<typeof ReplaceCaseSharesRequest>,
  ) => Promise<CaseWritten>;
  readonly addRelationship: (
    accountId: string,
    relationship: StoredRelationship,
  ) => Promise<CaseWritten>;
  readonly removeRelationship: (accountId: string, relationshipId: string) => Promise<CaseWritten>;
  readonly addAsset: (
    accountId: string,
    request: Request<typeof AddCaseAssetRequest>,
  ) => Promise<CaseWritten>;
  readonly updateAsset: (
    accountId: string,
    request: Request<typeof UpdateCaseAssetRequest>,
  ) => Promise<CaseWritten>;
  readonly removeAsset: (accountId: string, assetId: string) => Promise<CaseWritten>;
  readonly setOwner: (
    accountId: string,
    request: Request<typeof SetCaseAssetOwnerRequest>,
  ) => Promise<CaseWritten>;
  readonly confirmOwner: (
    accountId: string,
    request: Request<typeof CaseAssetOwnerReference>,
  ) => Promise<CaseWritten>;
  readonly removeOwner: (
    accountId: string,
    request: Request<typeof CaseAssetOwnerReference>,
  ) => Promise<CaseWritten>;
  /** The guided questions of the people the account keeps; null outside a case. */
  readonly questions: (accountId: string) => Promise<CaseQuestions | null>;
  /** The case read back as sentences; null outside a case. */
  readonly playback: (accountId: string) => Promise<CasePlayback | null>;
  /** Every route for each member as principal, from what the viewer sees; null outside a case. */
  readonly evaluations: (accountId: string) => Promise<CaseEvaluationsView | null>;
  /**
   * Reports a requirement of the viewer's own evaluation as possibly wrong (R8); `not_found` when
   * the viewer is in no case or the evaluation holds no such requirement.
   */
  readonly reportRule: (
    accountId: string,
    request: ReportRuleRequest,
  ) => Promise<'reported' | 'not_found'>;
  readonly answerQuestions: (
    accountId: string,
    request: AnswerCaseQuestionsRequest,
  ) => Promise<CaseWritten>;
  /** Deletes the account's member row, and with it every person it keeps. */
  readonly leave: (accountId: string) => Promise<'left' | 'not_found'>;
}

export interface CaseFilesSettings {
  /** The app_api pool, read when a request first needs it. */
  readonly db: () => Database;
  readonly audit: AuditLog;
  /** Today, which the structure checks read the case as of. */
  readonly today: () => Date;
  /** The pinned countries the guided questions offer and accept. */
  readonly countries: PinnedCountries;
  readonly evaluation: {
    readonly catalog: RouteCatalog;
    readonly routeIds: readonly string[];
    readonly states: () => Promise<DecisionStates>;
    /** Today in São Paulo, which evaluations select versions and compute facts as of. */
    readonly today: () => CalendarDate;
    readonly engineCommit: string;
  };
}

/** The snapshot's limits that every member can count (spec 0007, R1); the rest are the definer's. */
export const caseSizeLimits = {
  people: maxCasePeople,
  members: maxCaseMembers,
  relationships: maxCaseRelationships,
} as const;

/** Raised by the case's definer functions when a limit is reached (SQLSTATE CL001). */
const limitReached = 'CL001';

class Refused extends Error {
  readonly reason: CaseRefusal;
  constructor(reason: CaseRefusal) {
    super(reason);
    this.reason = reason;
  }
}

/** An event of the actor's own account, unless it names another account it happened to. */
type Event = Omit<AuditRecord, 'subjectAccountId' | 'actorAccountId'> & {
  readonly subjectAccountId?: string;
};
const event = <Code extends AuditEventCode>(
  code: Code,
  details: AuditRecord<Code>['details'],
): Event => ({ code, details });

/** The SQLSTATE of a database error, through the query builder's wrapping. */
function sqlState(error: unknown): string | undefined {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    if ('code' in cause && typeof cause.code === 'string' && /^[0-9A-Z]{5}$/.test(cause.code)) {
      return cause.code;
    }
  }
  return undefined;
}

const refuseUnless = (condition: boolean, reason: CaseRefusal) => {
  if (!condition) throw new Refused(reason);
};

/** Whether a query gave a row: row-level security hides what the viewer may not see or write. */
const one = async (tx: Transaction, query: SQL) =>
  (await tx.execute<Record<string, unknown>>(query)).rows.length > 0;

/** The value an asset's columns hold. */
const assetColumns = (asset: StoredAsset) => ({
  kind: asset.kind,
  amount: asset.value.amount,
  currency: asset.value.currency,
  valuedAt: asset.valuedAt,
  liquid: asset.liquid ?? null,
  sold: asset.sold ?? null,
});

/** Whether a confirmed invite links the two accounts, either way; the identity sees only its own. */
const linked = (tx: Transaction, accountId: string, other: string) =>
  one(
    tx,
    sql`SELECT FROM account.link
         WHERE (inviter_id = ${accountId} AND invitee_id = ${other})
            OR (invitee_id = ${accountId} AND inviter_id = ${other})`,
  );

const isoDate = (date: Date) => parseCalendarDate(date.toISOString().slice(0, 10));

/** The key the empty-case cleanup and the definer functions lock: a case's writes run one at a time. */
const lockCase = (tx: Transaction, caseId: string) =>
  tx.execute(
    sql`SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${`cases.case_file:${caseId}`}, 0))`,
  );

/** Replaces a person's facts and dependence; dependence names other people of the case. */
async function saveProfile(
  tx: Transaction,
  rows: CaseRows,
  personId: string,
  facts: StoredProfile['facts'],
  dependsOn: readonly string[] | null,
) {
  const known = new Set(rows.people.map(({ id }) => id));
  refuseUnless(
    dependsOn === null ||
      (new Set(dependsOn).size === dependsOn.length &&
        dependsOn.every((id) => id !== personId && known.has(id))),
    'case_invalid',
  );
  await tx.execute(sql`
    INSERT INTO cases.person_profile (person_id, facts, dependence_answered)
    VALUES (${personId}, ${JSON.stringify(facts)}::jsonb, ${dependsOn !== null})
    ON CONFLICT (person_id) DO UPDATE
      SET facts = excluded.facts, dependence_answered = excluded.dependence_answered,
          updated_at = now()`);
  await tx.execute(sql`DELETE FROM cases.dependence WHERE person_id = ${personId}`);
  if (dependsOn !== null && dependsOn.length > 0) {
    await tx.execute(sql`
      INSERT INTO cases.dependence (case_id, person_id, depends_on_id)
      VALUES ${sql.join(
        dependsOn.map((id) => sql`(${rows.caseId}, ${personId}, ${id})`),
        sql`, `,
      )}`);
  }
}

async function saveFinances(
  tx: Transaction,
  personId: string,
  { incomes, assetsRecordedInFull }: StoredFinances,
) {
  const stored = incomes === undefined ? null : JSON.stringify(incomes);
  await tx.execute(sql`
    INSERT INTO cases.person_finances (person_id, incomes, assets_recorded_in_full)
    VALUES (${personId}, ${stored}::jsonb, ${assetsRecordedInFull})
    ON CONFLICT (person_id) DO UPDATE
      SET incomes = excluded.incomes,
          assets_recorded_in_full = excluded.assets_recorded_in_full, updated_at = now()`);
}

async function insertAsset(tx: Transaction, personId: string, share: string, asset: StoredAsset) {
  const fields = assetColumns(asset);
  const added = await tx.execute<{ id: string | null }>(sql`
    SELECT cases.add_asset(${personId}, ${share}::numeric, ${fields.kind},
                           ${fields.amount}::bigint, ${fields.currency},
                           ${fields.valuedAt}::date, ${fields.liquid}::boolean,
                           ${fields.sold}::text) AS id`);
  refuseUnless((added.rows[0]?.id ?? null) !== null, 'not_found');
}

async function updateAssetRow(tx: Transaction, assetId: string, asset: StoredAsset) {
  const fields = assetColumns(asset);
  refuseUnless(
    await one(
      tx,
      sql`
        UPDATE cases.asset
           SET kind = ${fields.kind}, value_amount = ${fields.amount},
               value_currency = ${fields.currency}, valued_at = ${fields.valuedAt}::date,
               liquid = ${fields.liquid}, sold = ${fields.sold}, updated_at = now()
         WHERE id = ${assetId} RETURNING id`,
    ),
    'not_found',
  );
}

async function setOwnerShare(tx: Transaction, assetId: string, personId: string, share: string) {
  const set = await tx.execute<{ set: boolean }>(
    sql`SELECT cases.set_owner(${assetId}, ${personId}, ${share}::numeric) AS set`,
  );
  refuseUnless(set.rows[0]?.set === true, 'not_found');
}

async function deleteOwnerRow(tx: Transaction, assetId: string, personId: string) {
  refuseUnless(
    await one(
      tx,
      sql`
        DELETE FROM cases.asset_owner
         WHERE asset_id = ${assetId} AND person_id = ${personId} RETURNING asset_id`,
    ),
    'not_found',
  );
}

async function saveHeldAssets(
  tx: Transaction,
  personId: string,
  before: readonly HeldAsset[],
  after: readonly HeldAsset[],
) {
  const { dropped, added, updated, reshared } = heldAssetChanges(before, after);
  for (const id of dropped) await deleteOwnerRow(tx, id, personId);
  for (const { share, asset } of added) await insertAsset(tx, personId, share, asset);
  for (const { id, asset } of updated) await updateAssetRow(tx, id, asset);
  for (const { id, share } of reshared) await setOwnerShare(tx, id, personId, share);
}

export function createCaseFiles({
  db,
  audit,
  today,
  countries,
  evaluation,
}: CaseFilesSettings): CaseFiles {
  const known = {
    countries: new Set(countries.countries),
    formerCountries: new Set(countries.formerCountries),
  };
  /**
   * Runs one write in the viewer's case under its lock, then records its events once it
   * committed. `work` throws `Refused` to roll back with a refusal.
   */
  const write = async (
    accountId: string,
    work: (tx: Transaction, rows: CaseRows) => Promise<readonly Event[]>,
  ): Promise<CaseWritten> => {
    let events: readonly Event[] = [];
    try {
      const written = await withIdentity(db(), { accountId }, async (tx) => {
        const caseId = await memberCase(tx, accountId);
        if (caseId === undefined) throw new Refused('not_found');
        await lockCase(tx, caseId);
        const before = await readCase(tx, accountId, caseId);
        if (before === undefined) throw new Refused('not_found');
        events = await work(tx, before);
        const after = await readCase(tx, accountId, caseId);
        if (after === undefined) throw new Refused('not_found');
        return caseView(after, accountId);
      });
      await recordAll(accountId, events);
      return { ok: true, view: written };
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason };
      if (sqlState(error) === limitReached) return { ok: false, reason: 'case_limit' };
      throw error;
    }
  };

  const recordAll = async (accountId: string, events: readonly Event[]) => {
    for (const entry of events) {
      await audit.record({
        ...entry,
        subjectAccountId: entry.subjectAccountId ?? accountId,
        actorAccountId: accountId,
      });
    }
  };

  const keptPerson = (rows: CaseRows, personId: string) => {
    const person = rows.people.find((row) => row.id === personId && row.keptByMe);
    if (person === undefined) throw new Refused('not_found');
    return person;
  };

  const members = (rows: CaseRows) => rows.people.filter((row) => row.caseMember).length;

  const view = (accountId: string) =>
    withIdentity(db(), { accountId }, async (tx) => {
      const rows = await readCase(tx, accountId);
      return rows === undefined ? null : caseView(rows, accountId);
    });

  return {
    view,

    async create(accountId, displayName) {
      const caseId = await withIdentity(db(), { accountId }, async (tx) => {
        const created = await tx.execute<{ id: string | null }>(
          sql`SELECT cases.create_case(${displayName}) AS id`,
        );
        return created.rows[0]?.id ?? null;
      });
      if (caseId === null) return { ok: false, reason: 'case_exists' };
      await recordAll(accountId, [event('case_created', { caseId })]);
      const created = await view(accountId);
      if (created === null) throw new Error('A case just created is not visible to its member');
      return { ok: true, view: created };
    },

    addPerson: (accountId, { displayName, caseMember }) =>
      write(accountId, async (tx, rows) => {
        refuseUnless(rows.people.length < caseSizeLimits.people, 'case_limit');
        refuseUnless(!caseMember || members(rows) < caseSizeLimits.members, 'case_limit');
        const added = await tx.execute<{ id: string }>(sql`
          INSERT INTO cases.person (case_id, keeper_account_id, display_name, case_member)
          VALUES (${rows.caseId}, ${accountId}, ${displayName}, ${caseMember}) RETURNING id`);
        const personId = added.rows[0]?.id;
        if (personId === undefined) throw new Error('An added person has no ID');
        return [event('person_added', { personId })];
      }),

    updatePerson: (accountId, { personId, displayName, caseMember }) =>
      write(accountId, async (tx, rows) => {
        const person = keptPerson(rows, personId);
        refuseUnless(caseMember || person.accountId === null, 'case_invalid');
        refuseUnless(
          !caseMember || person.caseMember || members(rows) < caseSizeLimits.members,
          'case_limit',
        );
        await tx.execute(sql`
          UPDATE cases.person SET display_name = ${displayName}, case_member = ${caseMember}
           WHERE id = ${personId}`);
        return [];
      }),

    removePerson: (accountId, personId) =>
      write(accountId, async (tx) => {
        refuseUnless(
          await one(tx, sql`DELETE FROM cases.person WHERE id = ${personId} RETURNING id`),
          'not_found',
        );
        return [event('person_removed', { personId })];
      }),

    handOver: (accountId, { personId, accountId: newKeeper }) =>
      write(accountId, async (tx) => {
        const handed = await tx.execute<{ handed: boolean }>(
          sql`SELECT cases.hand_over(${personId}, ${newKeeper}) AS handed`,
        );
        refuseUnless(handed.rows[0]?.handed === true, 'not_found');
        return [event('person_handed_over', { personId, accountId: newKeeper })];
      }),

    addMember: (accountId, request) =>
      write(accountId, async (tx, rows) => {
        if (rows.people.some((row) => row.accountId === request.accountId)) return [];
        // cases_definer stays in its schema (guard 6), so the link is read here, under row-level security.
        refuseUnless(await linked(tx, accountId, request.accountId), 'not_found');
        const personId = 'personId' in request ? request.personId : null;
        const displayName = 'displayName' in request ? request.displayName : null;
        const takenOver = rows.people.find((row) => row.id === personId);
        refuseUnless(
          personId === null || (takenOver?.keptByMe === true && takenOver.accountId === null),
          'not_found',
        );
        refuseUnless(personId !== null || rows.people.length < caseSizeLimits.people, 'case_limit');
        refuseUnless(
          takenOver?.caseMember === true || members(rows) < caseSizeLimits.members,
          'case_limit',
        );
        const joined = await tx.execute<{ outcome: string }>(sql`
          SELECT cases.join_case(${request.accountId}, ${personId}::uuid, ${displayName}::text)
                 AS outcome`);
        const outcome = joined.rows[0]?.outcome;
        if (outcome === 'unchanged') return [];
        refuseUnless(outcome !== 'case_exists', 'case_exists');
        refuseUnless(outcome === 'joined', 'not_found');
        const added = event('member_joined', {
          caseId: rows.caseId,
          accountId: request.accountId,
        });
        return [added, { ...added, subjectAccountId: request.accountId }];
      }),

    writeProfile: (accountId, { personId, facts, dependsOn }) =>
      write(accountId, async (tx, rows) => {
        keptPerson(rows, personId);
        await saveProfile(tx, rows, personId, facts, dependsOn);
        return [];
      }),

    writeFinances: (accountId, { personId, ...finances }) =>
      write(accountId, async (tx, rows) => {
        keptPerson(rows, personId);
        await saveFinances(tx, personId, finances);
        return [];
      }),

    replaceShares: (accountId, { personId, ...wanted }) =>
      write(accountId, async (tx, rows) => {
        keptPerson(rows, personId);
        const others = new Set(
          rows.people
            .filter((row) => row.accountId !== null && row.accountId !== accountId)
            .map((row) => row.accountId),
        );
        const changes: Event[] = [];
        for (const scope of shareScopes) {
          const target = new Set(wanted[scope]);
          refuseUnless(
            [...target].every((id) => others.has(id)),
            'case_invalid',
          );
          const current = new Set(
            rows.shares
              .filter((row) => row.personId === personId && row.scope === scope)
              .map((row) => row.accountId),
          );
          for (const grantee of current) {
            if (target.has(grantee)) continue;
            await tx.execute(sql`
              DELETE FROM cases.share WHERE person_id = ${personId}
                 AND grantee_account_id = ${grantee} AND scope = ${scope}`);
            changes.push(shareEvent('share_revoked', personId, grantee, scope));
          }
          for (const grantee of target) {
            if (current.has(grantee)) continue;
            await tx.execute(sql`
              INSERT INTO cases.share (case_id, person_id, grantee_account_id, scope)
              VALUES (${rows.caseId}, ${personId}, ${grantee}, ${scope})`);
            changes.push(shareEvent('share_granted', personId, grantee, scope));
          }
        }
        return changes;
      }),

    addRelationship: (accountId, relationship) =>
      write(accountId, async (tx, rows) => {
        const ends = rows.people.filter(
          (row) => row.id === relationship.from || row.id === relationship.to,
        );
        refuseUnless(ends.length === 2 && ends.some((row) => row.keptByMe), 'not_found');
        refuseUnless(rows.relationships.length < caseSizeLimits.relationships, 'case_limit');
        refuseUnless(
          validCaseStructure(rows.people, [...rows.relationships, relationship], isoDate(today())),
          'case_invalid',
        );
        await tx.execute(sql`
          INSERT INTO cases.relationship (case_id, kind, from_person_id, to_person_id, details)
          VALUES (${rows.caseId}, ${relationship.kind}, ${relationship.from}, ${relationship.to},
                  ${JSON.stringify(relationship.details)}::jsonb)`);
        return [];
      }),

    removeRelationship: (accountId, relationshipId) =>
      write(accountId, async (tx) => {
        refuseUnless(
          await one(
            tx,
            sql`DELETE FROM cases.relationship WHERE id = ${relationshipId} RETURNING id`,
          ),
          'not_found',
        );
        return [];
      }),

    addAsset: (accountId, { personId, share, asset }) =>
      write(accountId, async (tx) => {
        await insertAsset(tx, personId, share, asset);
        return [];
      }),

    updateAsset: (accountId, { assetId, asset }) =>
      write(accountId, async (tx) => {
        await updateAssetRow(tx, assetId, asset);
        return [];
      }),

    removeAsset: (accountId, assetId) =>
      write(accountId, async (tx) => {
        refuseUnless(
          await one(tx, sql`DELETE FROM cases.asset WHERE id = ${assetId} RETURNING id`),
          'not_found',
        );
        return [];
      }),

    setOwner: (accountId, { assetId, personId, share }) =>
      write(accountId, async (tx) => {
        await setOwnerShare(tx, assetId, personId, share);
        return [];
      }),

    confirmOwner: (accountId, { assetId, personId }) =>
      write(accountId, async (tx) => {
        refuseUnless(
          await one(
            tx,
            sql`
              UPDATE cases.asset_owner SET confirmed = true
               WHERE asset_id = ${assetId} AND person_id = ${personId} RETURNING asset_id`,
          ),
          'not_found',
        );
        return [];
      }),

    removeOwner: (accountId, { assetId, personId }) =>
      write(accountId, async (tx) => {
        await deleteOwnerRow(tx, assetId, personId);
        return [];
      }),

    questions: (accountId) =>
      withIdentity(db(), { accountId }, async (tx) => {
        const rows = await readCase(tx, accountId);
        return rows === undefined ? null : caseQuestions(rows, countries);
      }),

    playback: (accountId) =>
      withIdentity(db(), { accountId }, async (tx) => {
        const rows = await readCase(tx, accountId);
        return rows === undefined ? null : casePlayback(rows, accountId, isoDate(today()));
      }),

    evaluations: async (accountId) => {
      const states = await evaluation.states();
      return withIdentity(db(), { accountId }, async (tx) => {
        const rows = await readCase(tx, accountId);
        return rows === undefined
          ? null
          : caseEvaluations(rows, { ...evaluation, states, today: evaluation.today() });
      });
    },

    reportRule: async (accountId, { routeId, versionNumber, requirementId, reason, note }) => {
      const states = await evaluation.states();
      const reported = await withIdentity(db(), { accountId }, async (tx) => {
        const rows = await readCase(tx, accountId);
        if (rows === undefined) return undefined;
        const evaluated = caseEvaluations(rows, {
          ...evaluation,
          states,
          today: evaluation.today(),
        });
        // Taken from the reporter's own results, so a report names only a requirement they saw.
        const shown = evaluated.results.some(
          (result) =>
            result.routeId === routeId &&
            result.version?.number === versionNumber &&
            result.requirements.some(({ id }) => id === requirementId),
        );
        if (!shown) return undefined;
        const inserted = await tx.execute<{ id: string }>(sql`
          INSERT INTO cases.rule_report
            (case_id, reporter_account_id, route_id, version_number, requirement_id, reason, note)
          VALUES (${rows.caseId}, ${accountId}, ${routeId}, ${versionNumber}, ${requirementId},
                  ${reason}, ${note ?? null})
          RETURNING id`);
        return inserted.rows[0]?.id;
      });
      if (reported === undefined) return 'not_found';
      await recordAll(accountId, [
        event('rule_reported', { reportId: reported, routeId, number: versionNumber }),
      ]);
      return 'reported';
    },

    answerQuestions: (accountId, { personId, answers }) =>
      write(accountId, async (tx, rows) => {
        keptPerson(rows, personId);
        const before = questionState(rows, personId);
        const applied = applyAnswers(before, answers, known);
        refuseUnless(applied.ok, 'case_invalid');
        if (!applied.ok) return [];
        const after = applied.state;
        const answered = new Set(
          answers.flatMap(({ questionId }) =>
            questionFlow.filter(({ id }) => id === questionId).map(({ target }) => target.kind),
          ),
        );
        if (answered.has('fact') || answered.has('marker') || answered.has('dependence')) {
          await saveProfile(tx, rows, personId, after.facts, after.dependsOn);
        }
        if ((answered.has('incomes') || answered.has('assetsMarker')) && after.finances) {
          await saveFinances(tx, personId, after.finances);
        }
        if (answered.has('assets')) await saveHeldAssets(tx, personId, before.assets, after.assets);
        if (answered.has('relationships')) {
          const details = new Map(after.relationships.map((row) => [row.id, row.relationship]));
          const relationships = rows.relationships.map(({ id, ...relationship }) => ({
            id,
            ...(details.get(id) ?? relationship),
          }));
          refuseUnless(
            validCaseStructure(rows.people, relationships, isoDate(today())),
            'case_invalid',
          );
          const stored = new Map(before.relationships.map((row) => [row.id, row.relationship]));
          for (const { id, relationship } of after.relationships) {
            const details = JSON.stringify(relationship.details);
            if (details === JSON.stringify(stored.get(id)?.details)) continue;
            refuseUnless(
              await one(
                tx,
                sql`UPDATE cases.relationship SET details = ${details}::jsonb
                     WHERE id = ${id} RETURNING id`,
              ),
              'not_found',
            );
          }
        }
        return [];
      }),

    async leave(accountId) {
      const caseId = await withIdentity(db(), { accountId }, async (tx) => {
        const found = await memberCase(tx, accountId);
        if (found === undefined) return undefined;
        await lockCase(tx, found);
        await tx.execute(sql`DELETE FROM cases.member WHERE account_id = ${accountId}`);
        return found;
      });
      if (caseId === undefined) return 'not_found';
      await recordAll(accountId, [event('member_left', { caseId })]);
      return 'left';
    },
  };
}

function shareEvent(
  code: 'share_granted' | 'share_revoked',
  personId: string,
  accountId: string,
  scope: ShareScope,
): Event {
  return event(code, { personId, accountId, scope });
}

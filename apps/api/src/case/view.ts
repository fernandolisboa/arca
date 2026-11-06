import type { CaseView } from '@arca/api-contract/routes';
import type { Transaction } from '@arca/db';
import {
  type VisibleCaseRows,
  storedAssetSchema,
  storedFinancesSchema,
  storedProfileFactsSchema,
  storedRelationshipSchema,
} from '@arca/domain';
import { type SQL, sql } from 'drizzle-orm';

/** A person as the viewer sees them, with what only the case's members see. */
export interface CasePersonRow {
  readonly id: string;
  readonly displayName: string;
  readonly caseMember: boolean;
  readonly accountId: string | null;
  readonly keptByMe: boolean;
}

/** Everything of the case the viewer sees, under row-level security (spec 0007, R1). */
export interface CaseRows extends Omit<VisibleCaseRows, 'people' | 'relationships'> {
  readonly caseId: string;
  readonly people: readonly CasePersonRow[];
  readonly relationships: readonly ({
    readonly id: string;
  } & VisibleCaseRows['relationships'][number])[];
  readonly shares: readonly {
    readonly personId: string;
    readonly accountId: string;
    readonly scope: 'profile' | 'finances';
  }[];
}

/** The viewer's case, or undefined outside one. */
export const memberCase = async (tx: Transaction, accountId: string) =>
  (
    await tx.execute<{ case_id: string }>(
      sql`SELECT case_id FROM cases.member WHERE account_id = ${accountId}`,
    )
  ).rows[0]?.case_id;

/** The viewer's case's rows, as the viewer sees them; undefined outside a case. A write passes the case it locked. */
export async function readCase(
  tx: Transaction,
  accountId: string,
  knownCase?: string,
): Promise<CaseRows | undefined> {
  const caseId = knownCase ?? (await memberCase(tx, accountId));
  if (caseId === undefined) return undefined;
  const ofCase = sql`person_id IN (SELECT id FROM cases.person WHERE case_id = ${caseId})`;
  const rows = async <Row>(query: SQL) =>
    (await tx.execute<Record<string, unknown>>(query)).rows as Row[];
  // One after another: a transaction's client runs one query at a time anyway.
  const people = await rows<{
    id: string;
    display_name: string;
    case_member: boolean;
    account_id: string | null;
    kept: boolean;
  }>(sql`
    SELECT id, display_name, case_member, account_id, keeper_account_id = ${accountId} AS kept
      FROM cases.person WHERE case_id = ${caseId} ORDER BY created_at, id`);
  const profiles = await rows<{
    person_id: string;
    facts: unknown;
    dependence_answered: boolean;
  }>(sql`
    SELECT person_id, facts, dependence_answered FROM cases.person_profile WHERE ${ofCase}`);
  const dependence = await rows<{ person_id: string; depends_on_id: string }>(sql`
    SELECT person_id, depends_on_id FROM cases.dependence
     WHERE case_id = ${caseId} ORDER BY person_id, depends_on_id`);
  const finances = await rows<{
    person_id: string;
    incomes: unknown;
    assets_recorded_in_full: boolean;
  }>(sql`
    SELECT person_id, incomes, assets_recorded_in_full FROM cases.person_finances
     WHERE ${ofCase}`);
  const relationships = await rows<{
    id: string;
    kind: string;
    from: string;
    to: string;
    details: unknown;
  }>(sql`
    SELECT id, kind, from_person_id AS from, to_person_id AS to, details
      FROM cases.relationship WHERE case_id = ${caseId} ORDER BY created_at, id`);
  const assets = await rows<{
    id: string;
    kind: string;
    amount: string;
    currency: string;
    valued_at: string;
    liquid: boolean | null;
    sold: string | null;
  }>(sql`
    SELECT id, kind, value_amount::text AS amount, value_currency AS currency,
           valued_at::text AS valued_at, liquid, sold
      FROM cases.asset WHERE case_id = ${caseId} ORDER BY created_at, id`);
  const owners = await rows<{
    asset_id: string;
    person_id: string;
    share: string;
    confirmed: boolean;
  }>(sql`
    SELECT asset_id, person_id, share::text AS share, confirmed FROM cases.asset_owner
     WHERE case_id = ${caseId} ORDER BY created_at, person_id`);
  const shares = await rows<{
    person_id: string;
    grantee_account_id: string;
    scope: 'profile' | 'finances';
  }>(sql`
    SELECT person_id, grantee_account_id, scope FROM cases.share
     WHERE case_id = ${caseId} ORDER BY person_id, scope, grantee_account_id`);
  return {
    caseId,
    people: people.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      caseMember: row.case_member,
      accountId: row.account_id,
      keptByMe: row.kept,
    })),
    profiles: profiles.map((row) => ({
      personId: row.person_id,
      facts: storedProfileFactsSchema.parse(row.facts),
      dependenceAnswered: row.dependence_answered,
    })),
    dependence: dependence.map((row) => ({
      personId: row.person_id,
      dependsOnId: row.depends_on_id,
    })),
    finances: finances.map((row) => ({
      personId: row.person_id,
      ...storedFinancesSchema.parse({
        ...(row.incomes === null ? {} : { incomes: row.incomes }),
        assetsRecordedInFull: row.assets_recorded_in_full,
      }),
    })),
    relationships: relationships.map(({ id, ...edge }) => ({
      id,
      ...storedRelationshipSchema.parse(edge),
    })),
    assets: assets.map((row) => ({
      id: row.id,
      ...storedAssetSchema.parse({
        kind: row.kind,
        value: { amount: Number(row.amount), currency: row.currency },
        valuedAt: row.valued_at,
        ...(row.liquid === null ? {} : { liquid: row.liquid }),
        ...(row.sold === null ? {} : { sold: row.sold }),
      }),
    })),
    owners: owners.map((row) => ({
      assetId: row.asset_id,
      personId: row.person_id,
      share: row.share,
      confirmed: row.confirmed,
    })),
    shares: shares.map((row) => ({
      personId: row.person_id,
      accountId: row.grantee_account_id,
      scope: row.scope,
    })),
  };
}

/** The case as the viewer sees it: what they see, and what they may change (spec 0007, R3). */
export function caseView(rows: CaseRows, accountId: string): CaseView {
  const kept = new Set(rows.people.filter((person) => person.keptByMe).map(({ id }) => id));
  const me = rows.people.find((person) => person.accountId === accountId);
  if (me === undefined) throw new Error("A member's own person is missing from their case");
  const grantees = (personId: string, scope: 'profile' | 'finances') =>
    rows.shares
      .filter((row) => row.personId === personId && row.scope === scope)
      .map((row) => row.accountId);
  return {
    caseId: rows.caseId,
    me: me.id,
    people: rows.people.map((person) => {
      const profile = rows.profiles.find((row) => row.personId === person.id);
      const finances = rows.finances.find((row) => row.personId === person.id);
      return {
        id: person.id,
        displayName: person.displayName,
        caseMember: person.caseMember,
        accountId: person.accountId,
        keptByMe: person.keptByMe,
        profile:
          profile === undefined
            ? null
            : {
                facts: profile.facts,
                dependsOn: profile.dependenceAnswered
                  ? rows.dependence
                      .filter((row) => row.personId === person.id)
                      .map((row) => row.dependsOnId)
                  : null,
              },
        finances:
          finances === undefined
            ? null
            : {
                ...(finances.incomes === undefined ? {} : { incomes: finances.incomes }),
                assetsRecordedInFull: finances.assetsRecordedInFull,
              },
        shares: person.keptByMe
          ? { profile: grantees(person.id, 'profile'), finances: grantees(person.id, 'finances') }
          : null,
      };
    }),
    relationships: rows.relationships.map(({ id, ...relationship }) => ({
      id,
      editable: kept.has(relationship.from) || kept.has(relationship.to),
      relationship,
    })),
    assets: rows.assets.map(({ id, ...asset }) => {
      const owners = rows.owners.filter((owner) => owner.assetId === id);
      return {
        id,
        editable: owners.some((owner) => owner.confirmed && kept.has(owner.personId)),
        asset,
        owners: owners.map(({ personId, share, confirmed }) => ({ personId, share, confirmed })),
      };
    }),
  };
}

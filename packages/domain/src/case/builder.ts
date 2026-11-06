import type { CalendarDate } from '../calendar/calendar-date.js';
import {
  type CaseSnapshot,
  type CompletenessMarker,
  type Relationship,
  caseSnapshotSchema,
} from './snapshot.js';
import type { StoredAsset, StoredFinances, StoredProfile, StoredRelationship } from './storage.js';

/**
 * The case rows one account sees, as row-level security returns them (spec 0007, R1): every
 * person and relationship of the case, and only the profiles, finances, dependence, assets and
 * owner rows it keeps or that were shared with it.
 */
export interface VisibleCaseRows {
  readonly people: readonly { readonly id: string; readonly caseMember: boolean }[];
  readonly profiles: readonly ({ readonly personId: string } & StoredProfile)[];
  readonly dependence: readonly { readonly personId: string; readonly dependsOnId: string }[];
  readonly finances: readonly ({ readonly personId: string } & StoredFinances)[];
  readonly relationships: readonly StoredRelationship[];
  readonly assets: readonly ({ readonly id: string } & StoredAsset)[];
  readonly owners: readonly {
    readonly assetId: string;
    readonly personId: string;
    readonly share: string;
    readonly confirmed: boolean;
  }[];
}

export interface BuiltSnapshot {
  readonly snapshot: CaseSnapshot;
  /** Each person's and asset's opaque ID in the snapshot, by its UUID. */
  readonly personIds: ReadonlyMap<string, string>;
  readonly assetIds: ReadonlyMap<string, string>;
}

/**
 * Builds the engine's snapshot from what the viewer sees, with opaque IDs in place of UUIDs
 * (spec 0007, R3). Dependence is given only when the profile says it was answered; the `assets`
 * marker only with visible finances, which then show every asset the person owns; an asset only
 * with a confirmed owner row the viewer sees, and with only those rows as owners, so the engine
 * counts nothing the viewer cannot see. Throws when the rows break the snapshot's checks.
 */
export function buildCaseSnapshot(rows: VisibleCaseRows, recordedOn: CalendarDate): BuiltSnapshot {
  const personIds = opaqueIds(
    'p',
    rows.people.map(({ id }) => id),
  );
  const personId = (id: string) => mapped(personIds, id);
  const profiles = byPerson(rows.profiles);
  const finances = byPerson(rows.finances);

  const people = rows.people.map(({ id }) => {
    const profile = profiles.get(id);
    const money = finances.get(id);
    const markers: CompletenessMarker[] = [...(profile?.facts.recordedInFull ?? [])];
    if (money?.assetsRecordedInFull === true) markers.push('assets');
    return {
      ...profile?.facts,
      id: personId(id),
      ...(money?.incomes === undefined ? {} : { incomes: money.incomes }),
      ...(profile?.dependenceAnswered === true
        ? {
            financiallyDependentOn: rows.dependence
              .filter((row) => row.personId === id)
              .map((row) => personId(row.dependsOnId)),
          }
        : {}),
      ...(markers.length === 0 ? {} : { recordedInFull: markers }),
    };
  });

  const confirmedOwners = rows.owners.filter((owner) => owner.confirmed);
  const ownedAssets = rows.assets.filter((asset) =>
    confirmedOwners.some((owner) => owner.assetId === asset.id),
  );
  const assetIds = opaqueIds(
    'a',
    ownedAssets.map(({ id }) => id),
  );
  const assets = ownedAssets.map(({ id, ...fields }) => ({
    ...fields,
    id: mapped(assetIds, id),
    owners: confirmedOwners
      .filter((owner) => owner.assetId === id)
      .map((owner) => ({ person: personId(owner.personId), share: owner.share })),
  }));

  const snapshot = caseSnapshotSchema.parse({
    recordedOn,
    members: rows.people.filter((person) => person.caseMember).map(({ id }) => personId(id)),
    people,
    relationships: rows.relationships.map((edge) => snapshotEdge(edge, personId)),
    assets,
  });
  return { snapshot, personIds, assetIds };
}

/**
 * Whether the case's people and relationships pass the snapshot's checks across rows: no parent
 * cycles, at most 4 parents, at most 4 couple edges per pair, no edge twice, and the limits. The
 * API runs it on the case as it would be after a write (spec 0007, R1).
 */
export function validCaseStructure(
  people: VisibleCaseRows['people'],
  relationships: readonly StoredRelationship[],
  recordedOn: CalendarDate,
): boolean {
  const personIds = opaqueIds(
    'p',
    people.map(({ id }) => id),
  );
  if (relationships.some((edge) => !personIds.has(edge.from) || !personIds.has(edge.to))) {
    return false;
  }
  const personId = (id: string) => mapped(personIds, id);
  return caseSnapshotSchema.safeParse({
    recordedOn,
    members: people.filter((person) => person.caseMember).map(({ id }) => personId(id)),
    people: people.map(({ id }) => ({ id: personId(id) })),
    relationships: relationships.map((edge) => snapshotEdge(edge, personId)),
    assets: [],
  }).success;
}

function snapshotEdge(edge: StoredRelationship, personId: (id: string) => string): Relationship {
  if (edge.kind === 'parent') {
    return {
      ...edge.details,
      kind: 'parent',
      parent: personId(edge.from),
      child: personId(edge.to),
    };
  }
  return { ...edge.details, kind: edge.kind, people: [personId(edge.from), personId(edge.to)] };
}

function opaqueIds(prefix: string, ids: readonly string[]): ReadonlyMap<string, string> {
  return new Map(ids.map((id, index) => [id, `${prefix}${String(index + 1)}`]));
}

function mapped(ids: ReadonlyMap<string, string>, id: string): string {
  const opaque = ids.get(id);
  if (opaque === undefined) throw new Error('A row refers to a person or asset not in the case');
  return opaque;
}

function byPerson<Row extends { readonly personId: string }>(
  rows: readonly Row[],
): ReadonlyMap<string, Row> {
  return new Map(rows.map((row) => [row.personId, row]));
}

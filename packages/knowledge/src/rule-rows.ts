import {
  type CatalogEntry,
  type CountrySet,
  type Pin,
  type RouteCatalog,
  type RouteVersion,
  type RuleCaseSummary,
  type VersionIdentity,
  countrySetSchema,
  identityKey,
  officialDomainListSchema,
  officialDomainsKey,
  routeVersionSchema,
  sourceUrls,
  versionIdentity,
} from '@arca/domain';
import { type Json, canonicalize } from './canonical.js';
import { caseSummaries } from './cases.js';
import { createRouteCatalog } from './catalog.js';
import { classificationPins } from './datasets.js';

/** A route version as the `knowledge.route_version` table holds it (ADR-0031). */
export interface RouteVersionRow {
  readonly routeId: string;
  readonly number: number;
  readonly content: Json;
  readonly contentHash: string;
  /** The version's table-driven cases file (spec 0002, R8), if it has one. */
  readonly cases: Json | null;
}

/** A country set or official-domain list as its table holds it (ADR-0031). */
export interface PinnedFileRow {
  readonly id: string;
  readonly number: number;
  readonly content: Json;
  readonly contentHash: string;
  /** The new-route request that proposed an official-domain list; null or absent when imported. */
  readonly requestId?: string | null;
}

/** Every rule row of the `knowledge` schema. */
export interface RuleRows {
  readonly routeVersions: readonly RouteVersionRow[];
  readonly countrySets: readonly PinnedFileRow[];
  readonly officialDomainLists: readonly PinnedFileRow[];
}

/** An official-domain list's hosts. */
export interface OfficialDomainHosts {
  readonly id: string;
  readonly number: number;
  readonly hosts: readonly string[];
}

/** An official-domain list as the read verified it, with its hash and where it came from. */
export interface VerifiedOfficialDomainList extends OfficialDomainHosts {
  readonly hash: string;
  /**
   * Whether a new-route request proposed it, so it counts only once an admin activates it; an
   * imported list passed a reviewed pull request (ADR-0031).
   */
  readonly fromRequest: boolean;
}

/** One version's current cases, without their snapshots, for the activation screen. */
export interface VersionCases {
  readonly hash: string;
  /** The hash of the version's cases file as stored, which a decision binds (ADR-0031). */
  readonly casesHash: string;
  readonly cases: readonly RuleCaseSummary[];
}

/**
 * What the rules read hold: every route version whose content still hashes to its stored hash,
 * with its cases, the host of each cited URL, and the hosts of each official-domain list.
 */
export interface RuleContent {
  readonly entries: ReadonlyMap<string, CatalogEntry>;
  readonly cases: readonly VersionCases[];
  readonly hosts: Readonly<Record<string, string | null>>;
  readonly officialDomains: readonly OfficialDomainHosts[];
  /** `<kind>/<id>/<number>` of every row left out, because it does not hash to its stored hash. */
  readonly refused: readonly string[];
}

declare const ruleDataBrand: unique symbol;

/**
 * The rules read, opaque: every version is in it whatever its decision state, so only the display
 * and reproduction entry points, whose imports lint restricts, and the engine catalog, which hands
 * out full content only for active versions, open it (spec 0002, R5).
 */
export interface RuleData {
  readonly [ruleDataBrand]: true;
}

export const sealRuleData = (content: RuleContent): RuleData => content as unknown as RuleData;

export const ruleContent = (data: RuleData): RuleContent => data as unknown as RuleContent;

export interface RuleRowReading {
  /** The repository's dataset files (countries, former countries, classifications), keyed `<kind>/<id>/<number>`. */
  readonly datasetFiles: Readonly<Record<string, Json>>;
  /** SHA-256 in lowercase hex of a string's UTF-8 bytes. */
  readonly sha256: (text: string) => string;
  /** The host official-source matching reads, as the knowledge build reads it. */
  readonly hostOf: (url: string) => string | undefined;
}

/**
 * The hash of a version's cases file as stored (ADR-0031): its content hash leaves the cases out,
 * so a decision binds this hash too, and the admin approves the cases they read.
 */
export const casesHashOf = (cases: Json | null, reading: Pick<RuleRowReading, 'sha256'>): string =>
  reading.sha256(canonicalize({ cases }));

const keyOf = (kind: string, id: string, number: number): string =>
  `${kind}/${id}/${String(number)}`;

/** The country sets and official-domain lists that hash to their stored hash, and how to pin them. */
interface PinnedFiles {
  readonly refused: string[];
  readonly officialDomains: VerifiedOfficialDomainList[];
  readonly sets: ReadonlyMap<
    string,
    { readonly content: Json; readonly set: CountrySet; readonly pinned: Record<string, Json> }
  >;
  readonly hashOf: (version: Json, pinned: Record<string, Json>) => string;
  readonly commonPins: (data: CountrySet | RouteVersion) => Record<string, Json> | undefined;
  readonly datasetFiles: Readonly<Record<string, Json>>;
}

function readPinnedFiles(rows: RuleRows, reading: RuleRowReading): PinnedFiles {
  const refused: string[] = [];
  const hashOf = (version: Json, pinned: Record<string, Json>): string =>
    reading.sha256(canonicalize({ version, pinned }));

  const lists = new Map<string, Json>();
  const officialDomains: VerifiedOfficialDomainList[] = [];
  for (const row of rows.officialDomainLists) {
    const key = keyOf('official-domains', row.id, row.number);
    const parsed = officialDomainListSchema.safeParse(row.content);
    if (
      !parsed.success ||
      parsed.data.id !== row.id ||
      parsed.data.number !== row.number ||
      hashOf(row.content, {}) !== row.contentHash
    ) {
      refused.push(key);
      continue;
    }
    lists.set(key, row.content);
    officialDomains.push({
      id: row.id,
      number: row.number,
      hosts: parsed.data.hosts.map(({ host }) => host),
      hash: row.contentHash,
      fromRequest: row.requestId !== undefined && row.requestId !== null,
    });
  }

  /** The common pins of a set or a route, or undefined when one is missing or refused. */
  const commonPins = (data: CountrySet | RouteVersion): Record<string, Json> | undefined => {
    const pinned: Record<string, Json> = {};
    const add = (key: string, from: ReadonlyMap<string, Json>): boolean => {
      const content = from.get(key);
      if (content === undefined) return false;
      pinned[key] = content;
      return true;
    };
    const datasets = new Map(Object.entries(reading.datasetFiles));
    const found =
      add(keyOf('countries', data.countries.id, data.countries.number), datasets) &&
      add(
        keyOf('former-countries', data.formerCountries.id, data.formerCountries.number),
        datasets,
      ) &&
      data.officialDomains.every((pin: Pin) =>
        add(keyOf('official-domains', pin.id, pin.number), lists),
      );
    return found ? pinned : undefined;
  };

  const sets = new Map<string, { content: Json; set: CountrySet; pinned: Record<string, Json> }>();
  for (const row of rows.countrySets) {
    const key = keyOf('country-sets', row.id, row.number);
    const parsed = countrySetSchema.safeParse(row.content);
    const pinned = parsed.success ? commonPins(parsed.data) : undefined;
    if (
      !parsed.success ||
      pinned === undefined ||
      parsed.data.id !== row.id ||
      parsed.data.number !== row.number ||
      hashOf(row.content, pinned) !== row.contentHash
    ) {
      refused.push(key);
      continue;
    }
    sets.set(key, { content: row.content, set: parsed.data, pinned });
  }

  return { refused, officialDomains, sets, hashOf, commonPins, datasetFiles: reading.datasetFiles };
}

/** The content hash of an official-domain list, which pins nothing (ADR-0031). */
export const officialDomainListHash = (content: Json, reading: Pick<RuleRowReading, 'sha256'>) =>
  reading.sha256(canonicalize({ version: content, pinned: {} }));

/** The official-domain lists that read: their content parses, names its row and hashes to it. */
export const verifiedOfficialDomainLists = (
  rows: RuleRows,
  reading: RuleRowReading,
): readonly VerifiedOfficialDomainList[] => readPinnedFiles(rows, reading).officialDomains;

/** A pin as `<id>/<number>`, the form a request stores its allowed lists in. */
export const pinKey = ({ id, number }: Pin): string => `${id}/${String(number)}`;

/**
 * The official-domain lists a route may rest on (ADR-0031): those that read and are imported, or
 * that a request proposed and an admin activated; `states` holds the decisions by decided key.
 */
export const approvedOfficialDomainLists = (
  rows: RuleRows,
  reading: RuleRowReading,
  states: ReadonlyMap<string, string>,
): readonly VerifiedOfficialDomainList[] =>
  verifiedOfficialDomainLists(rows, reading).filter(
    ({ id, number, hash, fromRequest }) =>
      !fromRequest || states.get(officialDomainsKey({ listId: id, number, hash })) === 'active',
  );

/**
 * Everything a route version pins, by key, as its hash covers it: the countries files, its
 * official-domain lists and its country sets with what they pin. Undefined when one of them is
 * missing or refused.
 */
function routePins(files: PinnedFiles, version: RouteVersion): Record<string, Json> | undefined {
  const pinned = files.commonPins(version);
  if (pinned === undefined) return undefined;
  for (const { key } of classificationPins(version)) {
    const content = files.datasetFiles[key];
    if (content === undefined) return undefined;
    pinned[key] = content;
  }
  for (const pin of version.countrySets) {
    const key = keyOf('country-sets', pin.id, pin.number);
    const set = files.sets.get(key);
    if (set === undefined) return undefined;
    pinned[key] = set.content;
    Object.assign(pinned, set.pinned);
  }
  return pinned;
}

/** A stored route version as the read verifies it, with the hosts of its official-domain lists. */
export interface VerifiedRouteVersion {
  readonly row: RouteVersionRow;
  readonly version: RouteVersion;
  readonly officialHosts: readonly string[];
}

/**
 * One stored route version, verified as the read verifies it: its content parses, names the ID
 * and number it is stored under and hashes, over everything it pins, to its stored hash.
 * Undefined when the row is missing or refused, so a row changed in place never steers research.
 */
export function verifiedRouteVersion(
  rows: RuleRows,
  routeId: string,
  number: number,
  reading: RuleRowReading,
): VerifiedRouteVersion | undefined {
  const row = rows.routeVersions.find(
    (candidate) => candidate.routeId === routeId && candidate.number === number,
  );
  const parsed = routeVersionSchema.safeParse(row?.content);
  if (
    row === undefined ||
    !parsed.success ||
    parsed.data.routeId !== routeId ||
    parsed.data.number !== number
  ) {
    return undefined;
  }
  const files = readPinnedFiles(rows, reading);
  const pinned = routePins(files, parsed.data);
  if (pinned === undefined || files.hashOf(row.content, pinned) !== row.contentHash) {
    return undefined;
  }
  const lists = new Map(
    files.officialDomains.map(({ id, number: listNumber, hosts }) => [
      keyOf('official-domains', id, listNumber),
      hosts,
    ]),
  );
  const hosts = parsed.data.officialDomains.flatMap(
    (pin) => lists.get(keyOf('official-domains', pin.id, pin.number)) ?? [],
  );
  return { row, version: parsed.data, officialHosts: [...new Set(hosts)] };
}

/**
 * The content hash a new route version would be stored under (spec 0002, R6), over everything it
 * pins among the rows read; undefined when its content does not parse or pins a file the rows
 * lack or refuse. The same hashing the read re-checks, so a row stored with it reads back.
 */
export function routeVersionContentHash(
  rows: RuleRows,
  content: Json,
  reading: RuleRowReading,
): string | undefined {
  const parsed = routeVersionSchema.safeParse(content);
  if (!parsed.success) return undefined;
  const files = readPinnedFiles(rows, reading);
  const pinned = routePins(files, parsed.data);
  return pinned === undefined ? undefined : files.hashOf(content, pinned);
}

/**
 * Reads rule rows as the build read the files they came from (spec 0002, R6; ADR-0031): each row's
 * content is parsed by its schema, must name the ID and number it is stored under, and must hash,
 * over everything it pins, to the hash stored with it. A row that fails any of these, or pins one
 * that does, is refused, so a row changed outside the insert-only grants is never evaluated.
 */
export function ruleDataFromRows(rows: RuleRows, reading: RuleRowReading): RuleData {
  const files = readPinnedFiles(rows, reading);
  const { refused } = files;
  const officialDomains = files.officialDomains.map(({ id, number, hosts }) => ({
    id,
    number,
    hosts,
  }));
  const read: { identity: VersionIdentity; entry: CatalogEntry; cases: Json | null }[] = [];
  const ordered = [...rows.routeVersions].sort(
    (left, right) => left.routeId.localeCompare(right.routeId, 'en') || left.number - right.number,
  );
  for (const row of ordered) {
    const key = keyOf('routes', row.routeId, row.number);
    const parsed = routeVersionSchema.safeParse(row.content);
    const pinned = parsed.success ? routePins(files, parsed.data) : undefined;
    if (
      !parsed.success ||
      pinned === undefined ||
      parsed.data.routeId !== row.routeId ||
      parsed.data.number !== row.number ||
      files.hashOf(row.content, pinned) !== row.contentHash
    ) {
      refused.push(key);
      continue;
    }
    const found = parsed.data.countrySets.flatMap((pin) => {
      const set = files.sets.get(keyOf('country-sets', pin.id, pin.number));
      return set === undefined ? [] : [set];
    });
    const identity = versionIdentity(parsed.data, row.contentHash);
    read.push({
      identity,
      entry: { identity, version: parsed.data, countrySets: found.map(({ set }) => set) },
      cases: row.cases,
    });
  }

  // A route with a refused version is withheld whole, so selection never falls back to a version
  // the refused one superseded or corrected.
  const withheld = new Set(
    refused.filter((key) => key.startsWith('routes/')).map((key) => key.split('/')[1]),
  );
  const entries = new Map<string, CatalogEntry>();
  const cases: VersionCases[] = [];
  const hosts: Record<string, string | null> = {};
  for (const { identity, entry, cases: file } of read) {
    if (withheld.has(identity.routeId)) {
      if (!refused.includes(keyOf('routes', identity.routeId, identity.number))) {
        refused.push(keyOf('routes', identity.routeId, identity.number));
      }
      continue;
    }
    entries.set(identityKey(identity), entry);
    cases.push({
      hash: identity.hash,
      casesHash: casesHashOf(file, reading),
      cases: caseSummaries(file),
    });
    for (const url of entry.version.sources.flatMap(sourceUrls)) {
      hosts[url] = reading.hostOf(url) ?? null;
    }
  }
  return sealRuleData({ entries, cases, hosts, officialDomains, refused });
}

/** The engine's catalog over the rules read, and every route it has a version of, in order. */
export interface RuleEngineData {
  readonly catalog: RouteCatalog;
  readonly routeIds: readonly string[];
}

const engines = new WeakMap<RuleData, RuleEngineData>();

/** The engine's view of the rules read, built once for each reading (spec 0002, R5). */
export function ruleEngineData(data: RuleData): RuleEngineData {
  let engine = engines.get(data);
  if (engine === undefined) {
    const { entries } = ruleContent(data);
    engine = {
      catalog: createRouteCatalog(entries),
      routeIds: [...new Set([...entries.values()].map(({ identity }) => identity.routeId))].sort(),
    };
    engines.set(data, engine);
  }
  return engine;
}

/** The cases hash of the version read under this content hash, if the reading holds one. */
export const versionCasesHash = (data: RuleData, contentHash: string): string | undefined =>
  ruleContent(data).cases.find(({ hash }) => hash === contentHash)?.casesHash;

/** `<kind>/<id>/<number>` of every row the reading left out: public rule identifiers only. */
export const refusedRows = (data: RuleData): readonly string[] => ruleContent(data).refused;

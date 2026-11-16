import {
  type CatalogEntry,
  type CountrySet,
  type Pin,
  type RouteVersion,
  type RuleCaseSummary,
  countrySetSchema,
  identityKey,
  officialDomainListSchema,
  routeVersionSchema,
  sourceUrls,
  versionIdentity,
} from '@arca/domain';
import { type Json, canonicalize } from './canonical.js';
import { caseSummaries } from './cases.js';

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

/** One version's current cases, without their snapshots, for the activation screen. */
export interface VersionCases {
  readonly hash: string;
  readonly cases: readonly RuleCaseSummary[];
}

/**
 * The rules the runtime reads: every route version whose content still hashes to its stored hash,
 * with its cases, the host of each cited URL, and the hosts of each official-domain list.
 */
export interface RuleData {
  readonly entries: ReadonlyMap<string, CatalogEntry>;
  readonly cases: readonly VersionCases[];
  readonly hosts: Readonly<Record<string, string | null>>;
  readonly officialDomains: readonly OfficialDomainHosts[];
  /** `<kind>/<id>/<number>` of every row left out, because it does not hash to its stored hash. */
  readonly refused: readonly string[];
}

export interface RuleRowReading {
  /** The repository's countries and former-countries files, keyed `<kind>/<id>/<number>`. */
  readonly countryFiles: Readonly<Record<string, Json>>;
  /** SHA-256 in lowercase hex of a string's UTF-8 bytes. */
  readonly sha256: (text: string) => string;
  /** The host official-source matching reads, as the knowledge build reads it. */
  readonly hostOf: (url: string) => string | undefined;
}

const keyOf = (kind: string, id: string, number: number): string =>
  `${kind}/${id}/${String(number)}`;

/**
 * Reads rule rows as the build read the files they came from (spec 0002, R6; ADR-0031): each row's
 * content is parsed by its schema, must name the ID and number it is stored under, and must hash,
 * over everything it pins, to the hash stored with it. A row that fails any of these, or pins one
 * that does, is refused, so a row changed outside the insert-only grants is never evaluated.
 */
export function ruleDataFromRows(rows: RuleRows, reading: RuleRowReading): RuleData {
  const refused: string[] = [];
  const hashOf = (version: Json, pinned: Record<string, Json>): string =>
    reading.sha256(canonicalize({ version, pinned }));

  const lists = new Map<string, Json>();
  const officialDomains: OfficialDomainHosts[] = [];
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
    const countries = new Map(Object.entries(reading.countryFiles));
    const found =
      add(keyOf('countries', data.countries.id, data.countries.number), countries) &&
      add(
        keyOf('former-countries', data.formerCountries.id, data.formerCountries.number),
        countries,
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

  const entries = new Map<string, CatalogEntry>();
  const cases: VersionCases[] = [];
  const hosts: Record<string, string | null> = {};
  const ordered = [...rows.routeVersions].sort(
    (left, right) => left.routeId.localeCompare(right.routeId, 'en') || left.number - right.number,
  );
  for (const row of ordered) {
    const key = keyOf('routes', row.routeId, row.number);
    const parsed = routeVersionSchema.safeParse(row.content);
    const pinned = parsed.success ? commonPins(parsed.data) : undefined;
    const pinnedSets = parsed.success
      ? parsed.data.countrySets.map((pin) => sets.get(keyOf('country-sets', pin.id, pin.number)))
      : [];
    if (
      !parsed.success ||
      pinned === undefined ||
      pinnedSets.some((set) => set === undefined) ||
      parsed.data.routeId !== row.routeId ||
      parsed.data.number !== row.number
    ) {
      refused.push(key);
      continue;
    }
    const countrySets: CountrySet[] = [];
    for (const [index, set] of pinnedSets.entries()) {
      const pin = parsed.data.countrySets[index];
      if (set === undefined || pin === undefined) continue;
      pinned[keyOf('country-sets', pin.id, pin.number)] = set.content;
      Object.assign(pinned, set.pinned);
      countrySets.push(set.set);
    }
    if (hashOf(row.content, pinned) !== row.contentHash) {
      refused.push(key);
      continue;
    }
    const identity = versionIdentity(parsed.data, row.contentHash);
    entries.set(identityKey(identity), { identity, version: parsed.data, countrySets });
    cases.push({ hash: row.contentHash, cases: caseSummaries(row.cases) });
    for (const url of parsed.data.sources.flatMap(sourceUrls)) {
      hosts[url] = reading.hostOf(url) ?? null;
    }
  }
  return { entries, cases, hosts, officialDomains, refused };
}

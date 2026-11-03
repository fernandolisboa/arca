import {
  type CalendarDate,
  type CheckIssue,
  type CountrySet,
  type OfficialDomainList,
  type OfficialHosts,
  type Pin,
  type RouteVersion,
  type Source,
  checkCountrySet,
  checkRouteVersion,
  checkVersionOrder,
  compareDates,
  countrySetSchema,
  officialDomainListSchema,
  routeVersionSchema,
} from '@arca/domain';
import type { z } from 'zod';
import { contentHash } from './content-hash.ts';
import {
  type CountriesFile,
  type FormerCountriesFile,
  countriesFileSchema,
  formerCountriesFileSchema,
} from './files.ts';
import type { Json } from './json.ts';
import type { FileKind, Issue, RawData, RawFile } from './load.ts';

/** A route version as the catalog carries it: the reviewed JSON, its hash and its country sets. */
export interface BuiltEntry {
  readonly hash: string;
  readonly version: Json;
  readonly countrySets: readonly Json[];
}

export interface ValidatedData {
  readonly entries: readonly BuiltEntry[];
  /** Content hash by path under `data` without the extension, for route versions and country sets. */
  readonly hashes: ReadonlyMap<string, string>;
  /** Every route version and country set path that would have a hash, valid or not. */
  readonly hashable: ReadonlySet<string>;
  readonly issues: readonly Issue[];
}

type Parsed =
  | { readonly kind: 'countries'; readonly raw: RawFile; readonly data: CountriesFile }
  | { readonly kind: 'former-countries'; readonly raw: RawFile; readonly data: FormerCountriesFile }
  | { readonly kind: 'official-domains'; readonly raw: RawFile; readonly data: OfficialDomainList }
  | { readonly kind: 'country-sets'; readonly raw: RawFile; readonly data: CountrySet }
  | { readonly kind: 'routes'; readonly raw: RawFile; readonly data: RouteVersion };

type ParsedOf<K extends FileKind> = Extract<Parsed, { kind: K }>;

const schemas: { readonly [K in FileKind]: z.ZodType<ParsedOf<K>['data']> } = {
  countries: countriesFileSchema,
  'former-countries': formerCountriesFileSchema,
  'official-domains': officialDomainListSchema,
  'country-sets': countrySetSchema,
  routes: routeVersionSchema,
};

/**
 * Validates every knowledge file against spec 0002 (R4, R6, R7) and hashes each route version and
 * country set over everything it pins. A file with issues gets no hash and no entry.
 */
export function validateData(raw: RawData, buildDate: CalendarDate): ValidatedData {
  return new Validation(raw, buildDate).run();
}

class Validation {
  private readonly issues: Issue[];
  private readonly parsed = new Map<string, Parsed>();
  private readonly failed = new Set<string>();
  private readonly raw: RawData;
  private readonly buildDate: CalendarDate;

  constructor(raw: RawData, buildDate: CalendarDate) {
    this.raw = raw;
    this.buildDate = buildDate;
    this.issues = [...raw.issues];
  }

  run(): ValidatedData {
    for (const file of this.raw.files) this.parse(file);
    this.checkNumbering();
    const hashes = new Map<string, string>();
    for (const file of this.parsed.values()) {
      if (file.kind === 'official-domains') this.checkHostSources(file);
      if (file.kind === 'former-countries')
        this.checkVerified(file.raw, file.data.sources, '/sources');
      if (file.kind === 'countries' || file.kind === 'former-countries') {
        this.checkUnique(file.raw, file.data.codes, '/codes');
      }
    }
    for (const file of this.parsed.values()) {
      if (file.kind === 'country-sets') this.checkCountrySet(file);
    }
    for (const file of this.parsed.values()) {
      if (file.kind === 'routes') this.checkRoute(file);
    }
    this.checkRouteOrder();
    const entries: BuiltEntry[] = [];
    for (const file of this.parsed.values()) {
      if (file.kind !== 'country-sets' && file.kind !== 'routes') continue;
      if (this.failed.has(file.raw.file)) continue;
      const hash = contentHash({ version: file.raw.json, pinned: this.pinnedContent(file) });
      hashes.set(withoutExtension(file.raw.file), hash);
      if (file.kind === 'routes') {
        entries.push({
          hash,
          version: file.raw.json,
          countrySets: file.data.countrySets.map(
            (pin) => this.require('country-sets', pin).raw.json,
          ),
        });
      }
    }
    const hashable = new Set(
      this.raw.files
        .filter((file) => file.kind === 'country-sets' || file.kind === 'routes')
        .map((file) => withoutExtension(file.file)),
    );
    return { entries, hashes, hashable, issues: this.issues };
  }

  private parse(file: RawFile): void {
    const result = schemas[file.kind].safeParse(file.json);
    if (!result.success) {
      for (const problem of result.error.issues) {
        this.report(file, problem.message, `/${problem.path.map(String).join('/')}`);
      }
      return;
    }
    const data = result.data;
    const id = 'routeId' in data ? data.routeId : data.id;
    if (id !== file.id || data.number !== file.number) {
      this.report(file, 'The ID and number match the file path');
      return;
    }
    this.parsed.set(keyOf(file.kind, file.id, file.number), {
      kind: file.kind,
      raw: file,
      data,
    } as Parsed);
  }

  private checkNumbering(): void {
    const numbers = new Map<string, RawFile[]>();
    for (const file of this.raw.files) {
      const series = `${file.kind}/${file.id}`;
      numbers.set(series, [...(numbers.get(series) ?? []), file]);
    }
    for (const files of numbers.values()) {
      const sorted = files.map((file) => file.number).sort((left, right) => left - right);
      if (sorted.every((number, index) => number === index + 1)) continue;
      for (const file of files) this.report(file, 'Version numbers are contiguous from 1');
    }
  }

  private checkHostSources(file: ParsedOf<'official-domains'>): void {
    this.checkUnique(
      file.raw,
      file.data.hosts.map((entry) => entry.host),
      '/hosts',
    );
    file.data.hosts.forEach((entry, index) => {
      this.checkVerified(file.raw, [entry.source], `/hosts/${String(index)}/source`);
    });
  }

  private checkCountrySet(file: ParsedOf<'country-sets'>): void {
    const { data, raw } = file;
    this.checkVerified(raw, data.sources, '/sources');
    const countries = this.resolve(raw, 'countries', data.countries, '/countries');
    const former = this.resolve(raw, 'former-countries', data.formerCountries, '/formerCountries');
    const official = this.officialHosts(raw, data.officialDomains);
    if (official !== undefined) this.reportChecks(raw, checkCountrySet(data, official));
    this.checkUnique(raw, data.members, '/members');
    if (countries !== undefined && former !== undefined) {
      const known = new Set([...countries.data.codes, ...former.data.codes]);
      data.members.forEach((member, index) => {
        if (!known.has(member)) {
          this.report(
            raw,
            'A member is in the pinned countries or former countries',
            `/members/${String(index)}`,
          );
        }
      });
    }
  }

  private checkRoute(file: ParsedOf<'routes'>): void {
    const { data, raw } = file;
    this.checkVerified(raw, data.sources, '/sources');
    const countries = this.resolve(raw, 'countries', data.countries, '/countries');
    this.resolve(raw, 'former-countries', data.formerCountries, '/formerCountries');
    data.countrySets.forEach((pin, index) => {
      this.resolve(raw, 'country-sets', pin, `/countrySets/${String(index)}`);
    });
    const official = this.officialHosts(raw, data.officialDomains);
    if (official !== undefined) this.reportChecks(raw, checkRouteVersion(data, official));
    if (countries !== undefined && !countries.data.codes.includes(data.country)) {
      this.report(raw, 'The country is in the pinned countries file', '/country');
    }
  }

  private checkRouteOrder(): void {
    const routes = new Map<string, ParsedOf<'routes'>[]>();
    for (const file of this.parsed.values()) {
      if (file.kind === 'routes')
        routes.set(file.raw.id, [...(routes.get(file.raw.id) ?? []), file]);
    }
    for (const [routeId, files] of routes) {
      const all = this.raw.files.filter((file) => file.kind === 'routes' && file.id === routeId);
      if (all.length !== files.length) continue;
      const problems = checkVersionOrder(files.map((file) => file.data));
      for (const file of files) {
        for (const message of problems.get(file.data.number) ?? []) this.report(file.raw, message);
      }
    }
  }

  private officialHosts(file: RawFile, pins: readonly Pin[]): OfficialHosts | undefined {
    const lists = pins.map((pin, index) =>
      this.resolve(file, 'official-domains', pin, `/officialDomains/${String(index)}`),
    );
    if (lists.some((list) => list === undefined)) return undefined;
    return {
      hosts: lists.flatMap((list) => list?.data.hosts.map((entry) => entry.host) ?? []),
      hostOf,
    };
  }

  private checkUnique(file: RawFile, values: readonly string[], path: string): void {
    if (new Set(values).size !== values.length) this.report(file, 'Entries are unique', path);
  }

  private checkVerified(file: RawFile, sources: readonly Source[], path: string): void {
    sources.forEach((source, index) => {
      if (compareDates(source.verifiedAt, this.buildDate) > 0) {
        this.report(
          file,
          'A source is not verified after the build date',
          `${path}/${String(index)}/verifiedAt`,
        );
      }
    });
  }

  private resolve<K extends FileKind>(
    file: RawFile,
    kind: K,
    pin: Pin,
    path: string,
  ): ParsedOf<K> | undefined {
    const target = this.parsed.get(keyOf(kind, pin.id, pin.number));
    if (target === undefined || this.failed.has(target.raw.file)) {
      this.report(
        file,
        `The pinned ${kind} file ${pin.id} ${String(pin.number)} exists and is valid`,
        path,
      );
      return undefined;
    }
    return target as ParsedOf<K>;
  }

  /** Every file the version pins, transitively, keyed `<kind>/<id>/<number>` (spec 0002, R6). */
  private pinnedContent(file: ParsedOf<'country-sets'> | ParsedOf<'routes'>): Record<string, Json> {
    const pinned: Record<string, Json> = {};
    const add = (kind: FileKind, pin: Pin): Parsed => {
      const target = this.require(kind, pin);
      pinned[keyOf(kind, pin.id, pin.number)] = target.raw.json;
      return target;
    };
    const addCommon = (data: CountrySet | RouteVersion): void => {
      add('countries', data.countries);
      add('former-countries', data.formerCountries);
      for (const pin of data.officialDomains) add('official-domains', pin);
    };
    addCommon(file.data);
    if (file.kind === 'routes') {
      for (const pin of file.data.countrySets) {
        const set = add('country-sets', pin) as ParsedOf<'country-sets'>;
        addCommon(set.data);
      }
    }
    return pinned;
  }

  /** A pin of a file without issues: validation has already resolved it. */
  private require<K extends FileKind>(kind: K, pin: Pin): ParsedOf<K> {
    const target = this.parsed.get(keyOf(kind, pin.id, pin.number));
    if (target === undefined) throw new Error(`Unresolved ${kind} pin after validation`);
    return target as ParsedOf<K>;
  }

  private reportChecks(file: RawFile, checks: readonly CheckIssue[]): void {
    for (const check of checks) this.report(file, check.message, check.path);
  }

  private report(file: RawFile, message: string, path?: string): void {
    this.failed.add(file.file);
    this.issues.push(
      path === undefined ? { file: file.file, message } : { file: file.file, path, message },
    );
  }
}

function keyOf(kind: FileKind, id: string, number: number): string {
  return `${kind}/${id}/${String(number)}`;
}

function withoutExtension(file: string): string {
  return file.replace(/\.json$/, '');
}

/**
 * The URL as written: `https://`, then a host with no user information, port, backslash, extra
 * slash, percent-encoding or full-width dot, which WHATWG parsing would otherwise forgive or map. The host a
 * reviewer reads is then the host matched, up to case and punycode.
 */
const plainAuthority = /^https:\/\/[^/?#\\@:%\s\u3002\uff0e\uff61]+(?:[/?#]|$)/;

/**
 * The host official-source matching reads (spec 0002, R4): WHATWG URL parsing lowercases the host
 * and converts it to ASCII (punycode). Anything but `https` without user information or an explicit
 * port has no host to match.
 */
export function hostOf(url: string): string | undefined {
  if (!URL.canParse(url)) return undefined;
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    !plainAuthority.test(url)
  ) {
    return undefined;
  }
  return parsed.hostname;
}

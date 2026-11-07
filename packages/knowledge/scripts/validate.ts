import {
  type CalendarDate,
  type CheckIssue,
  type ComparisonVersion,
  type CountryGuide,
  type CountryIndicator,
  type CountrySet,
  type OfficialDomainList,
  type OfficialHosts,
  type Pin,
  type RouteVersion,
  type Source,
  checkComparisonVersion,
  checkCountryGuide,
  checkCountryIndicator,
  checkCountrySet,
  checkRouteVersion,
  checkVersionOrder,
  compareDates,
  comparisonSeriesId,
  comparisonVersionSchema,
  countryGuideSchema,
  countryIndicatorSchema,
  countrySetSchema,
  officialDomainListSchema,
  routeVersionSchema,
} from '@arca/domain';
import { hostOf } from '@arca/scripts/host';
import type { z } from 'zod';
import { contentHash } from './content-hash.ts';
import {
  type CountriesFile,
  type FormerCountriesFile,
  countriesFileSchema,
  formerCountriesFileSchema,
} from './files.ts';
import type { Json } from '@arca/scripts/json';
import type { FileKind, Issue, RawData, RawFile } from './load.ts';

/** A route version as the catalog carries it: the reviewed JSON, its hash and its country sets. */
export interface BuiltEntry {
  readonly hash: string;
  readonly version: Json;
  readonly countrySets: readonly Json[];
}

/** A comparison version as the catalog carries it, with exactly the indicators it pins. */
export interface BuiltComparison {
  readonly hash: string;
  readonly version: Json;
  readonly indicators: readonly Json[];
}

/** An official-domain list's hosts, which the independent check fetches on (ADR-0027). */
export interface BuiltOfficialDomains {
  readonly id: string;
  readonly number: number;
  readonly hosts: readonly string[];
}

/** A country guide as the catalog carries it: the reviewed JSON and its hash (ADR-0027). */
export interface BuiltGuide {
  readonly hash: string;
  readonly guide: Json;
}

export interface ValidatedData {
  readonly entries: readonly BuiltEntry[];
  readonly comparisons: readonly BuiltComparison[];
  readonly guides: readonly BuiltGuide[];
  readonly officialDomains: readonly BuiltOfficialDomains[];
  /** Content hash of each valid hashed file, by path without the extension. */
  readonly hashes: ReadonlyMap<string, string>;
  /** Every path of a hashed kind, valid or not. */
  readonly hashable: ReadonlySet<string>;
  /** The latest countries and former countries, which the guided questions offer (spec 0007, R4). */
  readonly countries: PinnedCountries;
  readonly issues: readonly Issue[];
}

export interface PinnedCountries {
  readonly countries: readonly string[];
  readonly formerCountries: readonly string[];
}

type Parsed =
  | { readonly kind: 'countries'; readonly raw: RawFile; readonly data: CountriesFile }
  | { readonly kind: 'former-countries'; readonly raw: RawFile; readonly data: FormerCountriesFile }
  | { readonly kind: 'official-domains'; readonly raw: RawFile; readonly data: OfficialDomainList }
  | { readonly kind: 'country-sets'; readonly raw: RawFile; readonly data: CountrySet }
  | { readonly kind: 'routes'; readonly raw: RawFile; readonly data: RouteVersion }
  | { readonly kind: 'indicators'; readonly raw: RawFile; readonly data: CountryIndicator }
  | { readonly kind: 'comparisons'; readonly raw: RawFile; readonly data: ComparisonVersion }
  | { readonly kind: 'guides'; readonly raw: RawFile; readonly data: CountryGuide };

type ParsedOf<K extends FileKind> = Extract<Parsed, { kind: K }>;

const schemas: { readonly [K in FileKind]: z.ZodType<ParsedOf<K>['data']> } = {
  countries: countriesFileSchema,
  'former-countries': formerCountriesFileSchema,
  'official-domains': officialDomainListSchema,
  'country-sets': countrySetSchema,
  routes: routeVersionSchema,
  indicators: countryIndicatorSchema,
  comparisons: comparisonVersionSchema,
  guides: countryGuideSchema,
};

/** The kinds that get a content hash, recorded in `hashes.json`. */
const hashedKinds: ReadonlySet<FileKind> = new Set([
  'country-sets',
  'routes',
  'indicators',
  'comparisons',
  'guides',
]);

export interface ValidationOptions {
  /** Accept the user-assigned codes fixtures use (`QM` to `QZ`, except `QO` and `QU`). */
  readonly fixtures?: boolean;
}

/** User-assigned ISO 3166 codes reserved for fixtures (spec 0002, R7), except `QO` (CLDR) and `QU`. */
const fixtureCode = /^Q[MNPQRSTVWXYZ]/;

/**
 * Validates every knowledge file against spec 0002 (R4, R6, R7) and hashes each route version and
 * country set over everything it pins. A file with issues gets no hash and no entry.
 */
export function validateData(
  raw: RawData,
  buildDate: CalendarDate,
  options: ValidationOptions = {},
): ValidatedData {
  return new Validation(raw, buildDate, options.fixtures ?? false).run();
}

class Validation {
  private readonly issues: Issue[];
  private readonly parsed = new Map<string, Parsed>();
  private readonly failed = new Set<string>();
  private readonly raw: RawData;
  private readonly buildDate: CalendarDate;
  private readonly fixtures: boolean;

  constructor(raw: RawData, buildDate: CalendarDate, fixtures: boolean) {
    this.raw = raw;
    this.buildDate = buildDate;
    this.fixtures = fixtures;
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
        if (!this.fixtures && file.data.codes.some((code) => fixtureCode.test(code))) {
          this.report(file.raw, 'User-assigned codes are for fixtures only', '/codes');
        }
      }
    }
    for (const file of this.parsed.values()) {
      if (file.kind === 'country-sets') this.checkCountrySet(file);
    }
    for (const file of this.parsed.values()) {
      if (file.kind === 'routes') this.checkRoute(file);
      if (file.kind === 'indicators') this.checkIndicator(file);
      if (file.kind === 'guides') this.checkGuide(file);
    }
    for (const file of this.parsed.values()) {
      if (file.kind === 'comparisons') this.checkComparison(file);
    }
    this.checkRouteOrder();
    const entries: BuiltEntry[] = [];
    const comparisons: BuiltComparison[] = [];
    const guides: BuiltGuide[] = [];
    for (const file of this.parsed.values()) {
      if (!hashedKinds.has(file.kind)) continue;
      if (this.failed.has(file.raw.file)) continue;
      const hash = contentHash({ version: file.raw.json, pinned: this.pinnedContent(file) });
      hashes.set(withoutExtension(file.raw.file), hash);
      if (file.kind === 'guides') guides.push({ hash, guide: file.raw.json });
      if (file.kind === 'comparisons') {
        comparisons.push({
          hash,
          version: file.raw.json,
          indicators: file.data.indicators.map((pin) => this.require('indicators', pin).raw.json),
        });
      }
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
        .filter((file) => hashedKinds.has(file.kind))
        .map((file) => withoutExtension(file.file)),
    );
    const officialDomains = [...this.parsed.values()].flatMap((file) =>
      file.kind === 'official-domains' && !this.failed.has(file.raw.file)
        ? [
            {
              id: file.data.id,
              number: file.data.number,
              hosts: file.data.hosts.map((h) => h.host),
            },
          ]
        : [],
    );
    return {
      entries,
      comparisons,
      guides,
      officialDomains,
      hashes,
      hashable,
      countries: this.latestCountries(),
      issues: this.issues,
    };
  }

  private latestCountries(): PinnedCountries {
    const latest = (kind: 'countries' | 'former-countries') =>
      [...this.parsed.values()]
        .flatMap((file) =>
          (file.kind === 'countries' || file.kind === 'former-countries') &&
          file.kind === kind &&
          !this.failed.has(file.raw.file)
            ? [file]
            : [],
        )
        .sort((left, right) => right.raw.number - left.raw.number)[0]?.data.codes ?? [];
    return { countries: latest('countries'), formerCountries: latest('former-countries') };
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
    const former = this.resolve(raw, 'former-countries', data.formerCountries, '/formerCountries');
    const current = new Set(countries?.data.codes ?? []);
    const formerCodes = new Set(former?.data.codes ?? []);
    const setsWithFormer = new Set<string>();
    data.countrySets.forEach((pin, index) => {
      const path = `/countrySets/${String(index)}`;
      const set = this.resolve(raw, 'country-sets', pin, path);
      const outside = set?.data.members.filter((member) => !current.has(member)) ?? [];
      if (outside.length > 0) setsWithFormer.add(pin.id);
      if (countries !== undefined && former !== undefined) {
        if (outside.some((member) => !formerCodes.has(member))) {
          this.report(
            raw,
            "A set's members are in the route's countries or former countries",
            path,
          );
        }
      }
    });
    const known = { current, former: formerCodes, setsWithFormer };
    const official = this.officialHosts(raw, data.officialDomains);
    if (official !== undefined) this.reportChecks(raw, checkRouteVersion(data, official, known));
    if (countries !== undefined && !countries.data.codes.includes(data.country)) {
      this.report(raw, 'The country is in the pinned countries file', '/country');
    }
  }

  private checkIndicator(file: ParsedOf<'indicators'>): void {
    const { data, raw } = file;
    this.checkVerified(raw, data.sources, '/sources');
    const buildYear = Number(this.buildDate.slice(0, 4));
    data.values.forEach((value, index) => {
      if (value.year > buildYear) {
        this.report(
          raw,
          'A value is not from after the build year',
          `/values/${String(index)}/year`,
        );
      }
    });
    const countries = this.resolve(raw, 'countries', data.countries, '/countries');
    const official = this.officialHosts(raw, data.officialDomains);
    if (countries === undefined || official === undefined) return;
    this.reportChecks(raw, checkCountryIndicator(data, official, new Set(countries.data.codes)));
  }

  private checkGuide(file: ParsedOf<'guides'>): void {
    const { data, raw } = file;
    this.checkVerified(raw, data.laws, '/laws');
    const countries = this.resolve(raw, 'countries', data.countries, '/countries');
    const official = this.officialHosts(raw, data.officialDomains);
    if (countries === undefined || official === undefined) return;
    this.reportChecks(raw, checkCountryGuide(data, official, new Set(countries.data.codes)));
  }

  private checkComparison(file: ParsedOf<'comparisons'>): void {
    const { data, raw } = file;
    if (data.id !== comparisonSeriesId) {
      this.report(raw, `There is one comparison series, ${comparisonSeriesId}`);
    }
    const resolved = data.indicators.map((pin, index) =>
      this.resolve(raw, 'indicators', pin, `/indicators/${String(index)}`),
    );
    const indicators = new Map<string, CountryIndicator>();
    for (const indicator of resolved) {
      if (indicator === undefined) return;
      indicators.set(indicator.data.id, indicator.data);
    }
    this.reportChecks(raw, checkComparisonVersion(data, indicators));
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

  private checkVerified(
    file: RawFile,
    sources: readonly Pick<Source, 'verifiedAt'>[],
    path: string,
  ): void {
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
  private pinnedContent(file: Parsed): Record<string, Json> {
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
    const addCountriesAndLists = (data: CountryIndicator | CountryGuide): void => {
      add('countries', data.countries);
      for (const pin of data.officialDomains) add('official-domains', pin);
    };
    if (file.kind === 'country-sets' || file.kind === 'routes') addCommon(file.data);
    if (file.kind === 'routes') {
      for (const pin of file.data.countrySets) {
        const set = add('country-sets', pin) as ParsedOf<'country-sets'>;
        addCommon(set.data);
      }
    }
    if (file.kind === 'indicators' || file.kind === 'guides') addCountriesAndLists(file.data);
    if (file.kind === 'comparisons') {
      for (const pin of file.data.indicators) {
        const indicator = add('indicators', pin) as ParsedOf<'indicators'>;
        addCountriesAndLists(indicator.data);
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

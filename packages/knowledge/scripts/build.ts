import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CalendarDate,
  compareDates,
  maxKnowledgeJsonDepth,
  parseCalendarDate,
  sourceUrls,
  departureChecklistsSchema,
  documentGuidesSchema,
  suggestedRatingsSchema,
} from '@arca/domain';
import { hostOf } from '@arca/scripts/host';
import { parseJsonSubset } from '@arca/scripts/json';
import type { Json } from '../src/canonical.ts';
import { parseComparisons, parseEntries } from '../src/entries.ts';
import { caseSummaries } from '../src/cases.ts';
import {
  type RuleTextFile,
  ruleTextFileSchema,
  ruleTextLocale,
  shipRuleTexts,
} from '../src/rule-texts.ts';
import type { RuleRows, VersionCases } from '../src/rule-rows.ts';
import { contentHash } from './content-hash.ts';
import { checkHashes } from './hashes.ts';
import { type FileKind, type Issue, type RawData, loadData, readKnowledgeFile } from './load.ts';
import {
  type BuiltComparison,
  type BuiltEntry,
  type BuiltOfficialDomains,
  type PinnedCountries,
  type ValidationOptions,
  validateData,
} from './validate.ts';

/** What the generated catalog module carries. */
export interface CatalogParts {
  readonly entries: readonly BuiltEntry[];
  readonly comparisons: readonly BuiltComparison[];
  readonly officialDomains: readonly BuiltOfficialDomains[];
  readonly countries: PinnedCountries;
  readonly cases: readonly VersionCases[];
  /**
   * The countries, former-countries, occupations and study-fields files, keyed
   * `<kind>/<id>/<number>` as a hash pins them.
   */
  readonly datasetFiles: Readonly<Record<string, Json>>;
  /** The rows the import writes to the database (ADR-0031). */
  readonly rows: RuleRows;
  /** The highest-numbered suggested ratings file (ADR-0035), or null when there is none. */
  readonly suggestedRatings?: Json | null;
  /** The highest-numbered departure checklists file (ADR-0038), or null when there is none. */
  readonly departureChecklists?: Json | null;
  /** The highest-numbered document guides file (ADR-0039), or null when there is none. */
  readonly documentGuides?: Json | null;
  /** Every route's texts in the screen's language, as the API ships them (ADR-0037). */
  readonly ruleTexts?: Json;
}

export interface KnowledgeBuild extends CatalogParts {
  readonly issues: readonly Issue[];
}

/** The repository's datasets, which route versions pin and which stay in the repository (ADR-0031). */
const datasetKinds: ReadonlySet<FileKind> = new Set([
  'countries',
  'former-countries',
  'occupations',
  'study-fields',
]);

const casesPath = /^routes\/([a-z0-9-]+\/[1-9][0-9]*)\.cases\.json$/;

/** Each version's cases file as read, by the version's path under `data` without the extension. */
async function casesFiles(dataDir: string, raw: RawData): Promise<Map<string, Json>> {
  const files = new Map<string, Json>();
  for (const file of raw.cases) {
    const version = casesPath.exec(file)?.[1];
    if (version === undefined) continue;
    try {
      files.set(
        `routes/${version}`,
        parseJsonSubset(await readKnowledgeFile(join(dataDir, file)), maxKnowledgeJsonDepth),
      );
    } catch {
      continue;
    }
  }
  return files;
}

/** The current cases of each version, summarized, as the runtime reads them from a row. */
function versionCases(
  files: ReadonlyMap<string, Json>,
  hashes: ReadonlyMap<string, string>,
): VersionCases[] {
  const cases: VersionCases[] = [];
  for (const [version, file] of files) {
    const hash = hashes.get(version);
    if (hash !== undefined) {
      // The digest `casesHashOf` computes, which the build cannot import at run time.
      const casesHash = contentHash({ cases: file });
      cases.push({ hash, casesHash, cases: caseSummaries(file) });
    }
  }
  return cases;
}

/** Loads, validates and hashes the data directory (spec 0002, R6). Any issue fails the build. */
export async function buildKnowledge(
  dataDir: string,
  buildDate: CalendarDate,
  options: ValidationOptions = {},
): Promise<KnowledgeBuild> {
  const raw = await loadData(dataDir);
  const validated = validateData(raw, buildDate, options);
  const casesByVersion = await casesFiles(dataDir, raw);
  const valid = (kind: FileKind) =>
    raw.files.flatMap((file) => {
      const hash = validated.hashes.get(file.file.replace(/\.json$/, ''));
      return file.kind === kind && hash !== undefined ? [{ ...file, hash }] : [];
    });
  const validLists = new Set(
    validated.officialDomains.map(({ id, number }) => `${id}/${String(number)}`),
  );
  return {
    entries: validated.entries,
    comparisons: validated.comparisons,
    officialDomains: validated.officialDomains,
    countries: validated.countries,
    cases: versionCases(casesByVersion, validated.hashes),
    datasetFiles: Object.fromEntries(
      raw.files
        .filter(({ kind }) => datasetKinds.has(kind))
        .map(({ kind, id, number, json }) => [`${kind}/${id}/${String(number)}`, json]),
    ),
    rows: {
      routeVersions: valid('routes').map(({ file, id, number, json, hash }) => ({
        routeId: id,
        number,
        content: json,
        contentHash: hash,
        cases: casesByVersion.get(file.replace(/\.json$/, '')) ?? null,
      })),
      countrySets: valid('country-sets').map(({ id, number, json, hash }) => ({
        id,
        number,
        content: json,
        contentHash: hash,
      })),
      officialDomainLists: raw.files
        .filter(
          ({ kind, id, number }) =>
            kind === 'official-domains' && validLists.has(`${id}/${String(number)}`),
        )
        .map(({ id, number, json }) => ({
          id,
          number,
          content: json,
          contentHash: contentHash({ version: json, pinned: {} }),
        })),
    },
    issues: [...validated.issues, ...checkHashes(raw.hashes, validated.hashes, validated.hashable)],
  };
}

/**
 * The host of every URL as official-source matching reads it, or null for one with none, so the
 * activation screen names the same host the build matched.
 */
function hostsOf(urls: readonly string[]): Record<string, string | null> {
  return Object.fromEntries(urls.map((url) => [url, hostOf(url) ?? null] as const));
}

const exportedJson = (name: string, value: unknown): string =>
  `export const ${name}: unknown = JSON.parse(${JSON.stringify(JSON.stringify(value))});`;

const generatedNote =
  '// Generated by scripts/build.ts from data/. Do not edit; it is not checked in.';

/**
 * The route module: every route version with its country sets, its cases, the hosts of its cited
 * URLs, and the official-domain lists. Only the bundled entry reads it, for tests and tools; the API
 * reads rules from the database (ADR-0031). The data goes through JSON.parse rather than an object
 * literal, so a `__proto__` key stays data, and the entry validates it again before use.
 */
export function catalogModule({
  entries,
  cases = [],
  officialDomains = [],
}: Pick<CatalogParts, 'entries'> & Partial<CatalogParts>): string {
  const urls = [...parseEntries(entries).values()].flatMap(({ version }) =>
    version.sources.flatMap(sourceUrls),
  );
  return [
    generatedNote,
    exportedJson('catalogData', entries),
    exportedJson('caseData', cases),
    exportedJson('hostData', hostsOf(urls)),
    exportedJson('officialDomainData', officialDomains),
    '',
  ].join('\n');
}

/**
 * The runtime module, which the API ships: the pinned countries, the dataset files a route
 * version's hash covers, and the comparison versions with the hosts of their sources.
 */
export function runtimeModule({
  countries = { countries: [], formerCountries: [] },
  datasetFiles = {},
  comparisons = [],
  suggestedRatings = null,
  departureChecklists = null,
  documentGuides = null,
  ruleTexts = [],
}: Partial<CatalogParts>): string {
  const urls = [...parseComparisons(comparisons).values()].flatMap(({ indicators }) =>
    indicators.flatMap((indicator) => indicator.sources.flatMap(sourceUrls)),
  );
  return [
    generatedNote,
    exportedJson('countryData', countries),
    exportedJson('datasetFileData', datasetFiles),
    exportedJson('comparisonData', comparisons),
    exportedJson('comparisonHostData', hostsOf(urls)),
    exportedJson('suggestedRatingData', suggestedRatings),
    exportedJson('departureChecklistData', departureChecklists),
    exportedJson('documentGuideData', documentGuides),
    exportedJson('ruleTextData', ruleTexts),
    '',
  ].join('\n');
}

/**
 * The highest-numbered file in `dir`, named `<number>.json`, checked against its schema and its own
 * number; null when the directory holds none.
 */
async function readLatestNumbered(
  dir: string,
  schema: { parse: (json: Json) => { number: number } },
): Promise<Json | null> {
  const names = await readdir(dir).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  const numbers = names
    .flatMap((name) => /^([1-9][0-9]*)\.json$/.exec(name)?.[1] ?? [])
    .map(Number)
    .sort((a, b) => b - a);
  const [latest] = numbers;
  if (latest === undefined) return null;
  const file = join(dir, `${String(latest)}.json`);
  const json = parseJsonSubset(await readKnowledgeFile(file), maxKnowledgeJsonDepth);
  const { number } = schema.parse(json);
  if (number !== latest) {
    throw new Error(`${file} carries number ${String(number)}`);
  }
  return json;
}

/** The highest-numbered suggested ratings file in `dir` (ADR-0035), or null. */
export const readSuggestedRatings = (dir: string) =>
  readLatestNumbered(dir, suggestedRatingsSchema);

/**
 * The highest-numbered file in `dir` of official sources (ADR-0038), or null; a source verified
 * after `today` fails the build, as route sources do.
 */
async function readLatestSourced(
  dir: string,
  schema: { parse: (json: Json) => { number: number; sources: readonly SourceDate[] } },
  name: string,
  today: CalendarDate,
): Promise<Json | null> {
  const json = await readLatestNumbered(dir, schema);
  if (json === null) return null;
  const late = schema
    .parse(json)
    .sources.filter(({ verifiedAt }) => compareDates(verifiedAt, today) > 0);
  if (late.length > 0) {
    throw new Error(
      `${name} sources verified after ${today}: ${late.map(({ id }) => id).join(', ')}`,
    );
  }
  return json;
}

interface SourceDate {
  readonly id: string;
  readonly verifiedAt: CalendarDate;
}

/** The highest-numbered departure checklists file in `dir` (ADR-0038), or null. */
export const readDepartureChecklists = (dir: string, today: CalendarDate = todayUtc()) =>
  readLatestSourced(dir, departureChecklistsSchema, 'departure checklist', today);

/** The highest-numbered document guides file in `dir` (ADR-0039), or null. */
export const readDocumentGuides = (dir: string, today: CalendarDate = todayUtc()) =>
  readLatestSourced(dir, documentGuidesSchema, 'document guide', today);

/**
 * Every route's texts in `dir` (ADR-0037), one `<route-id>.json` a route, each checked against its
 * schema, its file name and for a title written twice; none when the directory is missing.
 */
export async function readRuleTexts(dir: string): Promise<RuleTextFile[]> {
  const names = await readdir(dir).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  const files: RuleTextFile[] = [];
  for (const name of names.sort()) {
    const routeId = /^([a-z0-9-]+)\.json$/.exec(name)?.[1];
    if (routeId === undefined) throw new Error(`rule-texts: ${name} is not <route-id>.json`);
    const json = parseJsonSubset(await readKnowledgeFile(join(dir, name)), maxKnowledgeJsonDepth);
    const parsed = ruleTextFileSchema.parse(json);
    if (parsed.routeId !== routeId) {
      throw new Error(`rule-texts: ${name} carries route ${parsed.routeId}`);
    }
    const english = new Set<string>();
    for (const { en } of parsed.texts) {
      if (english.has(en)) throw new Error(`rule-texts: ${name} translates "${en}" twice`);
      english.add(en);
    }
    files.push(parsed);
  }
  return files;
}

export function formatIssue(issue: Issue): string {
  return `${issue.file}${issue.path === undefined ? '' : ` ${issue.path}`}: ${issue.message}`;
}

/** Today's date in UTC: the build date of the real catalog. */
export function todayUtc(): CalendarDate {
  return parseCalendarDate(new Date().toISOString().slice(0, 10));
}

async function main(): Promise<void> {
  const packageDir = fileURLToPath(new URL('..', import.meta.url));
  const today = todayUtc();
  const generated = join(packageDir, 'src', 'generated');
  const targets = {
    catalog: join(generated, 'catalog.ts'),
    runtime: join(generated, 'runtime.ts'),
  };
  // Removed first, so a failed or crashed build leaves no earlier catalog for tools outside Turbo.
  await Promise.all(Object.values(targets).map((target) => rm(target, { force: true })));
  const { issues, ...parts } = await buildKnowledge(join(packageDir, 'data'), today);
  if (issues.length > 0) {
    process.stderr.write(`${issues.map(formatIssue).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  await mkdir(generated, { recursive: true });
  await writeFile(targets.catalog, catalogModule(parts));
  const [suggestedRatings, departureChecklists, documentGuides, ruleTextFiles] = await Promise.all([
    readSuggestedRatings(join(packageDir, 'suggested-ratings')),
    readDepartureChecklists(join(packageDir, 'departure-checklists'), today),
    readDocumentGuides(join(packageDir, 'document-guides'), today),
    readRuleTexts(join(packageDir, 'rule-texts', ruleTextLocale)),
  ]);
  const ruleTexts = shipRuleTexts(ruleTextFiles, (text) =>
    createHash('sha256').update(text, 'utf8').digest('hex'),
  );
  await writeFile(
    targets.runtime,
    runtimeModule({ ...parts, suggestedRatings, departureChecklists, documentGuides, ruleTexts }),
  );
  process.stdout.write(
    `Knowledge catalog: ${String(parts.entries.length)} route versions, ${String(parts.comparisons.length)} comparison versions\n`,
  );
}

if (import.meta.main) await main();

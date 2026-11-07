import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CalendarDate,
  type CountryIndicator,
  countryIndicatorSchema,
  roundQuotientHalfEven,
} from '@arca/domain';
import { z } from 'zod';
import { todayUtc } from './build.ts';

/** The World Bank indicators the destination comparison reads (ADR-0026), by indicator file ID. */
export const worldBankIndicators = [
  { id: 'homicides', code: 'VC.IHR.PSRC.P5', unit: 'per 100,000 people' },
  { id: 'price-level', code: 'PA.NUS.PRVT.PLI', unit: 'index, United States = 100' },
  { id: 'health-coverage', code: 'SH_UHC_SCI', unit: 'index from 0 to 100' },
] as const;

export type WorldBankIndicator = (typeof worldBankIndicators)[number];

const officialList = 'worldbank';

const rowSchema = z.object({
  indicator: z.object({ id: z.string(), value: z.string().min(1).max(160) }),
  country: z.object({ id: z.string() }),
  date: z.string().regex(/^\d{4}$/),
  value: z.number().nonnegative().nullable(),
});

/** The API's answer: a page header, then the rows (absent when nothing matched). */
export const worldBankResponseSchema = z.tuple([
  z.object({ pages: z.number() }),
  z.array(rowSchema).nullable().optional(),
]);

export type WorldBankRow = z.infer<typeof rowSchema>;

/**
 * A value as a decimal string rounded half-even to two places, from the shortest decimal that
 * reads back as the API's number, so no binary floating-point digits leak into the data.
 */
export function twoPlaces(value: number): string {
  const text = String(value);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (match === null) throw new RangeError(`Not a plain non-negative decimal: ${text}`);
  const [, whole = '0', fraction = ''] = match;
  const units = BigInt(`${whole}${fraction}`);
  const hundredths =
    fraction.length <= 2
      ? units * 10n ** BigInt(2 - fraction.length)
      : roundQuotientHalfEven(units, 10n ** BigInt(fraction.length - 2));
  const integer = hundredths / 100n;
  const cents = (hundredths % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return cents === '' ? String(integer) : `${String(integer)}.${cents}`;
}

export interface IndicatorInput {
  readonly indicator: WorldBankIndicator;
  readonly number: number;
  readonly countriesNumber: number;
  readonly listNumber: number;
  readonly countries: readonly string[];
  readonly rows: readonly WorldBankRow[];
  readonly verifiedAt: CalendarDate;
}

/**
 * The next indicator file from the API's most recent non-empty value per country. A country with
 * no value is left out, so it reads as unknown, never as zero.
 */
export function indicatorFile(input: IndicatorInput): CountryIndicator {
  const { indicator, countries, rows } = input;
  const wanted = new Set(countries);
  const kept = rows.filter((row) => row.value !== null && wanted.has(row.country.id));
  const [first] = kept;
  if (first === undefined) throw new RangeError(`${indicator.code} has no values`);
  if (kept.some((row) => row.indicator.id !== indicator.code)) {
    throw new RangeError(`${indicator.code} answered with another indicator`);
  }
  if (new Set(kept.map((row) => row.country.id)).size !== kept.length) {
    throw new RangeError(`${indicator.code} has two values for one country`);
  }
  return countryIndicatorSchema.parse({
    schemaVersion: 1,
    id: indicator.id,
    number: input.number,
    title: first.indicator.value,
    unit: indicator.unit,
    valueType: 'decimal',
    sources: [
      {
        id: 'wdi',
        url: `https://data.worldbank.org/indicator/${indicator.code}`,
        title: `World Bank, World Development Indicators: ${first.indicator.value} (${indicator.code})`,
        kind: 'official',
        verifiedAt: input.verifiedAt,
      },
    ],
    values: kept
      .map((row) => ({
        country: row.country.id,
        value: twoPlaces(row.value ?? 0),
        year: Number(row.date),
        source: 'wdi',
      }))
      .sort((left, right) => (left.country < right.country ? -1 : 1)),
    countries: { id: 'countries', number: input.countriesNumber },
    officialDomains: [{ id: officialList, number: input.listNumber }],
  });
}

async function numbersIn(dir: string): Promise<number[]> {
  try {
    return (await readdir(dir)).flatMap((name) => {
      const match = /^([1-9]\d*)\.json$/.exec(name);
      return match?.[1] === undefined ? [] : [Number(match[1])];
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function latest(dir: string): Promise<number> {
  const numbers = await numbersIn(dir);
  if (numbers.length === 0) throw new Error(`No numbered file in ${dir}`);
  return Math.max(...numbers);
}

/** Every country that has a route version in the data. */
async function routeCountries(dataDir: string): Promise<string[]> {
  const routesDir = join(dataDir, 'routes');
  const countries = new Set<string>();
  for (const route of await readdir(routesDir)) {
    for (const number of await numbersIn(join(routesDir, route))) {
      const file = join(routesDir, route, `${String(number)}.json`);
      const { country } = z
        .object({ country: z.string() })
        .parse(JSON.parse(await readFile(file, 'utf8')));
      countries.add(country);
    }
  }
  return [...countries].sort();
}

async function fetchRows(code: string, countries: readonly string[]): Promise<WorldBankRow[]> {
  const url = new URL(
    `https://api.worldbank.org/v2/country/${countries.join(';')}/indicator/${code}`,
  );
  url.search = new URLSearchParams({ format: 'json', mrnev: '1', per_page: '1000' }).toString();
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${code}: HTTP ${String(response.status)}`);
  const [header, rows] = worldBankResponseSchema.parse(await response.json());
  if (header.pages > 1) throw new Error(`${code}: more than one page`);
  return rows ?? [];
}

/**
 * Writes the next file of each World Bank indicator for every country with a route, for review
 * (ADR-0026). Run by a maintainer, never in CI; a new comparison version then pins the files.
 */
async function main(): Promise<void> {
  const dataDir = fileURLToPath(new URL('../data', import.meta.url));
  const countries = await routeCountries(dataDir);
  const countriesNumber = await latest(join(dataDir, 'countries'));
  const listNumber = await latest(join(dataDir, 'official-domains', officialList));
  const verifiedAt = todayUtc();
  for (const indicator of worldBankIndicators) {
    const dir = join(dataDir, 'indicators', indicator.id);
    const number = Math.max(0, ...(await numbersIn(dir))) + 1;
    const rows = await fetchRows(indicator.code, countries);
    const file = indicatorFile({
      indicator,
      number,
      countriesNumber,
      listNumber,
      countries,
      rows,
      verifiedAt,
    });
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${String(number)}.json`);
    await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, { flag: 'wx' });
    const missing = countries.filter((code) => !file.values.some((v) => v.country === code));
    process.stdout.write(
      `Wrote indicators/${indicator.id}/${String(number)}.json` +
        (missing.length > 0 ? ` (no value: ${missing.join(', ')})` : '') +
        '\n',
    );
  }
  process.stdout.write(
    'Next: a comparison version pinning these files, then `pnpm catalog` and the printed hashes.\n',
  );
}

if (import.meta.main) await main();

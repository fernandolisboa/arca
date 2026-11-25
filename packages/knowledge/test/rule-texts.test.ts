import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readRuleTexts, todayUtc } from '../scripts/build.ts';
import { createRuleTexts, ruleTextLocale, shipRuleTexts } from '../src/rule-texts.ts';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const textsDir = join(packageDir, 'rule-texts', ruleTextLocale);

interface Titled {
  readonly title: string;
}

interface Version {
  readonly routeId: string;
  readonly number: number;
  readonly effectiveFrom: string;
  readonly title: string;
  readonly requirements: readonly Titled[];
  readonly assessments: readonly Titled[];
  readonly costs: readonly Titled[];
  readonly durations: readonly Titled[];
  readonly documents?: readonly (Titled & { readonly note?: string })[];
}

const versionFile = /^(?:[a-z0-9-]+\.)?[1-9][0-9]*\.json$/;

async function versionsIn(dir: string): Promise<Version[]> {
  const names = (await readdir(dir)).filter((name) => versionFile.test(name));
  return Promise.all(
    names.map(async (name) => JSON.parse(await readFile(join(dir, name), 'utf8')) as Version),
  );
}

/** Every route version in the repository: the imported files and every session review's. */
async function repositoryVersions(): Promise<Version[]> {
  const routes = join(packageDir, 'data', 'routes');
  const reviews = join(packageDir, 'reviews');
  const dirs = [
    ...(await readdir(routes)).map((route) => join(routes, route)),
    ...(await readdir(reviews)).map((review) => join(reviews, review)),
  ];
  return (await Promise.all(dirs.map(versionsIn))).flat();
}

/**
 * The titles the screens show for a version: its own, each item's, and each document's title and
 * note.
 */
const titlesOf = (version: Version) => [
  version.title,
  ...[...version.requirements, ...version.assessments, ...version.costs, ...version.durations].map(
    ({ title }) => title,
  ),
  ...(version.documents ?? []).flatMap(({ title, note }) =>
    note === undefined ? [title] : [title, note],
  ),
];

/**
 * The versions the screen can show from today on: of each effective date, the highest number
 * (a correction replaces what it corrects), from the date in effect today onward.
 */
function shownFromToday(versions: readonly Version[], today: string): Version[] {
  const byRoute = Map.groupBy(versions, ({ routeId }) => routeId);
  return [...byRoute.values()].flatMap((route) => {
    const heads = [...Map.groupBy(route, ({ effectiveFrom }) => effectiveFrom).values()].map(
      (sameDate) => sameDate.reduce((high, each) => (each.number > high.number ? each : high)),
    );
    const inEffect = heads
      .filter(({ effectiveFrom }) => effectiveFrom <= today)
      .reduce<string | undefined>(
        (latest, { effectiveFrom }) =>
          latest === undefined || effectiveFrom > latest ? effectiveFrom : latest,
        undefined,
      );
    return heads.filter(({ effectiveFrom }) => effectiveFrom >= (inEffect ?? ''));
  });
}

/** The digits a text states, thousands and decimal separators dropped: "EUR 818.80" is 81880. */
const numbersIn = (text: string): readonly string[] =>
  text.replaceAll(/(?<=\d)[.,](?=\d)/gu, '').match(/\d+/gu) ?? [];

describe('rule texts (ADR-0037)', async () => {
  const files = await readRuleTexts(textsDir);
  const versions = await repositoryVersions();
  const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
  // As the API reads them: shipped by the hash of their English, never the English itself.
  const translate = createRuleTexts(shipRuleTexts(files, sha256), sha256);

  it('translates every title of the versions shown from today on', () => {
    const missing = shownFromToday(versions, todayUtc()).flatMap((version) =>
      titlesOf(version)
        .filter((title) => translate(version.routeId, title) === undefined)
        .map((title) => `${version.routeId} ${String(version.number)}: ${title}`),
    );
    expect(missing).toEqual([]);
  });

  it('translates only titles some version of the route writes', () => {
    const written = new Set(
      versions.flatMap((version) =>
        titlesOf(version).map((title) => `${version.routeId}\u0000${title}`),
      ),
    );
    const unused = files.flatMap(({ routeId, texts }) =>
      texts
        .filter(({ en }) => !written.has(`${routeId}\u0000${en}`))
        .map(({ en }) => `${routeId}: ${en}`),
    );
    expect(unused).toEqual([]);
  });

  it('keeps the numbers of the English title in its translation, and adds none', () => {
    const changed = files.flatMap(({ routeId, texts }) =>
      texts
        .filter(({ en, text }) => {
          const english = numbersIn(en);
          const translated = numbersIn(text);
          return (
            english.some((number) => !translated.includes(number)) ||
            translated.some((number) => !english.includes(number))
          );
        })
        .map(({ en }) => `${routeId}: ${en}`),
    );
    expect(changed).toEqual([]);
  });

  it('shows a title it has no translation for as missing, never as another route’s', () => {
    const [first] = files;
    expect(first).toBeDefined();
    if (first === undefined) return;
    const [entry] = first.texts;
    expect(translate(first.routeId, entry?.en ?? '')).toBe(entry?.text);
    expect(translate('qm-other', entry?.en ?? '')).toBeUndefined();
    expect(translate(first.routeId, 'Not a title')).toBeUndefined();
  });
});

describe('readRuleTexts', () => {
  const file = (routeId: string, texts: readonly { en: string; text: string }[]) =>
    JSON.stringify({ schemaVersion: 1, routeId, texts });

  it('refuses a file named after another route', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rule-texts-'));
    await writeFile(join(dir, 'qm-one.json'), file('qm-two', [{ en: 'A', text: 'Um' }]));
    await expect(readRuleTexts(dir)).rejects.toThrow(/carries route qm-two/);
  });

  it('refuses a title translated twice', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rule-texts-'));
    await writeFile(
      join(dir, 'qm-one.json'),
      file('qm-one', [
        { en: 'A', text: 'Um' },
        { en: 'A', text: 'Uma' },
      ]),
    );
    await expect(readRuleTexts(dir)).rejects.toThrow(/twice/);
  });

  it('is empty without the directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rule-texts-'));
    expect(await readRuleTexts(join(dir, 'missing'))).toEqual([]);
  });
});

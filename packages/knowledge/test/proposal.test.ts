import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type RouteVersion, documentItemSchema, routeVersionSchema } from '@arca/domain';
import { hostOf } from '@arca/scripts/host';
import { describe, expect, it } from 'vitest';
import { importBuild } from '../scripts/rule-import.ts';
import { casesFileSchema } from '../src/cases.ts';
import type { Json } from '../src/canonical.ts';
import { checkProposal, documentListProblems } from '../src/proposal.ts';
import { officialDomainListHash, routeVersionContentHash } from '../src/rule-rows.ts';

const dataDir = join(fileURLToPath(new URL('..', import.meta.url)), 'data');
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** The newest version of a route whose cases all carry inline snapshots, as a proposal's must. */
async function setUp() {
  const { rows, datasetFiles, issues } = await importBuild(dataDir);
  expect(issues).toEqual([]);
  const newest = new Map<string, (typeof rows.routeVersions)[number]>();
  for (const row of rows.routeVersions) {
    if ((newest.get(row.routeId)?.number ?? 0) < row.number) newest.set(row.routeId, row);
  }
  const row = [...newest.values()].find((candidate) => {
    const cases = casesFileSchema.safeParse(candidate.cases);
    const parsed = routeVersionSchema.safeParse(candidate.content);
    return (
      cases.success &&
      parsed.success &&
      parsed.data.status === 'open' &&
      cases.data.cases.every(
        (ruleCase) => ruleCase.snapshot !== undefined && ruleCase.supersedes === undefined,
      )
    );
  });
  if (row === undefined) throw new Error('A route with inline cases expected');
  const base = routeVersionSchema.parse(row.content);
  const later = new Date(`${base.effectiveFrom}T00:00:00Z`);
  later.setUTCDate(later.getUTCDate() + 1);
  const next = (change: Partial<RouteVersion> = {}): Json =>
    ({
      // A proposal corrects nothing: it starts after every version of the route.
      ...Object.fromEntries(Object.entries(base).filter(([key]) => key !== 'corrects')),
      number: base.number + 1,
      effectiveFrom: later.toISOString().slice(0, 10),
      ...change,
    }) as unknown as Json;
  const reading = { datasetFiles, sha256, hostOf };
  const check = (content: Json, cases: unknown = row.cases) =>
    checkProposal(rows, { kind: 'update', base }, content, cases, reading);
  return { rows, row, base, next, reading, check };
}

// Building the knowledge is slow on a busy CI runner.
describe('checkProposal (ADR-0031)', { timeout: 120_000 }, () => {
  it('takes the next version of a route with passing cases, hashed as the read re-checks it', async () => {
    const { rows, next, reading, check } = await setUp();
    const result = await check(next());
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.hash).toBe(routeVersionContentHash(rows, next(), reading));
    expect(result.entry.identity.number).toBe(result.entry.version.number);
  });

  it('takes a version that pins the classifications, hashed with their files', async () => {
    const { rows, next, reading, check } = await setUp();
    const pinned = next({
      occupations: { id: 'occupations', number: 1 },
      studyFields: { id: 'study-fields', number: 1 },
    });
    const result = await check(pinned);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.hash).toBe(routeVersionContentHash(rows, pinned, reading));
    expect(result.hash).not.toBe(routeVersionContentHash(rows, next(), reading));
  });

  it('takes a version with a document list, read back from its row as written', async () => {
    const { base, rows, next, reading, check } = await setUp();
    const official = base.sources.find((source) => source.kind === 'official');
    if (official === undefined) throw new Error('An official source expected');
    const documents = documentItemSchema.array().parse([
      {
        id: 'passport',
        title: 'Valid passport',
        kind: 'passport',
        appliesTo: 'principal',
        apostille: false,
        translation: 'none',
        validity: 'P6M',
        note: 'Synthetic note',
        sources: [official.id],
      },
    ]);
    const listed = next({ documents });
    const result = await check(listed);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.entry.version.documents).toEqual(documents);
    // No list and an empty list are different contents, so different versions.
    const hashes = [next(), next({ documents: [] }), listed].map((content) =>
      routeVersionContentHash(rows, content, reading),
    );
    expect(new Set(hashes).size).toBe(3);
    const empty = await check(next({ documents: [] }));
    expect(empty.ok && empty.entry.version.documents).toEqual([]);
    const absent = await check(next());
    expect(absent.ok && absent.entry.version.documents).toBeUndefined();
  });

  it.each<[string, (setup: Awaited<ReturnType<typeof setUp>>) => Json, RegExp]>([
    [
      'a document citing no source',
      ({ next }) =>
        next({
          documents: [
            {
              id: 'passport',
              title: 'Valid passport',
              kind: 'passport',
              appliesTo: 'principal',
              apostille: false,
              translation: 'none',
              sources: [],
            },
          ],
        }),
      /^\/documents\/0\/sources/,
    ],
    [
      'a document citing a source the version does not hold',
      ({ next }) =>
        next({
          documents: [
            {
              id: 'passport',
              title: 'Valid passport',
              kind: 'passport',
              appliesTo: 'principal',
              apostille: false,
              translation: 'none',
              sources: ['no-such-source'],
            },
          ],
        }),
      /^\/documents\/0\/sources/,
    ],
    [
      'a pin to a classification file that does not exist',
      ({ next }) => next({ occupations: { id: 'occupations', number: 2 } }),
      /pinned file is missing/,
    ],
    [
      'a number that is not the next',
      ({ base, next }) => next({ number: base.number + 2 }),
      /^\/number/,
    ],
    ['another route', ({ next }) => next({ routeId: 'zz-other' }), /^\/routeId/],
    [
      'wider official-domain lists',
      ({ base, next }) =>
        next({ officialDomains: [...base.officialDomains, { id: 'xx', number: 1 }] }),
      /officialDomains/,
    ],
    ['content outside the schema', ({ next }) => next({ title: '' }), /^\/title/],
    [
      'a version that starts no later than the one it updates',
      ({ base, next }) => next({ effectiveFrom: base.effectiveFrom }),
      /^\/effectiveFrom/,
    ],
  ])('refuses %s', async (_, content, problem) => {
    const setup = await setUp();
    const result = await setup.check(content(setup));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.some((line) => problem.test(line))).toBe(true);
  });

  it('refuses a proposal whose own cases contradict it', async () => {
    const { row, next, check } = await setUp();
    const file = casesFileSchema.parse(row.cases);
    const [first, ...rest] = file.cases;
    if (first === undefined) throw new Error('A case expected');
    const wrong = first.expected.status === 'not_eligible' ? 'eligible' : 'not_eligible';
    const result = await check(next(), {
      ...file,
      cases: [{ ...first, expected: { ...first.expected, status: wrong } }, ...rest],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.some((line) => line.startsWith(`cases ${first.id}: status`))).toBe(true);
  });
});

describe('checkProposal for a new route (ADR-0031, #461)', () => {
  /** The base version as the first version of a new route of its country. */
  async function setUpNew() {
    const setup = await setUp();
    const { base, rows, reading } = setup;
    const routeId = `${base.country.toLowerCase()}-new-entry`;
    const first = (change: Partial<RouteVersion> = {}): Json =>
      ({
        ...Object.fromEntries(Object.entries(base).filter(([key]) => key !== 'corrects')),
        routeId,
        number: 1,
        ...change,
      }) as unknown as Json;
    /** A first list holding every host the base's lists hold, as a new country's would. */
    const hosts = base.officialDomains.flatMap((pin) => {
      const row = rows.officialDomainLists.find(
        ({ id, number }) => id === pin.id && number === pin.number,
      );
      return (row?.content as { hosts?: Json[] } | undefined)?.hosts ?? [];
    });
    const listContent = {
      schemaVersion: 1,
      id: 'zz-first',
      number: 1,
      issuer: 'A synthetic issuer',
      hosts,
    } as unknown as Json;
    const list = {
      id: 'zz-first',
      number: 1,
      content: listContent,
      contentHash: officialDomainListHash(listContent, reading),
    };
    const checkNew = (
      content: Json,
      target: { pins?: RouteVersion['officialDomains']; list?: typeof list } = {},
    ) =>
      checkProposal(
        rows,
        {
          kind: 'new',
          country: base.country,
          pins: target.pins ?? base.officialDomains,
          ...(target.list === undefined ? {} : { list: target.list }),
        },
        content,
        setup.row.cases,
        reading,
      );
    return { ...setup, routeId, first, list, checkNew };
  }

  it("takes the first version of a new route on its country's approved lists", async () => {
    const { first, checkNew, routeId } = await setUpNew();
    const result = await checkNew(first());
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.entry.identity.routeId).toBe(routeId);
  });

  it('takes a new country whose version pins the first list the proposal holds', async () => {
    const { first, checkNew, list } = await setUpNew();
    const pinned = first({ officialDomains: [{ id: list.id, number: list.number }] });
    expect(await checkNew(pinned, { pins: [], list })).toMatchObject({ ok: true });
    // The proposed list must be pinned, so research cannot leave it out and cite nothing.
    const result = await checkNew(first(), { pins: [], list });
    expect(result.ok).toBe(false);
  });

  it.each<[string, (setup: Awaited<ReturnType<typeof setUpNew>>) => Json, RegExp]>([
    [
      'a route that already exists',
      ({ base, first }) => first({ routeId: base.routeId }),
      /^\/routeId/,
    ],
    ['an ID of another country', ({ first }) => first({ routeId: 'zz-new-entry' }), /^\/routeId/],
    ['a number other than 1', ({ first }) => first({ number: 2 }), /^\/number/],
    [
      'a list the request does not allow',
      ({ base, first }) =>
        first({ officialDomains: [...base.officialDomains, { id: 'xx', number: 1 }] }),
      /officialDomains/,
    ],
  ])('refuses %s', async (_, content, problem) => {
    const setup = await setUpNew();
    const result = await setup.checkNew(content(setup));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.some((line) => problem.test(line))).toBe(true);
  });
});

describe('documentListProblems (spec #519)', () => {
  const passport = {
    id: 'passport',
    title: 'Valid passport',
    kind: 'passport',
    appliesTo: 'principal',
    apostille: false,
    translation: 'none',
    sources: ['law'],
  };
  const reordered = Object.fromEntries(Object.entries(passport).reverse());
  const base = (documents?: readonly object[]) =>
    ({ ...(documents === undefined ? {} : { documents }) }) as RouteVersion;
  const update = (documents?: readonly object[]) => ({
    kind: 'update' as const,
    base: base(documents),
  });
  const newRoute = { kind: 'new' as const, country: 'QM', pins: [] };

  it.each<[string, Parameters<typeof documentListProblems>[0], object, number]>([
    ['keeps no list', update(), {}, 0],
    ['keeps an empty list', update([]), { documents: [] }, 0],
    ['keeps the same list in another key order', update([passport]), { documents: [reordered] }, 0],
    ['adds a list', update(), { documents: [passport] }, 1],
    ['drops a list', update([passport]), {}, 1],
    ['empties a list', update([passport]), { documents: [] }, 1],
    ['changes an item', update([passport]), { documents: [{ ...passport, apostille: true }] }, 1],
    ['gives a new route no list', newRoute, {}, 0],
    ['gives a new route a list', newRoute, { documents: [] }, 1],
  ])('in an update request that %s', (_, target, content, count) => {
    expect(documentListProblems(target, content as RouteVersion)).toHaveLength(count);
  });
});

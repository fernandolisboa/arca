import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type RouteVersion, routeVersionSchema } from '@arca/domain';
import { hostOf } from '@arca/scripts/host';
import { describe, expect, it } from 'vitest';
import { buildKnowledge } from '../scripts/build.ts';
import { importDate } from '../scripts/rule-import.ts';
import { casesFileSchema } from '../src/cases.ts';
import type { Json } from '../src/canonical.ts';
import { checkProposal } from '../src/proposal.ts';
import { routeVersionContentHash } from '../src/rule-rows.ts';

const dataDir = join(fileURLToPath(new URL('..', import.meta.url)), 'data');
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** The newest version of a route whose cases all carry inline snapshots, as a proposal's must. */
async function setUp() {
  const { rows, countryFiles, issues } = await buildKnowledge(dataDir, importDate);
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
  const reading = { countryFiles, sha256, hostOf };
  const check = (content: Json, cases: unknown = row.cases) =>
    checkProposal(rows, base, content, cases, reading);
  return { rows, row, base, next, reading, check };
}

describe('checkProposal (ADR-0031)', () => {
  it('takes the next version of a route with passing cases, hashed as the read re-checks it', async () => {
    const { rows, next, reading, check } = await setUp();
    const result = await check(next());
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.hash).toBe(routeVersionContentHash(rows, next(), reading));
    expect(result.entry.identity.number).toBe(result.entry.version.number);
  });

  it.each<[string, (setup: Awaited<ReturnType<typeof setUp>>) => Json, RegExp]>([
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

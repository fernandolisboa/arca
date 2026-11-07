import { comparisonIdentityKey } from '@arca/domain';
import { describe, expect, it } from 'vitest';
import { buildKnowledge, catalogModule, formatIssue } from '../scripts/build.ts';
import { createComparisonCatalog } from '../src/comparisons.ts';
import { parseComparisons } from '../src/entries.ts';
import {
  buildDate,
  comparisonFile,
  comparisonTree,
  fixtures,
  indicatorFile,
  writeTree,
} from './data.ts';

const dualIndicator = indicatorFile({
  id: 'dual',
  title: 'Dual citizenship',
  unit: 'policy',
  valueType: 'token',
  values: [
    { country: 'QM', value: 'allowed', year: 2024, source: 'stats' },
    { country: 'QN', value: 'restricted', year: 2024, source: 'stats' },
  ],
});

async function build(tree: Record<string, unknown>, hashes?: unknown) {
  return buildKnowledge(await writeTree(tree, hashes), buildDate, fixtures);
}

async function issuesOf(tree: Record<string, unknown>): Promise<string[]> {
  return (await build(tree)).issues.map(formatIssue);
}

describe('comparison data (ADR-0026)', () => {
  it('builds a comparison version with exactly the indicators it pins', async () => {
    const { comparisons, issues } = await build(comparisonTree());
    expect(issues).toEqual([]);
    expect(comparisons).toHaveLength(1);
    expect(comparisons[0]?.indicators).toEqual([indicatorFile()]);
  });

  it('records a hash for every indicator and comparison version', async () => {
    const { issues } = await build(comparisonTree(), {
      schemaVersion: 1,
      vectors: [],
      files: [],
    });
    const messages = issues.map(formatIssue);
    expect(messages).toContainEqual(
      expect.stringMatching(/^hashes\.json: indicators\/homicides\/1 has no recorded hash/),
    );
    expect(messages).toContainEqual(
      expect.stringMatching(/^hashes\.json: comparisons\/destinations\/1 has no recorded hash/),
    );
  });

  it('hashes a comparison version over the indicator values it pins', async () => {
    const changed = comparisonTree();
    changed['indicators/homicides/1.json'] = indicatorFile({
      values: [{ country: 'QM', value: '1.6', year: 2024, source: 'stats' }],
    });
    const [before, after] = await Promise.all([build(comparisonTree()), build(changed)]);
    expect(before.comparisons[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(after.comparisons[0]?.hash).not.toBe(before.comparisons[0]?.hash);
  });

  it('hashes a comparison version over the files its indicators pin, transitively', async () => {
    const changed = comparisonTree();
    const countries = changed['countries/1.json'] as Record<string, unknown>;
    changed['countries/1.json'] = { ...countries, codes: ['QM', 'QN', 'QP'] };
    const [before, after] = await Promise.all([build(comparisonTree()), build(changed)]);
    expect(after.issues.map(formatIssue)).not.toContainEqual(expect.stringMatching(/^comparisons/));
    expect(after.comparisons[0]?.hash).not.toBe(before.comparisons[0]?.hash);
  });

  it.each<[string, (tree: Record<string, unknown>) => void, string]>([
    [
      'an indicator value that is no decimal',
      (tree) => {
        tree['indicators/homicides/1.json'] = indicatorFile({
          values: [{ country: 'QM', value: '1e3', year: 2024, source: 'stats' }],
        });
      },
      'indicators/homicides/1.json /values/0/value: A value is a decimal',
    ],
    [
      'an indicator source off the pinned hosts',
      (tree) => {
        tree['indicators/homicides/1.json'] = indicatorFile({
          sources: [
            {
              id: 'stats',
              url: 'https://stats.elsewhere.example/homicides',
              title: 'Statistics',
              kind: 'official',
              verifiedAt: '2026-10-01',
            },
          ],
        });
      },
      'indicators/homicides/1.json /sources/0: An official source is on a pinned official host',
    ],
    [
      'an indicator source verified after the build date',
      (tree) => {
        tree['indicators/homicides/1.json'] = indicatorFile({
          sources: [
            {
              id: 'stats',
              url: 'https://stats.gov.example/homicides',
              title: 'Statistics',
              kind: 'official',
              verifiedAt: '2026-12-01',
            },
          ],
        });
      },
      'indicators/homicides/1.json /sources/0/verifiedAt: A source is not verified after the build date',
    ],
    [
      'a country outside the pinned countries file',
      (tree) => {
        tree['indicators/homicides/1.json'] = indicatorFile({
          values: [{ country: 'QZ', value: '1', year: 2024, source: 'stats' }],
        });
      },
      'indicators/homicides/1.json /values/0/country: The country is in the pinned countries file',
    ],
    [
      'a value from after the build year',
      (tree) => {
        tree['indicators/homicides/1.json'] = indicatorFile({
          values: [{ country: 'QM', value: '1', year: 2099, source: 'stats' }],
        });
      },
      'indicators/homicides/1.json /values/0/year: A value is not from after the build year',
    ],
    [
      'a pin to a missing indicator version',
      (tree) => {
        tree['comparisons/destinations/1.json'] = comparisonFile({
          indicators: [{ id: 'homicides', number: 2 }],
        });
      },
      'comparisons/destinations/1.json /indicators/0: The pinned indicators file homicides 2 exists and is valid',
    ],
    [
      'equal anchors',
      (tree) => {
        tree['comparisons/destinations/1.json'] = comparisonFile({
          criteria: [
            {
              id: 'safety',
              title: 'Safety',
              kind: 'indicator',
              indicator: 'homicides',
              zeroAt: '1',
              tenAt: '1.0',
              defaultWeight: 4,
            },
          ],
        });
      },
      'comparisons/destinations/1.json /criteria/0/tenAt: The anchors differ',
    ],
    [
      'a floating-point anchor',
      (tree) => {
        tree['comparisons/destinations/1.json'] = comparisonFile({
          criteria: [
            {
              id: 'safety',
              title: 'Safety',
              kind: 'indicator',
              indicator: 'homicides',
              zeroAt: 20,
              tenAt: '0.5',
              defaultWeight: 4,
            },
          ],
        });
      },
      'comparisons/destinations/1.json /criteria/0/zeroAt: Invalid input: expected string, received number',
    ],
    [
      'an ID that does not match the path',
      (tree) => {
        tree['comparisons/destinations/1.json'] = comparisonFile({ id: 'elsewhere' });
      },
      'comparisons/destinations/1.json: The ID and number match the file path',
    ],
    [
      'a secondary indicator source',
      (tree) => {
        tree['indicators/homicides/1.json'] = indicatorFile({
          sources: [
            ...(indicatorFile()['sources'] as unknown[]),
            {
              id: 'press',
              url: 'https://news.example/homicides',
              title: 'Press report',
              kind: 'secondary',
              verifiedAt: '2026-10-01',
            },
          ],
          values: [{ country: 'QM', value: '1.5', year: 2024, source: 'press' }],
        });
      },
      'indicators/homicides/1.json /sources/1/kind: An indicator cites official sources only',
    ],
    [
      'a criterion reading an indicator the version does not pin',
      (tree) => {
        tree['comparisons/destinations/1.json'] = comparisonFile({
          criteria: [
            ...(comparisonFile()['criteria'] as unknown[]),
            {
              id: 'gdp',
              title: 'Income',
              kind: 'indicator',
              indicator: 'gdp',
              zeroAt: '0',
              tenAt: '100000',
              defaultWeight: 2,
            },
          ],
        });
      },
      'comparisons/destinations/1.json /criteria/2/indicator: The criterion reads a pinned indicator',
    ],
    [
      'a token without a score',
      (tree) => {
        tree['indicators/dual/1.json'] = dualIndicator;
        tree['comparisons/destinations/1.json'] = comparisonFile({
          indicators: [
            { id: 'homicides', number: 1 },
            { id: 'dual', number: 1 },
          ],
          criteria: [
            ...(comparisonFile()['criteria'] as unknown[]),
            {
              id: 'dual-citizenship',
              title: 'Dual citizenship',
              kind: 'category',
              indicator: 'dual',
              scores: [{ token: 'allowed', score: 10 }],
              defaultWeight: 2,
            },
          ],
        });
      },
      'comparisons/destinations/1.json /criteria/2/scores: The token restricted has a score',
    ],
    [
      'an indicator pinned twice',
      (tree) => {
        tree['comparisons/destinations/1.json'] = comparisonFile({
          indicators: [
            { id: 'homicides', number: 1 },
            { id: 'homicides', number: 1 },
          ],
        });
      },
      'comparisons/destinations/1.json /indicators: An indicator is pinned once',
    ],
    [
      'a second comparison series',
      (tree) => {
        tree['comparisons/elsewhere/1.json'] = comparisonFile({ id: 'elsewhere' });
      },
      'comparisons/elsewhere/1.json: There is one comparison series, destinations',
    ],
  ])('rejects %s', async (_name, change, message) => {
    const tree = comparisonTree();
    change(tree);
    expect(await issuesOf(tree)).toContain(message);
  });

  it('reaches the runtime only through the generated module, and only when active', async () => {
    const { entries, countries, comparisons, issues } = await build(comparisonTree());
    expect(issues).toEqual([]);
    const module = catalogModule(entries, countries, [], comparisons);
    const literal = /^export const comparisonData: unknown = JSON\.parse\((.*)\);$/m.exec(
      module,
    )?.[1];
    const catalog = createComparisonCatalog(
      parseComparisons(JSON.parse(JSON.parse(literal ?? '') as string)),
    );
    const [identity] = catalog.identities();
    expect(identity).toEqual({
      comparisonId: 'destinations',
      number: 1,
      hash: comparisons[0]?.hash,
    });
    if (identity === undefined) return;
    expect(catalog.activeEntry(identity, new Map())).toBeUndefined();
    const active = new Map([[comparisonIdentityKey(identity), 'active' as const]]);
    expect(catalog.activeEntry(identity, active)?.version.criteria).toHaveLength(2);
    expect(catalog.activeEntry({ ...identity, hash: 'f'.repeat(64) }, active)).toBeUndefined();
  });

  it('refuses a built entry that does not carry exactly its pinned indicators', () => {
    expect(() =>
      parseComparisons([{ hash: 'a'.repeat(64), version: comparisonFile(), indicators: [] }]),
    ).toThrow(RangeError);
  });
});

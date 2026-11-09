import { describe, expect, it } from 'vitest';
import { buildKnowledge, catalogModule, formatIssue } from '../scripts/build.ts';
import { createGuideLookup } from '../src/guides.ts';
import { baseTree, buildDate, emptyHashes, fixtures, writeTree } from './data.ts';

const law = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'residence-act',
  title: 'Residence act',
  url: 'https://www.gov.example/residence-act',
  verifiedAt: '2026-10-01',
  amendment: 'Amended by acts of parliament, published in the official gazette.',
  ...overrides,
});

/** A synthetic guide for the fixture country QM. */
function guide(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'qm',
    number: 1,
    title: 'QM immigration law',
    laws: [law()],
    pitfalls: [
      {
        id: 'old-amounts',
        text: 'The implementing decree still prints the amounts the act replaced.',
        laws: ['residence-act'],
      },
    ],
    countries: { id: 'countries', number: 1 },
    officialDomains: [{ id: 'qm-gov', number: 1 }],
    ...overrides,
  };
}

const withGuides = (...guides: Record<string, unknown>[]): Record<string, unknown> => ({
  ...baseTree(),
  ...Object.fromEntries(
    guides.map((each) => [`guides/${String(each['id'])}/${String(each['number'])}.json`, each]),
  ),
});

async function build(tree: Record<string, unknown>, hashes?: unknown) {
  return buildKnowledge(await writeTree(tree, hashes), buildDate, fixtures);
}

describe('country guides in the build (ADR-0027)', () => {
  it('validates, hashes and carries a guide', async () => {
    const { guides, issues } = await build(withGuides(guide()));
    expect(issues).toEqual([]);
    expect(guides.map((each) => each.guide)).toEqual([guide()]);
    expect(guides[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts a law's machine-readable address on a pinned official host", async () => {
    const withAddress = guide({
      laws: [law({ machineReadableUrl: 'https://api.gov.example/residence-act.xml' })],
    });
    const { guides, issues } = await build(withGuides(withAddress));
    expect(issues).toEqual([]);
    expect(guides.map((each) => each.guide)).toEqual([withAddress]);
  });

  it('records each guide in hashes.json', async () => {
    const { issues } = await build(withGuides(guide()), emptyHashes());
    expect(issues.map(formatIssue)).toContainEqual(
      expect.stringMatching(
        /^hashes\.json: guides\/qm\/1 has no recorded hash; append [0-9a-f]{64}$/,
      ),
    );
  });

  it('hashes the official-domain lists the guide pins with it', async () => {
    const first = await build(withGuides(guide()));
    const tree = withGuides(guide());
    tree['official-domains/qm-gov/1.json'] = {
      ...(tree['official-domains/qm-gov/1.json'] as object),
      issuer: 'Government of QM, renamed',
    };
    const second = await build(tree);
    expect(second.guides[0]?.hash).not.toBe(first.guides[0]?.hash);
  });

  it.each<[string, Record<string, unknown>, string]>([
    [
      'a law off the pinned official hosts',
      guide({
        laws: [law({ url: 'https://blog.example/residence-act' })],
        pitfalls: [],
      }),
      'guides/qm/1.json /laws/0/url: A law is on a host of a pinned official-domain list',
    ],
    [
      "a law's machine-readable address off the pinned official hosts",
      guide({ laws: [law({ machineReadableUrl: 'https://evil-gov.example/act.xml' })] }),
      'guides/qm/1.json /laws/0/machineReadableUrl: A machine-readable address is on a pinned official host',
    ],
    [
      'a law verified after the build date',
      guide({
        laws: [law({ verifiedAt: '2026-12-01' })],
        pitfalls: [],
      }),
      'guides/qm/1.json /laws/0/verifiedAt: A source is not verified after the build date',
    ],
    [
      'a missing official-domain list',
      guide({ officialDomains: [{ id: 'qm-gov', number: 2 }] }),
      'guides/qm/1.json /officialDomains/0: The pinned official-domains file qm-gov 2 exists and is valid',
    ],
    [
      'a country outside the pinned countries',
      guide({ id: 'qz' }),
      'guides/qz/1.json /id: The country is in the pinned countries file',
    ],
    [
      'an ID that is not its directory',
      { ...guide(), path: 'guides/qn/1.json' },
      'guides/qn/1.json: The ID and number match the file path',
    ],
  ])('reports %s', async (_, file, message) => {
    const { path, ...content } = file;
    const tree = baseTree();
    tree[typeof path === 'string' ? path : `guides/${String(file['id'])}/1.json`] = content;
    const { guides, issues } = await build(tree);
    expect(issues.map(formatIssue)).toContain(message);
    expect(guides).toEqual([]);
  });

  it('puts the guides in the catalog module as data', async () => {
    const { entries, guides } = await build(withGuides(guide()));
    const module = catalogModule({ entries, guides });
    const literal = /^export const guideData: unknown = JSON\.parse\((.*)\);$/m.exec(module)?.[1];
    expect(JSON.parse(JSON.parse(literal ?? '') as string)).toEqual(guides);
  });
});

describe('createGuideLookup', () => {
  it("answers each country's highest guide version, by uppercase code", async () => {
    const { guides, issues } = await build(
      withGuides(guide(), guide({ number: 2, title: 'QM immigration law, revised' })),
    );
    expect(issues).toEqual([]);
    const lookup = createGuideLookup([...guides].reverse());
    const second = createGuideLookup(guides.slice(1))('QM');
    expect(second?.guide.number).toBe(2);
    expect(lookup('QM')).toEqual(second);
    expect(lookup('qm')).toBeUndefined();
    expect(lookup('QN')).toBeUndefined();
  });

  it('refuses two guides with one country and number', async () => {
    const { guides } = await build(withGuides(guide()));
    expect(() => createGuideLookup([...guides, ...guides])).toThrow(RangeError);
  });

  it('refuses data that is not a valid guide', () => {
    expect(() => createGuideLookup([{ hash: 'a'.repeat(64), guide: { id: 'qm' } }])).toThrow();
  });
});

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostOf } from '@arca/scripts/host';
import { describe, expect, it } from 'vitest';
import { generatedImport, importBuild, importMigrationFile } from '../scripts/rule-import.ts';
import { bundledRuleData } from '../src/bundled.ts';
import type { Json } from '../src/canonical.ts';
import { type RuleRows, ruleContent, ruleDataFromRows } from '../src/rule-rows.ts';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const dataDir = join(packageDir, 'data');
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

async function built() {
  const { rows, datasetFiles, issues } = await importBuild(dataDir);
  expect(issues).toEqual([]);
  return {
    rows,
    read: (from: RuleRows) => ruleContent(ruleDataFromRows(from, { datasetFiles, sha256, hostOf })),
  };
}

const bundled = ruleContent(bundledRuleData);

const routeKeys = (rows: RuleRows, routeId: string) =>
  rows.routeVersions
    .filter((row) => row.routeId === routeId)
    .map((row) => `routes/${routeId}/${String(row.number)}`);

const withContent = (content: Json, change: Record<string, Json>): Json => ({
  ...(content as Record<string, Json>),
  ...change,
});

describe('rule rows (ADR-0031)', { timeout: 120_000 }, () => {
  it('read back as exactly the versions, hashes, cases, hosts and lists the build made', async () => {
    const { rows, read } = await built();
    const data = read(rows);
    expect(data.refused).toEqual([]);
    expect([...data.entries.keys()].sort()).toEqual([...bundled.entries.keys()].sort());
    for (const [key, entry] of data.entries) {
      expect(entry).toEqual(bundled.entries.get(key));
    }
    expect(new Map(data.cases.map((each) => [each.hash, each.cases]))).toEqual(
      new Map(bundled.cases.map((each) => [each.hash, each.cases])),
    );
    expect(data.hosts).toEqual(bundled.hosts);
    expect(data.officialDomains).toEqual(expect.arrayContaining([...bundled.officialDomains]));
    expect(data.officialDomains).toHaveLength(bundled.officialDomains.length);
  });

  it('refuses a changed route version and withholds its whole route', async () => {
    const { rows, read } = await built();
    const [first, ...rest] = rows.routeVersions;
    if (first === undefined) throw new Error('A route version expected');
    const changed = { ...first, content: withContent(first.content, { title: 'Changed' }) };
    const data = read({ ...rows, routeVersions: [changed, ...rest] });
    const withheld = routeKeys(rows, first.routeId);
    expect(new Set(data.refused)).toEqual(new Set(withheld));
    expect([...data.entries.values()].map(({ identity }) => identity.routeId)).not.toContain(
      first.routeId,
    );
    expect(data.entries.size).toBe(rows.routeVersions.length - withheld.length);
  });

  it('refuses a version stored under another ID or number than its content names', async () => {
    const { rows, read } = await built();
    const [first, ...rest] = rows.routeVersions;
    if (first === undefined) throw new Error('A route version expected');
    const data = read({ ...rows, routeVersions: [{ ...first, number: 999 }, ...rest] });
    expect(data.refused).toContain(`routes/${first.routeId}/999`);
    expect([...data.entries.values()].map(({ identity }) => identity.routeId)).not.toContain(
      first.routeId,
    );
  });

  it('refuses every set and version that pins a changed official-domain list', async () => {
    const { rows, read } = await built();
    const list = rows.officialDomainLists.find(({ id }) => id === 'eu');
    if (list === undefined) throw new Error('The eu list expected');
    const changed = { ...list, content: withContent(list.content, { issuer: 'Someone else' }) };
    const data = read({
      ...rows,
      officialDomainLists: rows.officialDomainLists.map((each) => (each === list ? changed : each)),
    });
    expect(data.refused).toContain('official-domains/eu/1');
    expect(data.refused).toContain('country-sets/eu-free-movement/1');
    const pinsEu = rows.routeVersions.filter(({ content }) =>
      JSON.stringify(content).includes('"eu-free-movement"'),
    );
    expect(pinsEu.length).toBeGreaterThan(0);
    for (const row of pinsEu) {
      expect(data.refused).toContain(`routes/${row.routeId}/${String(row.number)}`);
    }
  });

  it('refuses every version that pins a changed country set, but not the list it pins', async () => {
    const { rows, read } = await built();
    const set = rows.countrySets.find(({ id }) => id === 'eu-free-movement');
    if (set === undefined) throw new Error('The eu-free-movement set expected');
    const changed = { ...set, content: withContent(set.content, { title: 'Changed' }) };
    const data = read({
      ...rows,
      countrySets: rows.countrySets.map((each) => (each === set ? changed : each)),
    });
    expect(data.refused).toContain('country-sets/eu-free-movement/1');
    expect(data.refused).not.toContain('official-domains/eu/1');
    const pinsSet = rows.routeVersions.filter(({ content }) =>
      JSON.stringify(content).includes('"eu-free-movement"'),
    );
    expect(pinsSet.length).toBeGreaterThan(0);
    for (const row of pinsSet) {
      expect(data.refused).toContain(`routes/${row.routeId}/${String(row.number)}`);
    }
  });

  it('is what the committed import migration writes', async () => {
    const committed = await readFile(
      await importMigrationFile(join(packageDir, '..', 'db', 'migrations')),
      'utf8',
    );
    expect(committed === (await generatedImport(dataDir))).toBe(true);
  });
});

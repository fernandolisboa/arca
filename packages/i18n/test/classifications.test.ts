import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ptBR } from '../src/catalogs/pt-BR.js';

const dataDir = new URL('../../knowledge/data/', import.meta.url);

/** Every code of every numbered file of a knowledge dataset, sorted. */
async function datasetCodes(dataset: string): Promise<string[]> {
  const dir = new URL(`${dataset}/`, dataDir);
  const names = (await readdir(dir)).filter((name) => /^[1-9][0-9]*\.json$/.test(name));
  const files = await Promise.all(
    names.map(
      async (name) => JSON.parse(await readFile(new URL(name, dir), 'utf8')) as { codes: string[] },
    ),
  );
  return [...new Set(files.flatMap((file) => file.codes))].sort();
}

const labelled = (labels: Record<string, string>): string[] =>
  Object.entries(labels)
    .filter(([, label]) => label.trim() !== '')
    .map(([code]) => code)
    .sort();

describe('classification labels', () => {
  it.each([
    ['occupations', ptBR.occupations, ptBR.occupationGroups, 1],
    ['study-fields', ptBR.studyFields, ptBR.studyFieldGroups, 2],
  ] as const)(
    'name every code of %s, and its group, with a non-empty label and nothing else',
    async (dataset, labels, groups, groupDigits) => {
      const codes = await datasetCodes(dataset);
      expect(labelled(labels)).toEqual(codes);
      expect(labelled(groups)).toEqual(
        [...new Set(codes.map((code) => code.slice(0, groupDigits)))].sort(),
      );
    },
  );

  it.each([
    ['occupations', ptBR.occupations],
    ['study fields', ptBR.studyFields],
  ])(
    'write %s in Brazilian Portuguese, never in spellings or words of Portugal',
    (_name, labels) => {
      const portugal =
        /\b(?:equipa|registo|utilizador|camião|autocarro|comboio|telemóvel|facto|contacto|projecto)s?\b|electr|óptic|[cp]ç/iu;
      expect(Object.values(labels).filter((label) => portugal.test(label))).toEqual([]);
    },
  );

  it('shares no label between two codes, so a search never shows two alike', () => {
    for (const labels of [ptBR.occupations, ptBR.studyFields]) {
      const values = Object.values(labels);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

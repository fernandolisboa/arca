import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ptBR } from '../src/catalogs/pt-BR.js';

const dataDir = new URL('../../knowledge/data/former-countries/', import.meta.url);

async function formerCountryCodes(): Promise<string[]> {
  const names = (await readdir(dataDir)).filter((name) => /^[1-9][0-9]*\.json$/.test(name));
  const files = await Promise.all(
    names.map(async (name) => {
      const text = await readFile(new URL(name, dataDir), 'utf8');
      return JSON.parse(text) as { codes: string[] };
    }),
  );
  return [...new Set(files.flatMap((file) => file.codes))].sort();
}

describe('former country names', () => {
  it('name every code in every knowledge former-countries file, and nothing else', async () => {
    expect(Object.keys(ptBR.formerCountries).sort()).toEqual(await formerCountryCodes());
  });
});

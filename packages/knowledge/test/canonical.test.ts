import { readFile } from 'node:fs/promises';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalize, contentHash } from '../scripts/canonical.ts';
import { hashesFileSchema } from '../scripts/files.ts';
import type { Json } from '../scripts/json.ts';
import { fromBits, nonFiniteSamples, rfc8785Vectors } from '../scripts/vectors.ts';

/** The UTF-8 bytes RFC 8785 section 3.2.4 gives for its sample, as printed there. */
const sampleBytes = `
  7b 22 6c 69 74 65 72 61 6c 73 22 3a 5b 6e 75 6c 6c 2c 74 72
  75 65 2c 66 61 6c 73 65 5d 2c 22 6e 75 6d 62 65 72 73 22 3a
  5b 33 33 33 33 33 33 33 33 33 2e 33 33 33 33 33 33 33 2c 31
  65 2b 33 30 2c 34 2e 35 2c 30 2e 30 30 32 2c 31 65 2d 32 37
  5d 2c 22 73 74 72 69 6e 67 22 3a 22 e2 82 ac 24 5c 75 30 30
  30 66 5c 6e 41 27 42 5c 22 5c 5c 5c 5c 5c 22 2f 22 7d`;

describe('canonicalize (RFC 8785)', () => {
  it.each(rfc8785Vectors.map((vector) => [vector.name, vector] as const))(
    'passes the %s vector',
    (_, vector) => {
      expect(canonicalize(vector.value)).toBe(vector.canonical);
    },
  );

  it('produces the bytes of section 3.2.4', () => {
    const [primitives] = rfc8785Vectors;
    if (primitives === undefined) throw new Error('No vectors');
    expect(Buffer.from(canonicalize(primitives.value), 'utf8').toString('hex')).toBe(
      sampleBytes.replace(/\s/g, ''),
    );
  });

  it('sorts properties into the order section 3.2.3 expects', () => {
    const sorting = rfc8785Vectors.find((vector) => vector.name === 'sorting');
    // Read off the text: a parsed object would list the integer-like key "1" first.
    const order = [...canonicalize(sorting?.value ?? null).matchAll(/:"([^"]*)"/g)].map(
      ([, value]) => value,
    );
    expect(order).toEqual([
      'Carriage Return',
      'One',
      'Control',
      'Latin Small Letter O With Diaeresis',
      'Euro Sign',
      'Emoji: Grinning Face',
      'Hebrew Letter Dalet With Dagesh',
    ]);
  });

  it.each(nonFiniteSamples)('refuses the appendix B sample %s', (bits) => {
    expect(() => canonicalize([fromBits(bits)])).toThrow(RangeError);
  });

  it('refuses a lone surrogate in a string or a key', () => {
    expect(() => canonicalize('\ud800')).toThrow(RangeError);
    expect(() => canonicalize({ '\udc00': 1 })).toThrow(RangeError);
  });

  it('does not depend on the order properties were written in', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.integer()), (record) => {
        const reversed = Object.fromEntries(Object.entries(record).reverse());
        expect(canonicalize(reversed)).toBe(canonicalize(record));
      }),
    );
  });

  it('round-trips through JSON.parse for any JSON value', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const json = value as Json;
        expect(canonicalize(JSON.parse(canonicalize(json)) as Json)).toBe(canonicalize(json));
      }),
    );
  });

  it('hashes each vector to the hash committed in hashes.json', async () => {
    const committed = hashesFileSchema.parse(
      JSON.parse(await readFile(new URL('../data/hashes.json', import.meta.url), 'utf8')),
    );
    expect(committed.vectors).toEqual(
      rfc8785Vectors.map((vector) => ({ name: vector.name, sha256: contentHash(vector.value) })),
    );
  });
});

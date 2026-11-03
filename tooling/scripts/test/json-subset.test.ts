import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type Json,
  JsonSubsetError,
  hiddenCharacters,
  parseJsonSubset,
} from '../src/json-subset.ts';

const parse = (text: string, depth = 48): Json =>
  parseJsonSubset(new TextEncoder().encode(text), depth);

const allowed = (text: string): boolean =>
  text.normalize('NFC') === text && !hiddenCharacters.test(text);

const subsetValue: fc.Arbitrary<Json> = fc.letrec<{ value: Json }>((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.constant(null),
    fc.boolean(),
    fc.maxSafeInteger(),
    fc.string({ unit: 'grapheme' }).filter(allowed),
    fc.array(tie('value'), { maxLength: 4 }),
    fc.dictionary(fc.string({ unit: 'grapheme' }).filter(allowed), tie('value'), { maxKeys: 4 }),
  ),
})).value;

describe('parseJsonSubset', () => {
  it('reads what JSON.stringify writes, for any value in the subset', () => {
    fc.assert(
      fc.property(subsetValue, (value) => {
        expect(parse(JSON.stringify(value), 100)).toEqual(value);
      }),
    );
  });

  it('keeps a __proto__ key as data', () => {
    const value = parse('{"__proto__":{"polluted":true}}') as Record<string, Json>;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.keys(value)).toEqual(['__proto__']);
  });

  it('reads escapes, including a surrogate pair', () => {
    expect(parse('"\\u00e9\\ud83d\\ude00\\/"')).toBe('\u00e9\ud83d\ude00/');
  });

  it.each([
    ['a duplicate key', '{"a":1,"a":1}'],
    ['a fraction', '1.0'],
    ['an exponent', '1e2'],
    ['an integer beyond 2^53 - 1', '9007199254740992'],
    ['a negative integer beyond -(2^53 - 1)', '-9007199254740992'],
    ['a string not in NFC', '"e\u0301"'],
    ['a key not in NFC', '{"e\u0301":1}'],
    ['an escaped lone surrogate', '"\\ud800"'],
    ['an unescaped control character', '"a\u0001"'],
    ['an invalid escape', '"\\x41"'],
    ['a leading zero', '01'],
    ['a trailing comma', '[1,]'],
    ['content after the value', '{} {}'],
    ['a byte order mark', '\ufeff{}'],
    ['single quotes', "{'a':1}"],
    ['an unterminated string', '"abc'],
    ['a right-to-left override', '"abc\u202edef"'],
    ['an escaped right-to-left override', '"abc\\u202edef"'],
    ['a zero-width space in a key', '{"a\u200bb":1}'],
    ['a byte order mark inside a string', '"a\ufeffb"'],
    ['a tag character', '"a\udb40\udc41b"'],
    ['a soft hyphen', '"a\u00adb"'],
    ['a variation selector', '"a\ufe0fb"'],
    ['a line separator', '"a\u2028b"'],
    ['an escaped line feed', '"a\\nb"'],
    ['an escaped C0 control', '"a\\u0001b"'],
    ['a C1 control', '"a\u0085b"'],
  ])('refuses %s', (_, text) => {
    expect(() => parse(text)).toThrow(JsonSubsetError);
  });

  it('refuses bytes that are not UTF-8', () => {
    expect(() => parseJsonSubset(new Uint8Array([0x22, 0xff, 0x22]), 48)).toThrow(JsonSubsetError);
  });

  it('refuses nesting deeper than the limit without overflowing the stack', () => {
    expect(parse('[[[]]]', 2)).toEqual([[[]]]);
    expect(() => parse('[[[[]]]]', 2)).toThrow(JsonSubsetError);
    expect(() => parse('['.repeat(100_000))).toThrow(JsonSubsetError);
  });

  it('accepts the safe integer bounds', () => {
    expect(parse('[9007199254740991,-9007199254740991]')).toEqual([
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
    ]);
  });
});

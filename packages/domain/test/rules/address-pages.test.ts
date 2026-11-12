import { describe, expect, it } from 'vitest';
import {
  addressPages,
  machineReadableUrlSchema,
  maxAddressPages,
} from '../../src/rules/route-version.js';

const api = 'https://api.gov.example/acts/326/fragments';

describe('the pages a machine-readable address names (ADR-0027)', () => {
  it.each<[string, string[]]>([
    [`${api}?page=0`, [`${api}?page=0`]],
    [`${api}?page={0..2}`, [`${api}?page=0`, `${api}?page=1`, `${api}?page=2`]],
    [`${api}?from={3..4}&size=1000`, [`${api}?from=3&size=1000`, `${api}?from=4&size=1000`]],
  ])('reads %s as its pages', (address, pages) => {
    expect(addressPages(address)).toEqual(pages);
    expect(machineReadableUrlSchema.safeParse(address).success).toBe(true);
  });

  it.each([
    ['a range in the path', 'https://api.gov.example/acts/{0..2}?page=1'],
    ['two ranges', `${api}?page={0..1}&part={0..1}`],
    ['a range that runs backwards', `${api}?page={3..1}`],
    ['too many pages', `${api}?page={0..${String(maxAddressPages)}}`],
    ['a stray brace', `${api}?page={0}`],
  ])('refuses %s', (_, address) => {
    expect(addressPages(address)).toEqual([]);
    expect(machineReadableUrlSchema.safeParse(address).success).toBe(false);
  });
});

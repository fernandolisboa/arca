import { describe, expect, it } from 'vitest';
import { initials, shortName } from '../src/person-names.js';

/** Synthetic names only. */
describe('shortName', () => {
  it.each([
    ['a unique first name', 'Ana Souza Lima', ['Bruno Costa'], 'Ana'],
    ['a shared first name', 'Maria Clara Souza', ['Maria Eduarda Lima'], 'Maria Souza'],
    ['a shared first name in another case', 'Ana Lima', ['ana Costa'], 'Ana Lima'],
    ['a shared one-word name', 'Ana', ['Ana Costa'], 'Ana'],
    ['extra spaces', '  Ana   Lima  ', [], 'Ana'],
    ['an empty name', '   ', ['Ana'], ''],
    ['the same full name twice', 'Ana Lima', ['Ana Lima'], 'Ana Lima'],
    ['decomposed accents', 'Lúcia Lima', ['Lúcia Costa'], 'Lúcia Lima'],
  ])('handles %s', (_, name, others, expected) => {
    expect(shortName(name, others)).toBe(expected);
  });
});

describe('initials', () => {
  it.each([
    ['Ana Souza Lima', 'AL'],
    ['ana', 'A'],
    ['  Érica   Dias ', 'ÉD'],
    ['', ''],
  ])('reads %j as %j', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

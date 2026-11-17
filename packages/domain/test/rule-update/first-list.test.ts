import { describe, expect, it } from 'vitest';
import {
  firstListProblems,
  maxFirstListHosts,
  registryNamesHost,
} from '../../src/rule-update/first-list.js';
import type { CalendarDate } from '../../src/index.js';
import type { OfficialDomainList } from '../../src/rules/route-version.js';

const hostOf = (url: string) => {
  const match = /^https:\/\/([a-z0-9.-]+)\//.exec(url);
  return match?.[1];
};

const list = (...hosts: [string, string][]): OfficialDomainList => ({
  schemaVersion: 1,
  id: 'qn',
  number: 1,
  issuer: 'A synthetic republic',
  hosts: hosts.map(([host, url]) => ({
    host,
    source: {
      id: `proof-${host}`,
      url,
      title: 'Registry',
      kind: 'official',
      verifiedAt: '2026-11-17' as CalendarDate,
    },
  })),
});

const trust = {
  namedHosts: ['registry.qn', 'interior.qn', 'migra.qn'],
  importedHosts: ['europa.eu'],
  hostOf,
};

describe('firstListProblems (ADR-0031)', () => {
  it('takes named hosts and their subdomains, with proofs on a named host or an imported list', () => {
    expect(
      firstListProblems(
        list(
          ['interior.qn', 'https://registry.qn/bodies'],
          ['visas.migra.qn', 'https://europa.eu/qn'],
        ),
        trust,
      ),
    ).toEqual([]);
  });

  it.each<[string, OfficialDomainList, RegExp]>([
    ['a top-level domain', list(['qn', 'https://registry.qn/']), /registry suffix/],
    [
      'a common second-level suffix',
      list(['interior.qn', 'https://registry.qn/'], ['com.qn', 'https://registry.qn/']),
      /com\.qn is a registry suffix/,
    ],
    ['a proof on its own host', list(['registry.qn', 'https://registry.qn/self']), /same list/],
    [
      'a proof on a subdomain of a host of the list',
      list(['interior.qn', 'https://www.interior.qn/']),
      /same list/,
    ],
    [
      'a proof on a parent of a host of the list',
      list(['migra.registry.qn', 'https://registry.qn/']),
      /same list/,
    ],
    [
      'a host nobody named, as research might add',
      list(['interior.qn', 'https://registry.qn/'], ['pages.example', 'https://registry.qn/']),
      /pages\.example is not a host the admin named/,
    ],
    [
      'a proof address with a query, which a search page echoes',
      list(['interior.qn', 'https://registry.qn/search?q=bodies']),
      /has no query/,
    ],
    [
      'a proof address that names the host, which a not-found page echoes',
      list(['interior.qn', 'https://registry.qn/interior.qn']),
      /does not name interior\.qn/,
    ],
    [
      'more hosts than a first list holds',
      list(
        ...Array.from({ length: maxFirstListHosts + 1 }, (_, index): [string, string] => [
          `s${String(index)}.interior.qn`,
          'https://registry.qn/',
        ]),
      ),
      /At most/,
    ],
    [
      'a proof on a host nobody approved',
      list(['interior.qn', 'https://elsewhere.example/']),
      /admin named/,
    ],
  ])('refuses %s', (_, proposed, problem) => {
    const problems = firstListProblems(proposed, trust);
    expect(problems.some((line) => problem.test(line))).toBe(true);
  });
});

describe('registryNamesHost (ADR-0031)', () => {
  it.each<[string, string, boolean]>([
    ['The ministry runs gov.qn and its services.', 'gov.qn', true],
    ['See https://gov.qn/about', 'gov.qn', true],
    ['Domain: GOV.QN.', 'gov.qn', true],
    ['notgov.qn is private', 'gov.qn', false],
    ['portal.gov.qn only', 'gov.qn', false],
    ['gov.qn.example is a mirror', 'gov.qn', false],
    ['nothing here', 'gov.qn', false],
  ])('in %j finds %s: %s', (text, host, found) => {
    expect(registryNamesHost(text, host)).toBe(found);
  });
});

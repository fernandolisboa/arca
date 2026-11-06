import type { CasePerson, CaseView } from '@arca/api-contract/client';
import { describe, expect, it } from 'vitest';
import { newsOf, seenOf } from '../src/family-news.js';

/** Synthetic IDs only. */
const me = '00000000-0000-4000-8000-000000000001';
const bruno = '00000000-0000-4000-8000-000000000002';
const child = '00000000-0000-4000-8000-000000000003';
const brunoAccount = '00000000-0000-4000-8000-0000000000b1';

const person = (overrides: Partial<CasePerson> & Pick<CasePerson, 'id'>): CasePerson => ({
  displayName: 'Pessoa',
  caseMember: true,
  accountId: null,
  keptByMe: false,
  profile: null,
  finances: null,
  shares: null,
  sharedWithMe: [],
  ...overrides,
});

const viewWith = (people: readonly CasePerson[]): CaseView => ({
  caseId: '00000000-0000-4000-8000-0000000000c1',
  me,
  people: [
    person({ id: me, accountId: '00000000-0000-4000-8000-0000000000a1', keptByMe: true }),
    ...people,
  ],
  relationships: [],
  assets: [],
});

describe('the family area news (spec 0007, R2)', () => {
  const before = viewWith([person({ id: child, sharedWithMe: ['profile'] })]);

  it('says nothing on a device that never looked', () => {
    expect(newsOf(before, undefined)).toEqual({ joined: [], granted: [], revoked: [] });
  });

  it.each([
    ['nothing changed', before, [], [], []],
    [
      'a member joined',
      viewWith([
        person({ id: child, sharedWithMe: ['profile'] }),
        person({ id: bruno, accountId: brunoAccount }),
      ]),
      [bruno],
      [],
      [],
    ],
    [
      'finances were shared and the profile taken back',
      viewWith([person({ id: child, sharedWithMe: ['finances'] })]),
      [],
      [[child, 'finances']],
      [[child, 'profile']],
    ],
    ['a person who left says nothing', viewWith([]), [], [], []],
  ] as const)('%s', (_case, after, joined, granted, revoked) => {
    const news = newsOf(after, seenOf(before));
    expect(news.joined.map(({ id }) => id)).toEqual(joined);
    expect(news.granted.map(({ person: { id }, scope }) => [id, scope])).toEqual(granted);
    expect(news.revoked.map(({ person: { id }, scope }) => [id, scope])).toEqual(revoked);
  });

  it('says nothing about another case the viewer was in', () => {
    const elsewhere = { ...seenOf(before), caseId: '00000000-0000-4000-8000-0000000000c2' };
    expect(newsOf(viewWith([person({ id: bruno, accountId: brunoAccount })]), elsewhere)).toEqual({
      joined: [],
      granted: [],
      revoked: [],
    });
  });

  it('stores IDs only', () => {
    expect(JSON.stringify(seenOf(before))).not.toContain('Pessoa');
  });
});

import { describe, expect, it } from 'vitest';
import {
  allDocuments,
  countryShelves,
  documentsToBring,
  inView,
  unfiledDocuments,
} from '../src/document-countries.js';
import type { OpenedDocument } from '../src/documents.js';

const me = '00000000-0000-4000-8000-000000000001';
const relative = '00000000-0000-4000-8000-000000000002';

const opened = (
  id: string,
  countries: string[],
  { ownerId = me, named = true }: { ownerId?: string; named?: boolean } = {},
): OpenedDocument => ({
  document: {
    id,
    typeKey: 'other',
    size: 10,
    sha256: 'A'.repeat(43),
    label: 'AAAA',
    createdAt: '2026-01-01T00:00:00.000Z',
    ownerId,
    sharedWith: [],
    countries,
  },
  label: named ? { name: `${id}.pdf`, type: 'application/pdf' } : undefined,
  stale: false,
});

const passport = opened('passport', ['PT', 'US']);
const birth = opened('birth', ['PT']);
const diploma = opened('diploma', []);
const theirs = opened('theirs', ['US'], { ownerId: relative });
const documents = [passport, birth, diploma, theirs];
const ids = (list: readonly OpenedDocument[]) => list.map(({ document }) => document.id);

describe('the countries the documents list offers', () => {
  it('counts the documents under each country, shared ones included, and those under none', () => {
    expect(countryShelves(documents, allDocuments)).toEqual({
      total: 4,
      unfiled: 1,
      countries: [
        { code: 'PT', count: 2 },
        { code: 'US', count: 2 },
      ],
    });
  });

  it('keeps the country being looked at while it has no document yet', () => {
    expect(countryShelves(documents, 'ES').countries).toEqual([
      { code: 'ES', count: 0 },
      { code: 'PT', count: 2 },
      { code: 'US', count: 2 },
    ]);
    expect(countryShelves([], unfiledDocuments)).toEqual({ total: 0, unfiled: 0, countries: [] });
  });
});

describe('the documents a view shows', () => {
  it('shows every document, those under no country, or those under one country', () => {
    expect(ids(inView(documents, allDocuments))).toEqual([
      'passport',
      'birth',
      'diploma',
      'theirs',
    ]);
    expect(ids(inView(documents, unfiledDocuments))).toEqual(['diploma']);
    expect(ids(inView(documents, 'US'))).toEqual(['passport', 'theirs']);
    expect(inView(documents, 'ES')).toEqual([]);
  });
});

describe('the documents a country can bring from the vault', () => {
  it("offers the account's own named documents that are not under the country yet", () => {
    expect(ids(documentsToBring(documents, 'US', me))).toEqual(['birth', 'diploma']);
    expect(ids(documentsToBring(documents, 'PT', me))).toEqual(['diploma']);
  });

  it('never offers a document another account owns or one whose name did not open', () => {
    const unnamed = opened('unnamed', [], { named: false });
    expect(ids(documentsToBring([theirs, unnamed], 'PT', me))).toEqual([]);
  });
});

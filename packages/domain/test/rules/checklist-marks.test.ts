import { describe, expect, it } from 'vitest';
import {
  type CatalogEntry,
  type DecisionState,
  type RouteCatalog,
  identityKey,
} from '../../src/rules/catalog.js';
import {
  type MarkState,
  droppedItems,
  listProgress,
  routeProgress,
} from '../../src/rules/checklist-marks.js';
import { entry } from './fixtures.js';

/** Synthetic documents only: invented titles and kinds. */
const item = (id: string, title = `Document ${id}`): object => ({
  id,
  title,
  kind: id.replaceAll('-', '_'),
  appliesTo: 'principal',
  sources: ['law'],
});

const version = (number: number, documents?: readonly object[]): CatalogEntry =>
  entry({ number, ...(documents === undefined ? {} : { documents }) });

function catalogOf(
  entries: readonly CatalogEntry[],
  stateOf: (entry: CatalogEntry) => DecisionState = () => 'active',
) {
  const states = new Map(entries.map((each) => [identityKey(each.identity), stateOf(each)]));
  const catalog: RouteCatalog = {
    identities: () => entries.map(({ identity }) => identity),
    activeEntry: (identity, decided) =>
      decided.get(identityKey(identity)) === 'active'
        ? entries.find(({ identity: each }) => identityKey(each) === identityKey(identity))
        : undefined,
  };
  return { catalog, states };
}

describe('listProgress', () => {
  const marks = new Map<string, MarkState>([
    ['passport', 'had'],
    ['police-record', 'missing'],
    ['dropped', 'had'],
  ]);
  it.each<[string, string[], { had: number; total: number }]>([
    [
      'counts only had marks on items the list shows',
      ['passport', 'police-record'],
      { had: 1, total: 2 },
    ],
    ['counts an unmarked item as not done', ['passport', 'photo'], { had: 1, total: 2 }],
    ['reads a list with no items as nothing to do', [], { had: 0, total: 0 }],
  ])('%s', (_label, ids, expected) => {
    expect(
      listProgress(
        ids.map((documentId) => ({ documentId })),
        (documentId) => marks.get(documentId),
      ),
    ).toEqual(expected);
  });
});

describe('routeProgress', () => {
  it('adds up every list', () => {
    expect(
      routeProgress([
        { had: 1, total: 3 },
        { had: 2, total: 2 },
      ]),
    ).toEqual({ had: 3, total: 5 });
  });

  it('has none when the viewer cannot see some list’s marks', () => {
    expect(routeProgress([{ had: 1, total: 3 }, null])).toBeNull();
  });
});

describe('droppedItems', () => {
  const first = version(1, [item('passport'), item('police-record', 'Police record')]);
  const second = version(2, [item('passport'), item('photo')]);

  it('keeps a mark whose item the new version keeps, and drops none of it', () => {
    const { catalog, states } = catalogOf([first, second]);
    expect(droppedItems(catalog, states, second, ['passport', 'photo'])).toEqual([]);
  });

  it('names an item a new version dropped with its title from the version that listed it', () => {
    const { catalog, states } = catalogOf([first, second]);
    expect(droppedItems(catalog, states, second, ['passport', 'police-record'])).toEqual([
      { documentId: 'police-record', title: 'Police record' },
    ]);
  });

  it('takes the title from the newest earlier version that listed the item', () => {
    const middle = version(2, [item('police-record', 'Criminal record certificate')]);
    const last = version(3, [item('passport')]);
    const { catalog, states } = catalogOf([first, middle, last]);
    expect(droppedItems(catalog, states, last, ['police-record'])).toEqual([
      { documentId: 'police-record', title: 'Criminal record certificate' },
    ]);
  });

  it('reads no title from a version that was never active (rule 5)', () => {
    const { catalog, states } = catalogOf([first, second], (each) =>
      each === first ? 'proposed' : 'active',
    );
    expect(droppedItems(catalog, states, second, ['police-record'])).toEqual([
      { documentId: 'police-record' },
    ]);
  });

  it('reads every mark as no longer asked when the version has no list, once each', () => {
    const covered = version(1, [item('passport')]);
    const uncovered = version(2);
    const { catalog, states } = catalogOf([covered, uncovered]);
    expect(droppedItems(catalog, states, uncovered, ['passport', 'passport'])).toEqual([
      { documentId: 'passport', title: 'Document passport' },
    ]);
  });
});

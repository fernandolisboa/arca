import { type CatalogEntry, type DecisionStates, type RouteCatalog } from './catalog.js';

/** A keeper's mark on one document item for one person (spec #519): had, or still missing. */
export const markStates = ['had', 'missing'] as const;
export type MarkState = (typeof markStates)[number];

/** Of the items a list shows, how many its keeper marked as had. */
export interface ChecklistProgress {
  readonly had: number;
  readonly total: number;
}

/** One list's progress: every item it shows counts, and only a `had` mark is done. */
export function listProgress(
  items: readonly { readonly documentId: string }[],
  stateOf: (documentId: string) => MarkState | undefined,
): ChecklistProgress {
  return {
    had: items.filter(({ documentId }) => stateOf(documentId) === 'had').length,
    total: items.length,
  };
}

/**
 * The route's progress over every list, or none when the viewer cannot see some list's marks,
 * so a hidden list never reads as nothing done.
 */
export function routeProgress(
  lists: readonly (ChecklistProgress | null)[],
): ChecklistProgress | null {
  let had = 0;
  let total = 0;
  for (const list of lists) {
    if (list === null) return null;
    had += list.had;
    total += list.total;
  }
  return { had, total };
}

/** A marked item the version in effect no longer lists, with its title where an older one had it. */
export interface DroppedItem {
  readonly documentId: string;
  /** From the newest earlier active version that listed the item; absent when none did. */
  readonly title?: string;
}

/**
 * The marked item IDs the version in effect no longer lists (spec #519): marks follow item IDs, so
 * a mark survives a version that keeps its item and reads as no longer asked once one drops it.
 * Only active versions are read for the old title (rule 5).
 */
export function droppedItems(
  catalog: RouteCatalog,
  states: DecisionStates,
  entry: CatalogEntry,
  markedIds: readonly string[],
): readonly DroppedItem[] {
  const listed = new Set(entry.version.documents?.map(({ id }) => id));
  const earlier = catalog
    .identities(entry.identity.routeId)
    .filter(({ number }) => number < entry.identity.number)
    .sort((left, right) => right.number - left.number)
    .flatMap((identity) => catalog.activeEntry(identity, states) ?? []);
  return [...new Set(markedIds)]
    .filter((documentId) => !listed.has(documentId))
    .map((documentId) => {
      const title = earlier
        .flatMap(({ version }) => version.documents ?? [])
        .find(({ id }) => id === documentId)?.title;
      return title === undefined ? { documentId } : { documentId, title };
    });
}

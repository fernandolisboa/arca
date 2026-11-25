import type { OpenedDocument } from './documents.js';

/** The view of every document; a country's view is its code, which is never this long. */
export const allDocuments = 'all';
/** The view of the documents filed under no country. */
export const unfiledDocuments = 'unfiled';

/** What the documents list shows: every document, those under no country, or one country's. */
export type CountryView = string;

export interface CountryShelves {
  readonly total: number;
  /** Documents under no country. */
  readonly unfiled: number;
  /** Each country with a document, and the one looked at even while it has none, in code order. */
  readonly countries: readonly { readonly code: string; readonly count: number }[];
}

const isCountry = (view: CountryView) => view !== allDocuments && view !== unfiledDocuments;

export function countryShelves(
  documents: readonly OpenedDocument[],
  view: CountryView,
): CountryShelves {
  const counts = new Map<string, number>(isCountry(view) ? [[view, 0]] : []);
  for (const { document } of documents) {
    for (const code of document.countries) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return {
    total: documents.length,
    unfiled: documents.filter(({ document }) => document.countries.length === 0).length,
    countries: [...counts]
      .map(([code, count]) => ({ code, count }))
      .sort((left, right) => left.code.localeCompare(right.code)),
  };
}

export function inView(
  documents: readonly OpenedDocument[],
  view: CountryView,
): readonly OpenedDocument[] {
  if (view === allDocuments) return documents;
  return documents.filter(({ document }) =>
    view === unfiledDocuments ? document.countries.length === 0 : document.countries.includes(view),
  );
}

/**
 * The documents a country can take from the vault: the account's own, since only an owner files a
 * document, named, so the person knows what they pick, and not under the country yet.
 */
export const documentsToBring = (
  documents: readonly OpenedDocument[],
  country: string,
  accountId: string,
): readonly OpenedDocument[] =>
  documents.filter(
    ({ document, label }) =>
      document.ownerId === accountId &&
      label !== undefined &&
      !document.countries.includes(country),
  );

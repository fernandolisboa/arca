/** A field's box at the touch target's height, shared by the native select and the search picker. */
export const fieldControlClass =
  'min-h-touch rounded-control border border-line bg-surface px-3 text-body text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** A name in plain form for a search: no accents, lowercase, no surrounding spaces. */
const plain = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** Whether a name answers a search, ignoring accents and case: any name for an empty one. */
export function matchesSearch(name: string, search: string): boolean {
  return plain(name).includes(plain(search));
}

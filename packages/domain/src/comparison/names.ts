/** A criterion name as two names are compared: lower case, without accents or outer spaces. */
export function plainName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * The items whose names are not alike any of `taken` nor any earlier item's, compared with
 * `plainName`; the first of two alike stays.
 */
export function newlyNamed<Item extends { readonly name: string }>(
  items: readonly Item[],
  taken: readonly string[],
): Item[] {
  const seen = new Set(taken.map(plainName));
  return items.filter(({ name }) => {
    const key = plainName(name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

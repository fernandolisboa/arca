/** Text as a search compares it: lower case, without accents or outer spaces. */
const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** Whether a country's name answers a search: any name for an empty one, else a name holding it. */
export function matchesSearch(name: string, search: string): boolean {
  return plain(name).includes(plain(search));
}

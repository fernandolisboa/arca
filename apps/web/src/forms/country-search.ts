import { plainName as plain } from '@arca/api-contract/client';

/** Whether a name answers a search, ignoring accents and case: any name for an empty one, else a name holding it. */
export function matchesSearch(name: string, search: string): boolean {
  return plain(name).includes(plain(search));
}

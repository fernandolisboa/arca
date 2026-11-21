import { plainName as plain } from '@arca/api-contract/client';

/** Whether a country's name answers a search: any name for an empty one, else a name holding it. */
export function matchesSearch(name: string, search: string): boolean {
  return plain(name).includes(plain(search));
}

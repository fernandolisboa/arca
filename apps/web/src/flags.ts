/**
 * Every flag of the bundled set as its own file, fetched when first shown: never inlined into the
 * script and never precached, since a screen shows a handful of the catalog's countries.
 */
const files = import.meta.glob<string>('../node_modules/flag-icons/flags/4x3/*.svg', {
  eager: true,
  query: '?url&no-inline',
  import: 'default',
});

/** The flag file of an ISO 3166-1 alpha-2 code, in either case; none for a code the set lacks. */
export function flagUrl(code: string): string | undefined {
  if (!/^[a-z]{2}$/i.test(code)) return undefined;
  return files[`../node_modules/flag-icons/flags/4x3/${code.toLowerCase()}.svg`];
}

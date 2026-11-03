/** The CLDR release the countries files come from, and its English territories file (spec 0002, R7). */
export const cldr = {
  release: '49.0.0',
  sha256: '1326fb3bcdf8b8cf63df73ea02ea7f8bf7a8362cbb60bd12bcdb53f3ad22bf04',
  licenseSha256: '220ba0e1c43b99530d2d5bdb892a99dca0989414f51ab695ecd90163eaa1ec3b',
} as const;

/** Region codes CLDR lists that are not countries a person holds or lives in. */
export const excludedRegions: ReadonlySet<string> = new Set([
  // Groupings.
  'EU',
  'EZ',
  'UN',
  // Pseudo-regions for testing.
  'XA',
  'XB',
  // Outlying Oceania and the unknown region.
  'QO',
  'ZZ',
  // Exceptionally reserved codes.
  'AC',
  'CP',
  'CQ',
  'DG',
  'EA',
  'IC',
  'TA',
]);

/** Reviewed changes to the previous countries file, applied by the next regeneration. */
export interface Reclassification {
  /** Codes a new CLDR release adds that are countries; the rest go in `excludedRegions`. */
  readonly admitted: ReadonlySet<string>;
  /** Codes of the previous file a new release drops, acknowledged before they are left out. */
  readonly withdrawn: ReadonlySet<string>;
}

export const reclassification: Reclassification = { admitted: new Set(), withdrawn: new Set() };

const numericRegion = /^[0-9]{3}$/;
const alpha2 = /^[A-Z]{2}$/;

/** The region codes of a CLDR territories file; display variants (`GB-alt-short`) are not codes. */
export function regionCodes(territories: unknown): string[] {
  const names = (
    territories as { main?: { en?: { localeDisplayNames?: { territories?: unknown } } } }
  ).main?.en?.localeDisplayNames?.territories;
  if (typeof names !== 'object' || names === null) {
    throw new Error('The file has no main.en.localeDisplayNames.territories');
  }
  return Object.keys(names).filter((code) => !code.includes('-alt-'));
}

export interface Classification {
  readonly included: readonly string[];
  /** Codes neither excluded, admitted nor in the previous file; a reviewer must classify them. */
  readonly unclassified: readonly string[];
  /** Codes of the previous file the release no longer includes and nobody withdrew. */
  readonly removed: readonly string[];
}

/**
 * Splits CLDR's region codes into the countries file's codes and the excluded ones. With a
 * previous file, a code it does not have is unclassified until a reviewed change admits or
 * excludes it, and a code it has that is no longer included is removed until one withdraws it;
 * the first file has no predecessor, so its whole list is the baseline its own review checks.
 */
export function classifyRegions(
  codes: readonly string[],
  previous: readonly string[] | undefined,
  { admitted, withdrawn }: Reclassification = reclassification,
): Classification {
  const included: string[] = [];
  const unclassified: string[] = [];
  for (const code of codes) {
    if (numericRegion.test(code) || excludedRegions.has(code)) continue;
    const known = previous === undefined || previous.includes(code) || admitted.has(code);
    if (!alpha2.test(code) || !known) {
      unclassified.push(code);
    } else {
      included.push(code);
    }
  }
  const removed = (previous ?? []).filter(
    (code) => !included.includes(code) && !withdrawn.has(code),
  );
  return { included: included.sort(), unclassified: unclassified.sort(), removed: removed.sort() };
}

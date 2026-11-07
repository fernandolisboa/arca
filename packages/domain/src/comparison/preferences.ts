import {
  type ComparisonPreferences,
  type ComparisonPreferencesRequest,
  comparisonPreferencesSchema,
} from './schema.js';

const ownPrefix = 'own-';

/** Drops the entries of an own criterion the person no longer has; the version's stay. */
function keptKeys<T>(record: Readonly<Record<string, T>>, own: ReadonlySet<string>) {
  return Object.fromEntries(
    Object.entries(record).filter(([id]) => !id.startsWith(ownPrefix) || own.has(id)),
  );
}

/**
 * The preferences a write leaves (ADR-0026): a new own criterion gets an ID from `newId`, and the
 * weights and ratings of an own criterion the request drops go with it. A hidden country that is
 * no longer among `countries`, the ones the comparison scores, goes too, since the screen cannot
 * show it again. Undefined when the request names an own criterion the person does not have, so a
 * client never picks an ID itself.
 */
export function nextPreferences(
  stored: ComparisonPreferences,
  request: ComparisonPreferencesRequest,
  newId: () => string,
  countries: readonly string[],
): ComparisonPreferences | undefined {
  const known = new Set(stored.ownCriteria.map(({ id }) => id));
  if (request.ownCriteria.some(({ id }) => id !== undefined && !known.has(id))) return undefined;
  const taken = new Set([
    ...known,
    ...Object.keys(request.weights),
    ...Object.keys(request.ratings),
  ]);
  const ownCriteria = request.ownCriteria.map(({ id, name }) => {
    if (id !== undefined) return { id, name };
    let fresh = newId();
    while (taken.has(fresh)) fresh = newId();
    taken.add(fresh);
    return { id: fresh, name };
  });
  const own = new Set(ownCriteria.map(({ id }) => id));
  const compared = new Set(countries);
  const parsed = comparisonPreferencesSchema.safeParse({
    weights: keptKeys(request.weights, own),
    ratings: keptKeys(request.ratings, own),
    ownCriteria,
    hidden: request.hidden.filter((country) => compared.has(country)),
  });
  return parsed.success ? parsed.data : undefined;
}

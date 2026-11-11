import type { KnowledgeVersion } from '@arca/api-contract/client';

type Checked = Pick<KnowledgeVersion, 'check' | 'points'>;

/** What a proposed version asks of the admin, most urgent first. */
export const reviewNeeds = ['differs', 'ready', 'unread', 'unchecked'] as const;
export type ReviewNeed = (typeof reviewNeeds)[number];

/**
 * A point that differs from its source needs the admin; a clean check can be approved; a report
 * with points it could not confirm needs reading; and a version with no current report waits.
 */
export function reviewNeed({ check, points }: Checked): ReviewNeed {
  if (points !== null && points.differs > 0) return 'differs';
  if (check === 'checked') return 'ready';
  return points === null ? 'unchecked' : 'unread';
}

/** A need the admin can act on now, so the list points at its first version. */
export const actionable = (need: ReviewNeed): boolean => need === 'differs' || need === 'ready';

const rank = (need: ReviewNeed) => reviewNeeds.indexOf(need);

/** The rank of a sorted list's most urgent version. */
const headRank = (sorted: readonly Checked[]) => {
  const [head] = sorted;
  return head === undefined ? reviewNeeds.length : rank(reviewNeed(head));
};

/** One country's proposed versions, in the order to review them. */
export interface CountryGroup<V> {
  readonly country: string;
  readonly versions: readonly V[];
}

/**
 * Proposed versions grouped by country, in the order to review them: inside a country, by need,
 * then by how many points differ, then by title; countries by their most urgent version, then by
 * name. `name` gives a country's display name.
 */
export function reviewOrder<V extends Checked & Pick<KnowledgeVersion, 'country' | 'title'>>(
  versions: readonly V[],
  name: (country: string) => string,
): readonly CountryGroup<V>[] {
  const byTitle = (left: V, right: V) => left.title.localeCompare(right.title);
  const compare = (left: V, right: V) =>
    rank(reviewNeed(left)) - rank(reviewNeed(right)) ||
    (right.points?.differs ?? 0) - (left.points?.differs ?? 0) ||
    byTitle(left, right);
  const groups = new Map<string, V[]>();
  for (const version of versions) {
    groups.set(version.country, [...(groups.get(version.country) ?? []), version]);
  }
  return [...groups]
    .map(([country, listed]) => ({ country, versions: listed.toSorted(compare) }))
    .toSorted(
      (left, right) =>
        headRank(left.versions) - headRank(right.versions) ||
        name(left.country).localeCompare(name(right.country)),
    );
}

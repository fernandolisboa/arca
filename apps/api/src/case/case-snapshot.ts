import { type CalendarDate, buildCaseSnapshot } from '@arca/domain';
import type { RuleTexts } from '@arca/knowledge';
import type { CaseRows } from './view.js';

/**
 * The viewer's case as the engine reads it (spec 0007, R6): the snapshot of the rows row-level
 * security returned, with its opaque person IDs mapped back to the case's UUIDs, the people the
 * viewer keeps and those whose birth date is answered, which the decisive questions read.
 */
export function viewedSnapshot(rows: CaseRows, today: CalendarDate) {
  const { snapshot, personIds } = buildCaseSnapshot(rows, today);
  const uuids = new Map([...personIds].map(([uuid, opaque]) => [opaque, uuid]));
  const uuid = (opaque: string) => {
    const found = uuids.get(opaque);
    if (found === undefined) throw new Error('A result names a person not in the case');
    return found;
  };
  const kept = new Set(
    rows.people.filter((person) => person.keptByMe).flatMap(({ id }) => personIds.get(id) ?? []),
  );
  const bornOn = new Set(
    snapshot.people.filter(({ birthDate }) => birthDate !== undefined).map(({ id }) => id),
  );
  return { snapshot, personIds, uuid, kept, bornOn };
}

/** A version's text in the screen's language, with its own English beside it when translated. */
export const translatedText =
  (texts: RuleTexts | undefined, routeId: string) =>
  (english: string): { readonly text: string; readonly original: string | null } => {
    const shown = texts?.(routeId, english);
    return shown === undefined
      ? { text: english, original: null }
      : { text: shown, original: english };
  };

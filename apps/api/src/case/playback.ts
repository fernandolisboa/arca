import type { CasePlayback } from '@arca/api-contract/routes';
import { type CalendarDate, buildCaseSnapshot, describeCase, renamePeople } from '@arca/domain';
import { type CaseRows, sharedWith } from './view.js';

/**
 * The case read back for the viewer (spec 0007, R5). What the viewer sees of a person comes from
 * keeping them or from a share, not from a row being there, so a shared profile nobody filled in
 * reads as unanswered and one never shared reads as not shared.
 */
export function casePlayback(rows: CaseRows, accountId: string, at: CalendarDate): CasePlayback {
  const { snapshot, personIds } = buildCaseSnapshot(rows, at);
  const visibility = new Map(
    rows.people.flatMap((person) => {
      const opaque = personIds.get(person.id);
      if (opaque === undefined) return [];
      const shared = sharedWith(rows, accountId, person.id);
      return [
        [
          opaque,
          {
            profile: person.keptByMe || shared.includes('profile'),
            finances: person.keptByMe || shared.includes('finances'),
          },
        ],
      ];
    }),
  );
  const uuids = new Map([...personIds].map(([uuid, opaque]) => [opaque, uuid]));
  return {
    sentences: renamePeople(describeCase(snapshot, visibility, at), (opaque) => {
      const uuid = uuids.get(opaque);
      if (uuid === undefined) throw new Error('A sentence names a person not in the case');
      return uuid;
    }),
  };
}

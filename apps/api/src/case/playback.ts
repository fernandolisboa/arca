import type { CasePlayback } from '@arca/api-contract/routes';
import {
  type CalendarDate,
  type PlaybackVisibility,
  buildCaseSnapshot,
  describeCase,
  renamePeople,
} from '@arca/domain';
import { type CaseRows, sharedWith } from './view.js';

/**
 * What the viewer sees of each person, by the snapshot's person ID. It comes from keeping them or
 * from a share, not from a row being there, so a shared profile nobody filled in reads as
 * unanswered and one never shared reads as not shared.
 */
export function playbackVisibility(
  rows: CaseRows,
  accountId: string,
  personIds: ReadonlyMap<string, string>,
): PlaybackVisibility {
  return new Map(
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
}

/** The case read back for the viewer (spec 0007, R5). */
export function casePlayback(rows: CaseRows, accountId: string, at: CalendarDate): CasePlayback {
  const { snapshot, personIds } = buildCaseSnapshot(rows, at);
  const uuids = new Map([...personIds].map(([uuid, opaque]) => [opaque, uuid]));
  return {
    sentences: renamePeople(
      describeCase(snapshot, playbackVisibility(rows, accountId, personIds), at),
      (opaque) => {
        const uuid = uuids.get(opaque);
        if (uuid === undefined) throw new Error('A sentence names a person not in the case');
        return uuid;
      },
    ),
  };
}

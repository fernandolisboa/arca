import {
  type CalendarDate,
  type RecognitionHolders,
  type RecognitionTrackView,
  recognitionHolders,
} from '@arca/domain';
import { viewedSnapshot } from './case-snapshot.js';
import type { CaseRows } from './view.js';

/**
 * The people of the viewer's case each recognition track concerns (ADR-0040), from what the viewer
 * sees: a work period, job offer, registration or qualification hidden from them names nobody.
 * Only the people's IDs leave, never the facts that matched.
 */
export function caseRecognitionHolders(
  rows: CaseRows,
  tracks: readonly RecognitionTrackView[],
  today: CalendarDate,
): RecognitionHolders[] {
  const { snapshot, uuid } = viewedSnapshot(rows, today);
  return recognitionHolders(snapshot, tracks).map(({ trackId, personIds }) => ({
    trackId,
    personIds: personIds.map(uuid),
  }));
}

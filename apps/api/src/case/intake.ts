import type { CaseIntakeDraftResponse } from '@arca/api-contract/routes';
import { type Database, withIdentity } from '@arca/db';
import {
  type CalendarDate,
  type IntakeDraft,
  type MaskedIntakeText,
  type NamedPerson,
  buildCaseSnapshot,
  describeDraft,
  isNewReference,
  keepStatedDates,
  maskIntakeText,
  parseIntakeDraft,
  renameDraft,
  withWriter,
} from '@arca/domain';
import type { Logger } from '@arca/telemetry';
import { loggedModelCall, modelAttempts, parsedWithOneRetry } from '../ai/model-call.js';
import type { AuditLog } from '../audit/log.js';
import { type Extractor, ExtractorError, type ExtractorFailure } from '../intake/extractor.js';
import { playbackVisibility } from './playback.js';
import { type CaseRows, readCase } from './view.js';

export type CaseIntakeOutcome =
  | { readonly ok: true; readonly value: CaseIntakeDraftResponse }
  | { readonly ok: false; readonly reason: 'not_found' | ExtractorFailure };

/** A draft of the viewer's case from their own words (spec 0008, R3); nothing is written. */
export interface CaseIntake {
  readonly draft: (accountId: string, text: string) => Promise<CaseIntakeOutcome>;
}

export interface CaseIntakeSettings {
  /** The app_api pool, read when a request first needs it. */
  readonly db: () => Database;
  readonly audit: AuditLog;
  readonly logger: Logger;
  readonly extractor: Extractor;
  readonly today: () => CalendarDate;
  /** Monotonic milliseconds, for the model call's latency. */
  readonly now: () => number;
}

const route = '/v1/case/intake/draft';

/** What the case takes of the draft, in the case's IDs, and how many sentences it adds or changes. */
function describe(
  rows: CaseRows,
  accountId: string,
  at: CalendarDate,
  draft: IntakeDraft,
): { readonly value: CaseIntakeDraftResponse; readonly facts: number } {
  const { snapshot, personIds } = buildCaseSnapshot(rows, at);
  const kept = new Set(
    rows.people.flatMap(({ id, keptByMe }) => {
      const opaque = personIds.get(id);
      return keptByMe && opaque !== undefined ? [opaque] : [];
    }),
  );
  const described = describeDraft(
    snapshot,
    renameDraft(draft, (ref) => personIds.get(ref) ?? ref),
    kept,
    playbackVisibility(rows, accountId, personIds),
    at,
  );
  const uuids = new Map([...personIds].map(([uuid, opaque]) => [opaque, uuid]));
  return {
    value: { draft: renameDraft(described.draft, (id) => uuids.get(id) ?? id) },
    facts: described.sentences.length,
  };
}

/**
 * The member's text as a draft in the case's IDs (spec 0008, R1 to R3): masked, sent, parsed (an
 * unparsable reply is asked for again, once), its dates cut to what the text states, each
 * placeholder back to its person's ID and the writer to the viewer's own person. The model gets the
 * writer's placeholder even when the text does not name them, so "eu" has a reference. The evaluation
 * suite scores this same path.
 */
export async function readIntakeDraft(
  extractor: Extractor,
  text: string,
  people: readonly (NamedPerson & { readonly accountId: string | null })[],
  accountId: string,
  onUnparsable: () => void = () => undefined,
): Promise<IntakeDraft> {
  const writer = people.find((person) => person.accountId === accountId);
  const masked = maskIntakeText(text, people, writer?.id);
  const draft = await parsedDraft(extractor, masked, onUnparsable);
  const named = renameDraft(draft, (ref) => masked.placeholders.get(ref) ?? ref);
  return writer === undefined ? named : withWriter(named, writer.id);
}

/** Model calls one draft may take: the first and one retry on an unparsable reply. */
export const draftAttempts = modelAttempts;

async function parsedDraft(
  extractor: Extractor,
  { masked, placeholders, writer }: MaskedIntakeText,
  onUnparsable: () => void,
): Promise<IntakeDraft> {
  const known = new Set(placeholders.keys());
  return parsedWithOneRetry(
    async () => (await extractor.draft(masked, [...known], writer)).reply,
    (reply) => {
      const parsed = parseIntakeDraft(reply, known);
      return parsed === undefined ? undefined : keepStatedDates(parsed, masked);
    },
    {
      isUnparsable: (error) =>
        error instanceof ExtractorError && error.code === 'intake_unparsable',
      unparsable: () => new ExtractorError('intake_unparsable'),
      onUnparsable,
    },
  );
}

/**
 * The viewer's rows are read first and the transaction closes before the model call, so no
 * connection waits on the vendor. The text, the masked text and the reply live only in this
 * call: no log line, audit detail or error carries them.
 */
export function createCaseIntake({
  db,
  audit,
  logger,
  extractor,
  today,
  now,
}: CaseIntakeSettings): CaseIntake {
  const logged: Extractor = {
    draft: (masked, known, writer) =>
      loggedModelCall(
        () => extractor.draft(masked, known, writer),
        { route, logger, now },
        (error) =>
          error instanceof ExtractorError
            ? new ExtractorError(error.code)
            : new ExtractorError('intake_failed'),
      ),
  };
  const onUnparsable = () => {
    logger.error({ route, errorCode: 'intake_unparsable' });
  };

  return {
    async draft(accountId, text) {
      const at = today();
      const rows = await withIdentity(db(), { accountId }, (tx) => readCase(tx, accountId));
      if (rows === undefined) return { ok: false, reason: 'not_found' };
      let described: ReturnType<typeof describe>;
      try {
        described = describe(
          rows,
          accountId,
          at,
          await readIntakeDraft(logged, text, rows.people, accountId, onUnparsable),
        );
      } catch (error) {
        if (error instanceof ExtractorError) return { ok: false, reason: error.code };
        // Anything else thrown here may hold the text or the reply: only its class is logged.
        logger.error({
          route,
          errorCode: 'intake_failed',
          errorName: error instanceof Error ? `CaseIntake:${error.name}` : 'CaseIntake:NonError',
        });
        return { ok: false, reason: 'intake_failed' };
      }
      await audit.record({
        code: 'intake_drafted',
        subjectAccountId: accountId,
        actorAccountId: accountId,
        details: {
          caseId: rows.caseId,
          people: described.value.draft.people.filter(({ ref }) => isNewReference(ref)).length,
          facts: described.facts,
        },
      });
      return { ok: true, value: described.value };
    },
  };
}

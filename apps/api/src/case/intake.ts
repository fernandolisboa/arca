import type { CaseIntakeDraftResponse } from '@arca/api-contract/routes';
import { type Database, withIdentity } from '@arca/db';
import {
  type CalendarDate,
  type IntakeDraft,
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
import type { AuditLog } from '../audit/log.js';
import {
  type Extractor,
  ExtractorError,
  type ExtractorFailure,
  type ExtractorReply,
} from '../intake/extractor.js';
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
 * placeholder back to its person's ID and the writer to the viewer's own person. The evaluation
 * suite scores this same path.
 */
export async function readIntakeDraft(
  extractor: Extractor,
  text: string,
  people: readonly (NamedPerson & { readonly accountId: string | null })[],
  accountId: string,
  onUnparsable: () => void = () => undefined,
): Promise<IntakeDraft> {
  const { masked, placeholders } = maskIntakeText(text, people);
  const known = new Set(placeholders.keys());
  const draft = await parsedDraft(extractor, masked, known, onUnparsable);
  const named = renameDraft(draft, (ref) => placeholders.get(ref) ?? ref);
  const writer = people.find((person) => person.accountId === accountId);
  return writer === undefined ? named : withWriter(named, writer.id);
}

/** Model calls one draft may take: the first and one retry on an unparsable reply. */
export const draftAttempts = 2;

async function parsedDraft(
  extractor: Extractor,
  masked: string,
  known: ReadonlySet<string>,
  onUnparsable: () => void,
): Promise<IntakeDraft> {
  for (let attempt = 0; attempt < draftAttempts; attempt += 1) {
    try {
      const parsed = parseIntakeDraft((await extractor.draft(masked, [...known])).reply, known);
      if (parsed !== undefined) return keepStatedDates(parsed, masked);
      onUnparsable();
    } catch (error) {
      if (!(error instanceof ExtractorError) || error.code !== 'intake_unparsable') throw error;
    }
  }
  throw new ExtractorError('intake_unparsable');
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
  const call = async (masked: string, known: readonly string[]): Promise<ExtractorReply> => {
    const started = now();
    try {
      const reply = await extractor.draft(masked, known);
      logger.info({
        route,
        model: reply.model,
        promptVersion: reply.promptVersion,
        ...(reply.inputTokens === undefined ? {} : { inputTokens: reply.inputTokens }),
        ...(reply.outputTokens === undefined ? {} : { outputTokens: reply.outputTokens }),
        durationMs: now() - started,
      });
      return reply;
    } catch (error) {
      const code = error instanceof ExtractorError ? error.code : 'intake_failed';
      logger.error({ route, errorCode: code, durationMs: now() - started });
      throw new ExtractorError(code);
    }
  };

  const logged: Extractor = { draft: call };
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

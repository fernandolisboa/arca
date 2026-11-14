import { type ApiError, routes } from '@arca/api-contract/client';
import { api } from '../api.js';
import { commonFailure, reach } from '../requests.js';
import { startFailure } from './check-run.js';
import { ConfirmedStart } from './confirmed-start.js';
import type { KnowledgeWords } from './words.js';

/**
 * An admin's check of every version in the queue at once (ADR-0027): the server picks the
 * versions, so the screen sends no identities.
 */
export function QueuedChecks({
  queued,
  words,
}: {
  /** How many proposed versions a start would begin: no current report and no check running. */
  readonly queued: number;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  return (
    <ConfirmedStart
      offered={queued > 0}
      start={() => reach(api.call(routes.startQueuedChecks))}
      words={words}
      text={{
        button: t('knowledge.queuedChecks.button'),
        lead: t('knowledge.queuedChecks.confirmLead', { n: queued }),
        confirm: t('knowledge.queuedChecks.confirm'),
        starting: t('knowledge.queuedChecks.starting'),
        started: ({ started }) => t('knowledge.queuedChecks.started', { n: started }),
        failed: (error) => t('knowledge.checkRun.startFailure', { reason: startFailure(error) }),
      }}
    />
  );
}

const runCodes = ['corrector_off', 'corrector_not_started', 'not_admin'] as const;
const isRunCode = (code: string): code is (typeof runCodes)[number] =>
  (runCodes as readonly string[]).includes(code);

/** The owner's corrector run, started now instead of at its daily time (ADR-0029). */
export function CorrectorRun({ words }: { readonly words: KnowledgeWords }) {
  const { t } = words;
  return (
    <ConfirmedStart
      start={() => reach(api.call(routes.startCorrectorRun))}
      words={words}
      text={{
        button: t('knowledge.correctorRun.button'),
        lead: t('knowledge.correctorRun.confirmLead'),
        confirm: t('knowledge.correctorRun.confirm'),
        starting: t('knowledge.correctorRun.starting'),
        started: () => t('knowledge.correctorRun.started'),
        failed: (error) =>
          t('knowledge.correctorRun.failure', {
            reason: commonFailure(error, ({ code }: ApiError) =>
              isRunCode(code) ? code : undefined,
            ),
          }),
      }}
    />
  );
}

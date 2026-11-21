import { SuggestedCriteria } from '@arca/api-contract/routes';
import { newlyNamed } from '@arca/domain';
import type { Logger } from '@arca/telemetry';
import { type ModelCallLog, loggedModelCall, parsedWithOneRetry } from '../../ai/model-call.js';
import { type CriterionSuggester, SuggesterError, type SuggesterFailure } from './suggester.js';

export type SuggestionOutcome =
  | { readonly ok: true; readonly value: SuggestedCriteria }
  | { readonly ok: false; readonly reason: SuggesterFailure };

/** Criteria a model suggests for the comparison screen; nothing is stored. */
export interface CriterionSuggestions {
  readonly suggest: (known: readonly string[]) => Promise<SuggestionOutcome>;
}

const route = '/v1/comparison/suggestions';

/** Text the screen never shows as a criterion name: digits, links, markup or angle brackets. */
const unfit = /\d|https?:|www\.|[*#_`<>[\]]/u;

/**
 * The suggestions fit to show: none named like a known criterion or like an earlier suggestion,
 * and none carrying digits, links or markup, whatever the prompt asked.
 */
export function unknownSuggestions(
  { suggestions }: SuggestedCriteria,
  known: readonly string[],
): SuggestedCriteria {
  return {
    suggestions: newlyNamed(
      suggestions.filter(({ name }) => !unfit.test(name)),
      known,
    ),
  };
}

/**
 * Asks the model once, and once more when the reply does not parse. The names sent and the reply
 * never reach a log line or an error; the call is logged with its metadata alone.
 */
export function createCriterionSuggestions({
  suggester,
  logger,
  now,
}: {
  readonly suggester: CriterionSuggester;
  readonly logger: Logger;
  readonly now: ModelCallLog['now'];
}): CriterionSuggestions {
  return {
    async suggest(known) {
      try {
        const parsed = await parsedWithOneRetry(
          async () =>
            (
              await loggedModelCall(
                () => suggester.suggest(known),
                { route, logger, now },
                (error) =>
                  error instanceof SuggesterError
                    ? new SuggesterError(error.code)
                    : new SuggesterError('suggestions_failed'),
              )
            ).reply,
          (reply) => {
            const result = SuggestedCriteria.safeParse(reply);
            return result.success ? result.data : undefined;
          },
          {
            isUnparsable: (error) =>
              error instanceof SuggesterError && error.code === 'suggestions_unparsable',
            unparsable: () => new SuggesterError('suggestions_unparsable'),
            onUnparsable: () => {
              logger.error({ route, errorCode: 'suggestions_unparsable' });
            },
          },
        );
        return { ok: true, value: unknownSuggestions(parsed, known) };
      } catch (error) {
        if (error instanceof SuggesterError) return { ok: false, reason: error.code };
        throw error;
      }
    },
  };
}

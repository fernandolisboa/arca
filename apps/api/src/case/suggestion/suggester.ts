import type { ModelReply } from '../../ai/model-call.js';

/**
 * The `CriterionSuggester` port: reads the names of the criteria the comparison screen already
 * shows, catalog text with no case data, and answers other country-level criteria with starting
 * weights. An adapter answers the model's reply as data for the API to parse, or throws a
 * `SuggesterError` that carries a fixed code and nothing of the request or the reply.
 */
export interface CriterionSuggester {
  suggest(known: readonly string[]): Promise<ModelReply>;
}

export type SuggesterFailure =
  | 'suggestions_unparsable'
  | 'suggestions_timeout'
  | 'suggestions_unavailable'
  | 'suggestions_failed';

export class SuggesterError extends Error {
  override name = 'SuggesterError';
  readonly code: SuggesterFailure;
  constructor(code: SuggesterFailure) {
    super(code);
    this.code = code;
  }
}

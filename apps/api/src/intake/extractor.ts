import type { ModelReply } from '../ai/model-call.js';

/**
 * The `Extractor` port (spec 0008, R1): turns a member's masked text into a draft of guided
 * answers. An adapter answers the model's reply as data for the API to parse, or throws an
 * `ExtractorError` that carries a fixed code and nothing of the request or the reply.
 */
export interface Extractor {
  /** `knownPlaceholders` holds the writer's placeholder, when there is one, as well. */
  draft(
    maskedText: string,
    knownPlaceholders: readonly string[],
    writerPlaceholder?: string,
  ): Promise<ExtractorReply>;
}

/** Its `reply` is untrusted: the API parses it against the closed draft schema. */
export type ExtractorReply = ModelReply;

export type ExtractorFailure =
  'intake_unparsable' | 'intake_timeout' | 'intake_unavailable' | 'intake_failed';

export class ExtractorError extends Error {
  override name = 'ExtractorError';
  readonly code: ExtractorFailure;
  constructor(code: ExtractorFailure) {
    super(code);
    this.code = code;
  }
}

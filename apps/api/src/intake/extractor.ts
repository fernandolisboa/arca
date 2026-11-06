/**
 * The `Extractor` port (spec 0008, R1): turns a member's masked text into a draft of guided
 * answers. An adapter answers the model's reply as data for the API to parse, or throws an
 * `ExtractorError` that carries a fixed code and nothing of the request or the reply.
 */
export interface Extractor {
  draft(maskedText: string, knownPlaceholders: readonly string[]): Promise<ExtractorReply>;
}

export interface ExtractorReply {
  /** Untrusted: the API parses it against the closed draft schema. */
  readonly reply: unknown;
  readonly model: string;
  readonly promptVersion: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export const extractorFailures = [
  'intake_unparsable',
  'intake_timeout',
  'intake_unavailable',
  'intake_failed',
] as const;
export type ExtractorFailure = (typeof extractorFailures)[number];

export class ExtractorError extends Error {
  override name = 'ExtractorError';
  readonly code: ExtractorFailure;
  constructor(code: ExtractorFailure) {
    super(code);
    this.code = code;
  }
}

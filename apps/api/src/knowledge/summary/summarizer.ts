/**
 * The `Summarizer` port (ADR-0025): reads one route version's content, public rule data with no
 * case data, and answers a short summary for the approver. An adapter answers the model's reply as
 * data for the API to parse, or throws a `SummarizerError` that carries a fixed code and nothing of
 * the request or the reply.
 */
export interface Summarizer {
  /** `content` is the version as JSON, without its state or anything about today's selection. */
  summarize(content: string): Promise<SummarizerReply>;
}

export interface SummarizerReply {
  /** Untrusted: the API parses it against the closed summary schema. */
  readonly reply: unknown;
  readonly model: string;
  readonly promptVersion: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export type SummarizerFailure =
  'summary_unparsable' | 'summary_timeout' | 'summary_unavailable' | 'summary_failed';

export class SummarizerError extends Error {
  override name = 'SummarizerError';
  readonly code: SummarizerFailure;
  constructor(code: SummarizerFailure) {
    super(code);
    this.code = code;
  }
}

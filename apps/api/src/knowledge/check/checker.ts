import type { CheckFailure, CheckItemKind } from '@arca/domain';
import type { ModelReply } from '../../ai/model-call.js';

/** What the checker reads: public rule data and official pages, never case data (ADR-0027). */
export interface RuleCheckRequest {
  /** The version as the activation view lays it out, without its hash, state or rule cases. */
  readonly version: string;
  readonly items: readonly {
    readonly key: string;
    readonly kind: CheckItemKind;
    readonly title: string;
    readonly urls: readonly string[];
  }[];
  /**
   * Each page read, as the exact text code later checks quotes against: already framed as data
   * and within the check's budget, so an adapter sends it unchanged. An excerpt holds only the
   * passages picked for the items, with a gap line wherever text was left out.
   */
  readonly pages: readonly {
    readonly url: string;
    readonly text: string;
    readonly excerpt: boolean;
  }[];
  /** The country guide as JSON, or null when the country has none. */
  readonly guide: string | null;
}

/**
 * The `RuleChecker` port (ADR-0027): answers, per item, whether the official pages it cites match
 * the rule. Its reply is untrusted data the API parses against the closed answer schema; an adapter
 * throws a `RuleCheckerError` that carries a fixed code and nothing of the request or the reply.
 * As the answer arrives, an adapter hands each entry of its `items` to `onEntry` once that entry is
 * complete, in order and once per call: untrusted too, and never a substitute for the reply.
 */
export interface RuleChecker {
  check(request: RuleCheckRequest, onEntry?: (entry: unknown) => void): Promise<ModelReply>;
}

/** A checker and what its reports are stored under. */
export interface RuleCheckerChoice {
  readonly checker: RuleChecker;
  readonly model: string;
  readonly promptVersion: string;
}

export type RuleCheckerFailure = CheckFailure;

export class RuleCheckerError extends Error {
  override name = 'RuleCheckerError';
  readonly code: RuleCheckerFailure;
  constructor(code: RuleCheckerFailure) {
    super(code);
    this.code = code;
  }
}

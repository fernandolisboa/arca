import type { AiEffort } from '@arca/api-contract/routes';
import type { ValidatorVerdict } from '@arca/domain';
import { z } from 'zod';
import type { ModelReply } from '../../ai/model-call.js';

/** A quote research gives for an item, by the item's key: the passage and the page it is on. */
export interface ResearchQuote {
  readonly key: string;
  readonly url: string;
  readonly quote: string;
}

/**
 * What research answers, still untrusted: the version and its cases as JSON text, since the rule
 * schema is recursive and structured output takes no recursive schema, and one quote per item.
 * Code parses the texts with the rule schema before anything reads them.
 */
export const researchReplySchema = z.strictObject({
  versionJson: z.string().max(400_000),
  casesJson: z.string().max(400_000),
  quotes: z
    .array(
      z.strictObject({
        key: z.string().max(120),
        url: z.string().max(2000),
        quote: z.string().max(2000),
      }),
    )
    .max(400),
});
export type ResearchReply = z.infer<typeof researchReplySchema>;

/** The JSON Schema research answers in, for the provider's structured output. */
export const researchReplyJsonSchema = z.toJSONSchema(researchReplySchema, { io: 'input' });

/**
 * What research reads (ADR-0031): public rule data and identifiers only. The route's current
 * version, its official hosts, and the quotes a previous request verified; for the correction,
 * the proposal it corrects with what code and the validator found wrong, never a person's words.
 */
export interface ResearchRequest {
  readonly routeId: string;
  /** The version the request updates, as stored. */
  readonly current: unknown;
  /** Its cases file, as stored, as an example of the cases a proposal carries. */
  readonly currentCases: unknown;
  /** The hosts research may search and fetch on, from the route's approved lists. */
  readonly officialHosts: readonly string[];
  /** Quotes an earlier request verified on their pages, as leads. */
  readonly knownQuotes: readonly ResearchQuote[];
  readonly correction?: {
    readonly proposal: ResearchReply;
    /** Why the proposal is not a version, one line each, from code. */
    readonly problems: readonly string[];
    /** The items code or the validator rejected, each with its fixed reason. */
    readonly items: readonly { readonly key: string; readonly reason: string }[];
  };
}

/** A stage's model and effort, as settings give them at call time. */
export interface StageModel {
  readonly model: string;
  readonly effort: AiEffort | null;
}

export type ResearchFailure = 'failed' | 'timeout' | 'unparsable';

export class RuleResearcherError extends Error {
  override name = 'RuleResearcherError';
  readonly code: ResearchFailure;
  constructor(code: ResearchFailure) {
    super(code);
    this.code = code;
  }
}

/** Research and correction behind one port (ADR-0004), on the model settings name. */
export interface RuleResearcher {
  readonly research: (
    request: ResearchRequest,
    model: StageModel,
  ) => Promise<ModelReply & { readonly webSearches?: number }>;
}

/** One item the validator reads: what the rule says and the quote code verified on its page. */
export interface ValidationItem {
  readonly id: string;
  readonly title: string;
  /** The values the item states, as text. */
  readonly values: readonly string[];
  readonly quote: string;
}

export interface ValidatorAnswer {
  readonly id: string;
  readonly choice: ValidatorVerdict;
  readonly confidence: number;
}

export class RuleValidatorError extends Error {
  override name = 'RuleValidatorError';
  readonly code = 'failed';
}

/** The validator behind its port (ADR-0031): one call for every item of a stage. */
export interface RuleValidator {
  readonly validate: (
    items: readonly ValidationItem[],
    model: StageModel,
  ) => Promise<ModelReply & { readonly reply: readonly ValidatorAnswer[] }>;
}

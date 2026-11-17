import type { CheckReason, CheckedItem } from '../quote-check/answers.js';

/**
 * The stages of an update request (ADR-0031), in the only order they run: research, validation,
 * at most one correction, final validation. The checks in code run inside each validation, before
 * the validator is asked.
 */
export const updateStages = ['research', 'validation', 'correction', 'final_validation'] as const;
export type UpdateStage = (typeof updateStages)[number];

/** Why a request ended with no proposal: a fixed code, never a provider's or a model's words. */
export const updateFailures = [
  'unknown_route',
  'not_configured',
  'research_failed',
  'research_timeout',
  'research_unparsable',
  'validation_failed',
  'correction_failed',
  'correction_timeout',
  'correction_unparsable',
  'final_validation_failed',
  'proposal_invalid',
  'out_of_order',
] as const;
export type UpdateFailure = (typeof updateFailures)[number];

/** What a finished stage left for the controller to decide on. */
export type StageResult =
  | { readonly stage: UpdateStage; readonly failure: UpdateFailure }
  | {
      readonly stage: UpdateStage;
      readonly failure: null;
      /** A validation's finding: an item was rejected, or the proposal itself did not pass code. */
      readonly needsCorrection: boolean;
      /** A validation's finding: the proposal passed the checks that make it a version at all. */
      readonly proposalValid: boolean;
    };

export type NextStep =
  | { readonly kind: 'run'; readonly stage: UpdateStage }
  | { readonly kind: 'finished' }
  | { readonly kind: 'failed'; readonly failure: UpdateFailure };

/** The most stages a request runs: two rounds, so no sequence of answers keeps it going. */
export const maxUpdateStages = updateStages.length;

const run = (stage: UpdateStage): NextStep => ({ kind: 'run', stage });

/**
 * The next step of an update request from its finished stages, in order (ADR-0031). Research is
 * followed by validation; a validation that rejected anything, or found the proposal itself
 * invalid, is followed by the one correction and its final validation, and any other ends the
 * request. A failed stage ends it with its code; stages out of the fixed order end it too, so no
 * stored row can buy a third round.
 */
export function nextUpdateStep(results: readonly StageResult[]): NextStep {
  if (results.length > maxUpdateStages) return { kind: 'failed', failure: 'out_of_order' };
  for (const [index, result] of results.entries()) {
    if (result.stage !== updateStages[index]) return { kind: 'failed', failure: 'out_of_order' };
    if (result.failure !== null) return { kind: 'failed', failure: result.failure };
  }
  const last = results.at(-1);
  if (last === undefined) return run('research');
  if (last.failure !== null) return { kind: 'failed', failure: last.failure };
  switch (last.stage) {
    case 'research':
      return run('validation');
    case 'validation':
      return last.needsCorrection || !last.proposalValid ? run('correction') : { kind: 'finished' };
    case 'correction':
      return run('final_validation');
    case 'final_validation':
      return last.proposalValid
        ? { kind: 'finished' }
        : { kind: 'failed', failure: 'proposal_invalid' };
  }
}

/** What the validator answers about one item: whether its verified quote states its value. */
export const validatorVerdicts = ['supports', 'contradicts', 'cannot_tell'] as const;
export type ValidatorVerdict = (typeof validatorVerdicts)[number];

/** Below this confidence a validator's answer counts as `cannot_tell` (spec #455 amendment). */
export const minValidatorConfidence = 0.5;

/** A validator's choice, taken only when it is confident enough. */
export function validatorVerdict(choice: ValidatorVerdict, confidence: number): ValidatorVerdict {
  return Number.isFinite(confidence) && confidence >= minValidatorConfidence
    ? choice
    : 'cannot_tell';
}

/** The admin's three lists (ADR-0031). */
export const proposalLists = ['confirmed', 'divergent', 'unconfirmed'] as const;
export type ProposalList = (typeof proposalLists)[number];

/** Why an item is where it is, beyond the codes in code checks. */
export type ItemOutcomeReason = CheckReason | 'validator_contradicts' | 'validator_cannot_tell';

export interface ItemOutcome {
  readonly key: string;
  readonly list: ProposalList;
  readonly reason: ItemOutcomeReason | null;
}

/**
 * Code reasons that are the research's own doing, so a correction can fix them: a quote not on
 * its page, a URL the item does not cite, a value the quote does not state. The rest (a page that
 * could not be read or was cut) are information for the admin, never a reason for another round.
 */
const researchFaults: ReadonlySet<CheckReason> = new Set<CheckReason>([
  'no_source_cited',
  'not_answered',
  'quote_count',
  'url_not_cited',
  'quote_length',
  'quote_not_on_page',
  'echoes_address',
  'value_not_in_quote',
]);

/**
 * Where an item goes, from code's check of its quote and the validator's verdict: confirmed only
 * when code verified the quote and its values on the page and the validator says the quote
 * supports it; divergent when the validator says otherwise or code caught a fault the research
 * made; unconfirmed when nobody could tell. Code's word comes first, so a fabricated quote never
 * reaches the validator and never reads as confirmed.
 */
export function itemOutcome(
  checked: CheckedItem,
  verdict: ValidatorVerdict | undefined,
): ItemOutcome {
  const { key } = checked;
  if (checked.status !== 'matches') {
    const reason = checked.reason ?? 'not_answered';
    return { key, list: researchFaults.has(reason) ? 'divergent' : 'unconfirmed', reason };
  }
  switch (verdict) {
    case 'supports':
      return { key, list: 'confirmed', reason: null };
    case 'contradicts':
      return { key, list: 'divergent', reason: 'validator_contradicts' };
    default:
      return { key, list: 'unconfirmed', reason: 'validator_cannot_tell' };
  }
}

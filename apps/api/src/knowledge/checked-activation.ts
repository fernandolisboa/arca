import type { ActivateCheckedResponse } from '@arca/api-contract/routes';
import {
  type BatchListedVersion,
  type CheckedBatchSkip,
  type ShownVersion,
  type SkippedVersion,
  checkedBatch,
} from '@arca/domain';
import type { SignedIn } from '../auth/service.js';
import type { DecisionOutcome, KnowledgeDecisions } from './decisions.js';

export interface CheckedActivation {
  /**
   * Activates each shown version that is still proposed, matches the bundled hash and has a clean
   * current report, one decision each (ADR-0027); names every other one with a reason.
   */
  readonly activate: (
    signedIn: SignedIn,
    shown: readonly ShownVersion[],
  ) => Promise<ActivateCheckedResponse>;
}

export interface CheckedActivationSettings {
  /** Every bundled route version with its state and check status, as the screen lists them. */
  readonly listed: () => Promise<readonly BatchListedVersion[]>;
  readonly decisions: Pick<KnowledgeDecisions, 'decide'>;
}

const refusedSkips = {
  not_admin: 'not_admin',
  not_found: 'not_found',
  already_rejected: 'rejected',
} as const satisfies Record<
  Extract<DecisionOutcome, { refused: string }>['refused'],
  CheckedBatchSkip
>;

export function createCheckedActivation({
  listed,
  decisions,
}: CheckedActivationSettings): CheckedActivation {
  return {
    async activate(signedIn, shown) {
      const { activate: toActivate, skipped } = checkedBatch(shown, await listed());
      const activated: ActivateCheckedResponse['activated'][number][] = [];
      const refused: SkippedVersion[] = [];
      // One at a time, through the single decision's path: each is its own decision row and audit
      // event, stored after its own admin check, as a tap on that version would store it.
      for (const { routeId, number } of toActivate) {
        const outcome = await decisions.decide(signedIn, 'activate', {
          subject: 'route',
          routeId,
          number,
        });
        if ('decided' in outcome) activated.push({ routeId, number, decisionId: outcome.decided });
        else refused.push({ routeId, number, reason: refusedSkips[outcome.refused] });
      }
      return { activated, skipped: [...skipped, ...refused] };
    },
  };
}

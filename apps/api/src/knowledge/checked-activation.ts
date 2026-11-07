import type { ActivateCheckedResponse } from '@arca/api-contract/routes';
import {
  type CheckedBatchSkip,
  type ListedCheckStatus,
  type ShownVersion,
  checkedBatch,
  versionKey,
} from '@arca/domain';
import type { SignedIn } from '../auth/service.js';
import type { DecisionOutcome, KnowledgeDecisions } from './decisions.js';
import type { KnowledgeVersions } from './versions.js';

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
  readonly versions: Pick<KnowledgeVersions, 'list'>;
  /** Each route version's check status, by `routeId/number`; none where no check runs. */
  readonly statuses: () => Promise<ReadonlyMap<string, ListedCheckStatus>>;
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
  versions,
  statuses,
  decisions,
}: CheckedActivationSettings): CheckedActivation {
  return {
    async activate(signedIn, shown) {
      const [listed, checks] = await Promise.all([versions.list(), statuses()]);
      const { activate, skipped } = checkedBatch(
        shown,
        listed.map((version) => ({ ...version, check: checks.get(versionKey(version)) ?? 'none' })),
      );
      const activated: ActivateCheckedResponse['activated'][number][] = [];
      // One at a time, through the single decision's path: each is its own decision row and audit
      // event, stored after its own admin check, as a tap on that version would store it.
      for (const { routeId, number } of activate) {
        const outcome = await decisions.decide(signedIn, 'activate', {
          subject: 'route',
          routeId,
          number,
        });
        if ('decided' in outcome) activated.push({ routeId, number, decisionId: outcome.decided });
        else skipped.push({ routeId, number, reason: refusedSkips[outcome.refused] });
      }
      return { activated, skipped };
    },
  };
}

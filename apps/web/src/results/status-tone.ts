import type { RouteResult } from '@arca/api-contract/client';
import type { StatusTone } from '@arca/ui';

/** The chip tone of a route status, wherever one shows. */
export const statusTones: Record<RouteResult['status'], StatusTone> = {
  eligible: 'ok',
  needs_assessment: 'warn',
  missing_information: 'warn',
  pending_activation: 'warn',
  not_eligible: 'unknown',
  unavailable: 'unknown',
};

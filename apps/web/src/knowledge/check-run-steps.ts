import type { CheckProgress } from '@arca/api-contract/client';

export const checkRunSteps = ['read', 'locate', 'compare', 'report'] as const;
export type CheckRunStep = (typeof checkRunSteps)[number];

/** `skipped` when the check had no use for the step; `stopped` where a check ended early. */
export type CheckRunStepStatus = 'done' | 'current' | 'pending' | 'skipped' | 'stopped';

const stageSteps = { starting: 'read', reading: 'read', locating: 'locate', comparing: 'compare' };

/**
 * Each step of a check as the progress screen lists it. A running check is at the step of its
 * stage; a failed or dead one stopped there; a finished one skipped whatever it never entered,
 * such as picking passages when no page was long.
 */
export function checkRunStepStatuses(
  progress: Pick<CheckProgress, 'state' | 'stage' | 'locatedPages'>,
): Record<CheckRunStep, CheckRunStepStatus> {
  const at = checkRunSteps.indexOf(stageSteps[progress.stage] as CheckRunStep);
  const finished = progress.state === 'finished';
  const entered = (step: CheckRunStep) =>
    step === 'locate' ? progress.locatedPages !== null : checkRunSteps.indexOf(step) <= at;
  const statusOf = (step: CheckRunStep): CheckRunStepStatus => {
    const position = checkRunSteps.indexOf(step);
    if (step === 'report') return finished ? 'done' : 'pending';
    if (finished) return entered(step) ? 'done' : 'skipped';
    if (position < at) return entered(step) ? 'done' : 'skipped';
    if (position > at) return 'pending';
    return progress.state === 'running' ? 'current' : 'stopped';
  };
  return {
    read: statusOf('read'),
    locate: statusOf('locate'),
    compare: statusOf('compare'),
    report: statusOf('report'),
  };
}

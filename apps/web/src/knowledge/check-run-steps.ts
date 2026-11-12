import type { CheckProgress } from '@arca/api-contract/client';
import { type ReportItem, shownPoints } from './step-checks.js';

export const checkRunSteps = ['read', 'locate', 'compare', 'report'] as const;
export type CheckRunStep = (typeof checkRunSteps)[number];

/** `skipped` when the check had no use for the step; `stopped` where a check ended early. */
export type CheckRunStepStatus = 'done' | 'current' | 'pending' | 'skipped' | 'stopped';

const stageSteps = {
  starting: 'read',
  reading: 'read',
  locating: 'locate',
  comparing: 'compare',
} as const satisfies Record<CheckProgress['stage'], CheckRunStep>;

/** How many cited pages are past their read, whatever its outcome. */
export const pagesSettled = ({ pages }: Pick<CheckProgress, 'pages'>): number =>
  pages.filter(({ outcome }) => outcome !== 'reading').length;

/**
 * Each step of a check as the progress screen lists it. A running check is at the step of its
 * stage; a failed or dead one stopped there; a finished one skipped whatever it never entered,
 * such as picking passages when no page was long.
 */
export function checkRunStepStatuses(
  progress: Pick<CheckProgress, 'state' | 'stage' | 'locatedPages'>,
): Record<CheckRunStep, CheckRunStepStatus> {
  const at = checkRunSteps.indexOf(stageSteps[progress.stage]);
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

/** A check's items as the comparison step shows them while it runs. */
export interface CheckRunItemsView {
  /** The answered items, as results with no quote, note or reason until the report is stored. */
  readonly answered: readonly ReportItem[];
  /** The item the check is waiting on, while it runs. */
  readonly next: CheckProgress['items'][number] | undefined;
  /** How many items are still awaited after `next`. */
  readonly left: number;
}

/**
 * The answered items in the version's order, the first one still awaited while the check runs,
 * and how many follow it. A scripted match is a test's, so it shows as not confirmed.
 */
export function checkRunItems(
  progress: Pick<CheckProgress, 'items' | 'scripted' | 'state'>,
): CheckRunItemsView {
  const answered: ReportItem[] = progress.items.flatMap(({ status, ...item }) =>
    status === null
      ? []
      : [{ ...item, status, quotes: [], note: null, reason: null, citations: [], values: [] }],
  );
  const waiting = progress.items.filter(({ status }) => status === null);
  const [next] = progress.state === 'running' ? waiting : [];
  return {
    answered: shownPoints({ items: answered, scripted: progress.scripted }),
    next,
    left: waiting.length - (next === undefined ? 0 : 1),
  };
}

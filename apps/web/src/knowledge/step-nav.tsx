import { Icon } from '@arca/ui';
import { useId, useState } from 'react';
import {
  type StepTally,
  type TallyTone,
  tallyTone,
  pointCount,
  totalTally,
} from './step-checks.js';
import type { Step, StepKey } from './steps.js';
import type { KnowledgeWords } from './words.js';

const ink: Record<TallyTone, string> = {
  ok: 'text-ok-ink',
  differs: 'text-danger-ink',
  unread: 'text-warn-ink',
};

const rowTone: Record<TallyTone, string> = {
  ok: 'bg-ok-bg/60',
  differs: 'bg-danger-bg/60',
  unread: 'bg-warn-bg',
};

const dotTone: Record<TallyTone, string> = {
  ok: 'bg-ok-ink',
  differs: 'bg-danger-ink',
  unread: 'border-[1.5px] border-warn-ink bg-surface',
};

const segmentTone: Record<TallyTone, string> = {
  ok: 'bg-ok-ink',
  differs: 'bg-danger-ink',
  unread: 'bg-warn-ink/50',
};

/** How a point or a step came out, as a shape as well as a colour. */
export function PointMark({ tone }: { readonly tone: TallyTone }) {
  if (tone === 'unread') {
    return (
      <span className={`grid size-6 shrink-0 place-items-center ${ink.unread}`}>
        <Icon name="help" size={22} />
      </span>
    );
  }
  return (
    <span
      className={`grid size-6 shrink-0 place-items-center rounded-full border border-current/30 bg-surface ${ink[tone]}`}
    >
      <Icon name={tone === 'ok' ? 'check' : 'close'} size={14} />
    </span>
  );
}

/** A tally in words, naming only the counts it has: "2 batem, 1 difere". */
export function tallyWords({ matches, differs, unread }: StepTally, words: KnowledgeWords): string {
  const { t } = words;
  return words.list([
    ...(matches > 0 ? [t('knowledge.points.matches', { n: matches })] : []),
    ...(differs > 0 ? [t('knowledge.points.differs', { n: differs })] : []),
    ...(unread > 0 ? [t('knowledge.points.unread', { n: unread })] : []),
  ]);
}

/** One dot per point, keyed by its tone and its place among the points of that tone. */
const dotsOf = (tally: StepTally): readonly { readonly key: string; readonly tone: TallyTone }[] =>
  (
    [
      ['ok', tally.matches],
      ['differs', tally.differs],
      ['unread', tally.unread],
    ] as const
  ).flatMap(([tone, count]) =>
    Array.from({ length: count }, (_, n) => ({ key: `${tone}-${String(n)}`, tone })),
  );

/** One dot per checked point, read out as the tally in words. */
export function TallyDots({
  tally,
  words,
}: {
  readonly tally: StepTally;
  readonly words: KnowledgeWords;
}) {
  return (
    <span
      role="img"
      aria-label={tallyWords(tally, words)}
      className="flex max-w-24 shrink-0 flex-wrap justify-end gap-1"
    >
      {dotsOf(tally).map(({ key, tone }) => (
        <span key={key} className={`size-2 rounded-full ${dotTone[tone]}`} />
      ))}
    </span>
  );
}

/**
 * What the independent check found across the whole version, above the steps: how many points
 * differ, which are the ones that ask for the admin, and the counts. Written from a model's
 * report, so it says so (ADR-0027).
 */
export function CheckSummary({
  tallies,
  scripted,
  words,
}: {
  readonly tallies: ReadonlyMap<StepKey, StepTally>;
  /** A test report, written with no model: the points are a test's, never a reading. */
  readonly scripted: boolean;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const titleId = useId();
  const total = totalTally(tallies.values());
  if (pointCount(total) === 0) return null;
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex flex-col">
          <p className="flex items-center gap-2 text-small text-muted">
            <Icon name="ai" size={16} />
            {t('knowledge.points.checked', { n: pointCount(total) })}
          </p>
          <h4 id={titleId} className="font-medium">
            {total.differs > 0
              ? t('knowledge.points.needYou', { n: total.differs })
              : total.unread > 0
                ? t('knowledge.points.unconfirmed', { n: total.unread })
                : t('knowledge.points.allMatch')}
          </h4>
        </div>
        <p className="text-small">{tallyWords(total, words)}</p>
      </div>
      {scripted && <p className="text-small font-medium">{t('knowledge.check.scripted')}</p>}
      <p className="text-small text-muted">{t('knowledge.points.note')}</p>
    </section>
  );
}

const stepButton =
  'flex min-h-touch w-full items-center gap-3 rounded-control px-3 text-left text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary data-current:font-medium data-current:text-ink data-current:shadow-[inset_0_0_0_1.5px_var(--arca-primary)]';

const arrowButton =
  'grid size-touch shrink-0 place-items-center rounded-control border border-line bg-surface text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:text-second';

export interface StepNavProps {
  readonly steps: readonly Step[];
  /** The current step's position in `steps`. */
  readonly index: number;
  /** The check's tally of each step that has checked points. */
  readonly tallies: ReadonlyMap<StepKey, StepTally>;
  readonly title: (step: Step) => string;
  readonly go: (step: Step | undefined) => void;
  readonly words: KnowledgeWords;
}

/**
 * The review's steps. From 1024 px, a list beside the content. Below it, a bar with the current
 * step between a previous and a next arrow, a strip with one segment per step, and the same list
 * folded behind the step's name. A step with checked points takes the tone of its worst point and
 * shows one dot per point.
 */
export function StepNav({ steps, index, tallies, title, go, words }: StepNavProps) {
  const { t } = words;
  const [open, setOpen] = useState(false);
  const listId = useId();
  const current = steps[index];
  const currentTally = current === undefined ? undefined : tallies.get(current.key);

  return (
    <nav aria-label={t('knowledge.wizard.steps')} className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 lg:hidden">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={t('knowledge.wizard.previous')}
            disabled={index === 0}
            onClick={() => {
              go(steps[index - 1]);
            }}
            className={arrowButton}
          >
            <Icon name="back" />
          </button>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => {
              setOpen((before) => !before);
            }}
            className="flex min-h-touch min-w-0 flex-1 flex-col items-center justify-center rounded-control px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <span className="text-caption text-muted">
              {t('knowledge.wizard.progress', { current: index + 1, total: steps.length })}
            </span>
            <span className="flex max-w-full items-center gap-2 font-medium">
              <span className="truncate">{current === undefined ? '' : title(current)}</span>
              {currentTally !== undefined && <TallyDots tally={currentTally} words={words} />}
              <span className={`grid transition-transform ${open ? '-rotate-90' : 'rotate-90'}`}>
                <Icon name="chevron" size={16} />
              </span>
            </span>
          </button>
          <button
            type="button"
            aria-label={t('knowledge.wizard.following')}
            disabled={index >= steps.length - 1}
            onClick={() => {
              go(steps[index + 1]);
            }}
            className={arrowButton}
          >
            <Icon name="chevron" />
          </button>
        </div>
        <div aria-hidden="true" className="flex h-2.5 items-end gap-1">
          {steps.map((step, position) => {
            const tally = tallies.get(step.key);
            return (
              <span
                key={step.key}
                className={`flex-1 rounded-full ${position === index ? 'h-2.5' : 'h-1.5'} ${
                  tally === undefined ? 'bg-track' : segmentTone[tallyTone(tally)]
                }`}
              />
            );
          })}
        </div>
      </div>
      <ol
        id={listId}
        className={`${
          open ? 'flex' : 'hidden'
        } flex-col gap-1 rounded-card border border-line bg-surface p-1 lg:sticky lg:top-4 lg:flex lg:border-0 lg:bg-transparent lg:p-0`}
      >
        {steps.map((step, position) => {
          const tally = tallies.get(step.key);
          const isCurrent = position === index;
          return (
            <li key={step.key}>
              <button
                type="button"
                aria-current={isCurrent ? 'step' : undefined}
                data-current={isCurrent || undefined}
                onClick={() => {
                  setOpen(false);
                  go(step);
                }}
                className={`${stepButton} ${
                  tally === undefined ? 'hover:bg-soft' : rowTone[tallyTone(tally)]
                }`}
              >
                {tally === undefined ? (
                  <span
                    aria-hidden="true"
                    className="grid size-6 shrink-0 place-items-center rounded-full border border-line bg-surface text-caption tabular-nums"
                  >
                    {position + 1}
                  </span>
                ) : (
                  <PointMark tone={tallyTone(tally)} />
                )}
                <span className="flex-1">{title(step)}</span>
                {tally !== undefined ? (
                  <TallyDots tally={tally} words={words} />
                ) : (
                  'count' in step && (
                    <span className="text-caption text-muted tabular-nums">{step.count}</span>
                  )
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

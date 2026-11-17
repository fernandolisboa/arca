import { Icon } from '@arca/ui';
import { useId, useState } from 'react';
import type { Step } from './steps.js';
import type { KnowledgeWords } from './words.js';

const stepButton =
  'flex min-h-touch w-full items-center gap-3 rounded-control px-3 text-left text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary data-current:font-medium data-current:text-ink data-current:shadow-[inset_0_0_0_1.5px_var(--arca-primary)]';

const arrowButton =
  'grid size-touch shrink-0 place-items-center rounded-control border border-line bg-surface text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:text-second';

export interface StepNavProps {
  readonly steps: readonly Step[];
  /** The current step's position in `steps`. */
  readonly index: number;
  readonly title: (step: Step) => string;
  readonly go: (step: Step | undefined) => void;
  readonly words: KnowledgeWords;
}

/**
 * The review's steps. From 1024 px, a list beside the content. Below it, a bar with the current
 * step between a previous and a next arrow, a strip with one segment per step, and the same list
 * folded behind the step's name.
 */
export function StepNav({ steps, index, title, go, words }: StepNavProps) {
  const { t } = words;
  const [open, setOpen] = useState(false);
  const listId = useId();
  const current = steps[index];

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
          {steps.map((step, position) => (
            <span
              key={step.key}
              className={`flex-1 rounded-full bg-track ${position === index ? 'h-2.5' : 'h-1.5'}`}
            />
          ))}
        </div>
      </div>
      <ol
        id={listId}
        className={`${
          open ? 'flex' : 'hidden'
        } flex-col gap-1 rounded-card border border-line bg-surface p-1 lg:sticky lg:top-4 lg:flex lg:border-0 lg:bg-transparent lg:p-0`}
      >
        {steps.map((step, position) => {
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
                className={`${stepButton} hover:bg-soft`}
              >
                <span
                  aria-hidden="true"
                  className="grid size-6 shrink-0 place-items-center rounded-full border border-line bg-surface text-caption tabular-nums"
                >
                  {position + 1}
                </span>
                <span className="flex-1">{title(step)}</span>
                {'count' in step && (
                  <span className="text-caption text-muted tabular-nums">{step.count}</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

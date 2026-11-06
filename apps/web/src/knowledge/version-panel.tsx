import type { VersionView } from '@arca/api-contract/client';
import type { Messages } from '@arca/i18n';
import { Button, Icon, StatusChip, menuItemClass } from '@arca/ui';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Decision } from './decision.js';
import { ExpressionTree } from './expression-tree.js';
import { stateTone } from './state-tone.js';
import { reviewSteps, sectionCounts, type Step, type StepKey } from './steps.js';
import { type KnowledgeWords, useKnowledgeWords } from './words.js';

type SectionKey = keyof Messages['knowledge']['section'];

const card = 'flex min-w-0 flex-col gap-2 rounded-control border border-line bg-surface p-4';

function Cards<T>({
  items,
  render,
  columns,
}: {
  readonly items: readonly T[];
  readonly render: (item: T) => ReactNode;
  /** `wide` for items with expression trees, which need the room before they sit side by side. */
  readonly columns: 'wide' | 'narrow';
}) {
  return (
    <ul className={`grid gap-3 ${columns === 'wide' ? '2xl:grid-cols-2' : 'md:grid-cols-2'}`}>
      {items.map(render)}
    </ul>
  );
}

/** The facts and sources an item reads, under it. */
function Reads({
  facts,
  sources,
  words,
}: {
  readonly facts?: VersionView['requirements'][number]['facts'];
  readonly sources: readonly string[];
  readonly words: KnowledgeWords;
}) {
  return (
    <div className="text-small text-muted">
      {facts !== undefined && facts.length > 0 && (
        <p>{words.t('knowledge.facts', { facts: words.list(facts.map(words.fact)) })}</p>
      )}
      {sources.length > 0 && (
        <p>{words.t('knowledge.sourceIds', { sources: words.list(sources) })}</p>
      )}
    </div>
  );
}

function Changes({ view, words }: { readonly view: VersionView; readonly words: KnowledgeWords }) {
  const { replaces } = view;
  if (replaces === null) return <p className="text-muted">{words.t('knowledge.firstVersion')}</p>;
  const lines = Object.entries(replaces.changes).flatMap(([section, change]) => {
    // Settings are named by their field; every other section by its items' IDs.
    const items = (ids: readonly string[]) =>
      words.list(section === 'settings' ? ids.map(words.field) : ids);
    const details = [
      ...(change.added.length > 0
        ? [words.t('knowledge.changeAdded', { items: items(change.added) })]
        : []),
      ...(change.removed.length > 0
        ? [words.t('knowledge.changeRemoved', { items: items(change.removed) })]
        : []),
      ...(change.changed.length > 0
        ? [words.t('knowledge.changeChanged', { items: items(change.changed) })]
        : []),
    ];
    return details.length === 0
      ? []
      : [
          words.t('knowledge.change', {
            section: words.t(`knowledge.section.${section as SectionKey}`),
            details: words.list(details),
          }),
        ];
  });
  if (lines.length === 0) {
    return <p>{words.t('knowledge.noChanges', { number: replaces.number })}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted">{words.t('knowledge.changesSince', { number: replaces.number })}</p>
      <ul className="flex flex-col gap-2">
        {lines.map((line) => (
          <li key={line} className={card}>
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function leapDayRule(rule: VersionView['leapDayBirthday']) {
  switch (rule) {
    case 'feb-28':
      return 'february';
    case 'march-1':
      return 'march';
    case null:
      return 'none';
  }
}

function Settings({ view, words }: { readonly view: VersionView; readonly words: KnowledgeWords }) {
  const { t } = words;
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      <li className={card}>
        <p>{t('knowledge.leapDay', { rule: leapDayRule(view.leapDayBirthday) })}</p>
        <Reads sources={view.leapDayBirthdaySources} words={words} />
      </li>
      {view.referenceDates.length > 0 && (
        <li className={card}>
          {t('knowledge.referenceDates', {
            dates: words.list(view.referenceDates.map(words.referenceDate)),
          })}
        </li>
      )}
      {view.closureSources.length > 0 && (
        <li className={card}>
          {t('knowledge.closureSources', { sources: words.list(view.closureSources) })}
        </li>
      )}
      <li className={card}>
        {t('knowledge.pins', {
          pins: words.list(
            [view.pins.countries, view.pins.formerCountries, ...view.pins.officialDomains].map(
              (pin) => t('knowledge.pin', { id: pin.id, number: pin.number }),
            ),
          ),
        })}
      </li>
    </ul>
  );
}

/** One step's content; the decision step closes the review with the counts and the buttons. */
function StepContent({
  step,
  view,
  words,
}: {
  readonly step: Step;
  readonly view: VersionView;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  switch (step.key) {
    case 'changes':
      return <Changes view={view} words={words} />;
    case 'settings':
      return <Settings view={view} words={words} />;
    case 'requirements':
      return (
        <Cards
          columns="wide"
          items={view.requirements}
          render={(requirement) => (
            <li key={requirement.id} className={card}>
              <p className="font-medium">{requirement.title}</p>
              <ExpressionTree expression={requirement.expression} />
              <Reads facts={requirement.facts} sources={requirement.sources} words={words} />
            </li>
          )}
        />
      );
    case 'assessments':
      return (
        <Cards
          columns="narrow"
          items={view.assessments}
          render={(assessment) => (
            <li key={assessment.id} className={card}>
              <p className="font-medium">{assessment.title}</p>
              <Reads facts={assessment.evidence} sources={assessment.sources} words={words} />
            </li>
          )}
        />
      );
    case 'dependents':
      return (
        <Cards
          columns="wide"
          items={view.dependents}
          render={(dependent) => (
            <li key={dependent.id} className={card}>
              <p className="font-medium">{dependent.title}</p>
              <p className="text-small">
                {t('knowledge.path', { path: dependent.path.map(words.step).join(' → ') })}
              </p>
              {dependent.at !== null && (
                <p className="text-small">
                  {t('knowledge.at', { at: words.referenceDate(dependent.at) })}
                </p>
              )}
              <p className="text-small text-muted">{t('knowledge.condition')}</p>
              <ExpressionTree expression={dependent.condition} />
              <Reads facts={dependent.facts} sources={dependent.sources} words={words} />
            </li>
          )}
        />
      );
    case 'costs':
      return (
        <Cards
          columns="wide"
          items={view.costs}
          render={(cost) => (
            <li key={cost.id} className={card}>
              <p className="font-medium">{cost.title}</p>
              <p className="text-small text-muted">
                {[
                  t('knowledge.appliesTo', { appliesTo: cost.appliesTo }),
                  t('knowledge.costKind', { kind: words.costKind(cost.kind) }),
                ].join(' · ')}
              </p>
              <p className="text-small text-muted">{t('knowledge.amount')}</p>
              <ExpressionTree expression={cost.amount} />
              {cost.condition !== null && (
                <>
                  <p className="text-small text-muted">{t('knowledge.onlyWhen')}</p>
                  <ExpressionTree expression={cost.condition} />
                </>
              )}
              <Reads facts={cost.facts} sources={cost.sources} words={words} />
            </li>
          )}
        />
      );
    case 'durations':
      return (
        <Cards
          columns="narrow"
          items={view.durations}
          render={(stage) => (
            <li key={stage.id} className={card}>
              <p>
                {t('knowledge.durationRange', {
                  title: stage.title,
                  min: words.duration(stage.min),
                  max: words.duration(stage.max),
                })}
              </p>
              <Reads sources={stage.sources} words={words} />
            </li>
          )}
        />
      );
    case 'countrySets':
      return (
        <Cards
          columns="narrow"
          items={view.countrySets}
          render={(set) => (
            <li key={set.id} className={card}>
              {t('knowledge.countrySet', {
                title: set.title,
                number: set.number,
                members: words.list(set.members.map(words.country)),
              })}
            </li>
          )}
        />
      );
    case 'sources':
      return (
        <Cards
          columns="narrow"
          items={view.sources}
          render={(source) => (
            <li key={source.id} className={card}>
              <p className="font-medium">{source.title}</p>
              {/* Plain text, never a link: the approver reads the full address before opening it. */}
              <p className="font-mono text-small break-all">{source.url}</p>
              <p className="text-small">
                {source.host === null
                  ? t('knowledge.noHost')
                  : t('knowledge.host', { host: source.host })}
              </p>
              <p className="text-small text-muted">
                {[
                  source.id,
                  t('knowledge.sourceKind', { kind: source.kind }),
                  t('knowledge.verifiedAt', { date: words.date(source.verifiedAt) }),
                ].join(' · ')}
              </p>
              {source.newHost && (
                <p className="font-medium text-danger-ink">{t('knowledge.newHost')}</p>
              )}
            </li>
          )}
        />
      );
    case 'cases':
      return (
        <Cards
          columns="narrow"
          items={view.cases}
          render={(ruleCase) => (
            <li key={ruleCase.id} className={card}>
              <p>
                {t('knowledge.case', {
                  id: ruleCase.id,
                  status: t('knowledge.caseStatus', { status: ruleCase.expected.status }),
                })}
              </p>
              <p className="text-small text-muted">
                {t('knowledge.caseDetails', {
                  date: words.date(ruleCase.rulesAsOf),
                  dependents: ruleCase.expected.dependents.length,
                  possible: ruleCase.expected.possibleDependents.length,
                })}
              </p>
              {ruleCase.expected.missingFacts.length > 0 && (
                <p className="text-small text-muted">
                  {t('knowledge.caseMissing', {
                    facts: words.list(ruleCase.expected.missingFacts),
                  })}
                </p>
              )}
            </li>
          )}
        />
      );
    case 'decision':
      return <DecisionStep view={view} words={words} />;
  }
}

function DecisionStep({
  view,
  words,
}: {
  readonly view: VersionView;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const checkId = useId();
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-small sm:grid-cols-4">
        {sectionCounts(view).map(({ key, count }) => (
          <div key={key} className="flex flex-col">
            <dt className="text-muted">{t(`knowledge.section.${key}`)}</dt>
            <dd className="font-medium">{t('knowledge.wizard.count', { n: count })}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby={checkId} className={card}>
        <h5 id={checkId} className="font-medium">
          {t('knowledge.check.title')}
        </h5>
        <p>{t('knowledge.check.body')}</p>
      </section>
      <div className="flex flex-col gap-1">
        <p className="text-small text-muted">{t('knowledge.hash')}</p>
        <p className="font-mono text-small break-all">{view.hash}</p>
      </div>
      <Decision view={view} words={words} />
    </div>
  );
}

/**
 * One version as data (spec 0007, R7), reviewed as a wizard: a step per section of the version,
 * named in a step list the approver can jump through, with Back and Next, and the decision last.
 */
export function VersionPanel({ view }: { readonly view: VersionView }) {
  const words = useKnowledgeWords();
  const { t } = words;
  const steps = reviewSteps(view);
  const [currentKey, setCurrentKey] = useState<StepKey>('changes');
  const [seen, setSeen] = useState<ReadonlySet<StepKey>>(() => new Set(['changes']));
  const movedRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();

  const index = Math.max(
    steps.findIndex(({ key }) => key === currentKey),
    0,
  );
  const step = steps[index] ?? { key: 'decision' };
  const next = steps[index + 1];
  const title = (target: Step) =>
    target.key === 'decision'
      ? t('knowledge.wizard.decision')
      : t(`knowledge.section.${target.key}`);

  useEffect(() => {
    if (!movedRef.current) return;
    // Focus lands on the new step's heading, so a screen reader reads where it now is.
    headingRef.current?.focus();
    currentRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [currentKey]);

  const go = (target: Step | undefined) => {
    if (target === undefined) return;
    movedRef.current = true;
    setCurrentKey(target.key);
    setSeen((before) => new Set(before).add(target.key));
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip
            tone={stateTone(view.state)}
            label={t('knowledge.state', { state: view.state })}
          />
          {view.status === 'closed' && <StatusChip tone="unknown" label={t('knowledge.closed')} />}
        </div>
        <h3 className="font-display text-title">
          {t('knowledge.versionTitle', { title: view.title, number: view.number })}
        </h3>
        <p className="text-small text-muted">
          {[
            t('knowledge.versionMeta', {
              country: words.country(view.country),
              date: words.date(view.effectiveFrom),
            }),
            ...(view.corrects === null ? [] : [t('knowledge.corrects', { number: view.corrects })]),
            t('knowledge.currency', { currency: view.currency }),
            ...(view.tags.length > 0 ? [t('knowledge.tags', { tags: words.list(view.tags) })] : []),
          ].join(' · ')}
        </p>
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10">
        <nav aria-label={t('knowledge.wizard.steps')}>
          <ol className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:sticky lg:top-4 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0">
            {steps.map((item, position) => {
              const current = position === index;
              return (
                <li key={item.key} className="shrink-0">
                  <button
                    ref={current ? currentRef : undefined}
                    type="button"
                    aria-current={current ? 'step' : undefined}
                    onClick={() => {
                      go(item);
                    }}
                    data-current={current || undefined}
                    className={menuItemClass}
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-6 shrink-0 place-items-center rounded-full border border-line text-caption tabular-nums"
                    >
                      {seen.has(item.key) && !current ? (
                        <Icon name="check" size={14} />
                      ) : (
                        position + 1
                      )}
                    </span>
                    <span className="flex-1">{title(item)}</span>
                    {'count' in item && (
                      <span className="text-caption text-muted tabular-nums">{item.count}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-small text-muted">
              {t('knowledge.wizard.progress', { current: index + 1, total: steps.length })}
            </p>
            <h4
              ref={headingRef}
              id={headingId}
              tabIndex={-1}
              className="text-lead font-medium focus:outline-none"
            >
              {title(step)}
            </h4>
          </div>
          <StepContent step={step} view={view} words={words} />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            {index > 0 ? (
              <Button
                variant="secondary"
                onClick={() => {
                  go(steps[index - 1]);
                }}
              >
                <Icon name="back" />
                {t('knowledge.wizard.back')}
              </Button>
            ) : (
              <span />
            )}
            {next !== undefined && (
              <Button
                onClick={() => {
                  go(next);
                }}
              >
                {t('knowledge.wizard.next', { step: title(next) })}
                <Icon name="chevron" />
              </Button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

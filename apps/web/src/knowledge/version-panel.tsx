import type { VersionView } from '@arca/api-contract/client';
import type { Messages } from '@arca/i18n';
import { Button, Icon, StatusChip } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { versionCheckQuery } from '../api.js';
import { CheckReport, ItemResult, addressesRead } from './checks.js';
import { Decision, decideVersion } from './decision.js';
import { ChangeList, CheckAndHash, card, changeLines, surface } from './review-parts.js';
import { ExpressionTree } from './expression-tree.js';
import { RuleSummaryButton, RuleSummaryCard, useRuleSummary } from './rule-summary.js';
import { stateTone } from './state-tone.js';
import { shownPoints, stepTallies } from './step-checks.js';
import { CheckSummary, StepNav, tallyWords } from './step-nav.js';
import { reviewSteps, sectionCounts, type Step, type StepKey } from './steps.js';
import { type KnowledgeWords, useKnowledgeWords } from './words.js';

type SectionKey = keyof Messages['knowledge']['section'];

/** The independent check's result for the item with this check key, or nothing. */
type PointOf = (key: string) => ReactNode;

/** The check keys of the settings the check reads. */
const settingPoints = { leapDay: 'leapDayBirthday', closure: 'closure' } as const;

function Cards<T>({
  items,
  keyOf,
  render,
  point,
}: {
  readonly items: readonly T[];
  readonly keyOf: (item: T) => string;
  readonly render: (item: T) => ReactNode;
  /** The check's result for an item, shown under it. */
  readonly point?: (item: T) => ReactNode;
}) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((item, position) => (
        <li key={keyOf(item)} className={`grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 ${surface}`}>
          <span
            aria-hidden="true"
            className="grid size-7 place-items-center rounded-full bg-soft text-small font-medium tabular-nums"
          >
            {position + 1}
          </span>
          <div className="flex min-w-0 flex-col gap-2">
            {render(item)}
            {point?.(item)}
          </div>
        </li>
      ))}
    </ol>
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
  const lines = Object.entries(replaces.changes).flatMap(([section, change]) =>
    // Settings are named by their field; every other section by its items' IDs.
    changeLines(words.t(`knowledge.section.${section as SectionKey}`), change, words, (ids) =>
      words.list(section === 'settings' ? ids.map(words.field) : ids),
    ),
  );
  return <ChangeList number={replaces.number} lines={lines} words={words} />;
}

function leapDayRule(rule: VersionView['leapDayBirthday']) {
  switch (rule) {
    case 'feb-28':
      return 'february';
    case 'march-1':
      return 'march';
    case 'unsettled':
      return 'unsettled';
    case null:
      return 'none';
  }
}

function Settings({
  view,
  words,
  point,
}: {
  readonly view: VersionView;
  readonly words: KnowledgeWords;
  readonly point: PointOf;
}) {
  const { t } = words;
  return (
    <ul className="flex flex-col gap-3">
      <li className={card}>
        <p>{t('knowledge.leapDay', { rule: leapDayRule(view.leapDayBirthday) })}</p>
        <Reads sources={view.leapDayBirthdaySources} words={words} />
        {point(settingPoints.leapDay)}
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
          {point(settingPoints.closure)}
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
  point,
}: {
  readonly step: Step;
  readonly view: VersionView;
  readonly words: KnowledgeWords;
  readonly point: PointOf;
}) {
  const { t } = words;
  switch (step.key) {
    case 'changes':
      return <Changes view={view} words={words} />;
    case 'settings':
      return <Settings view={view} words={words} point={point} />;
    case 'requirements':
      return (
        <Cards
          items={view.requirements}
          keyOf={(requirement) => requirement.id}
          point={(requirement) => point(`requirement:${requirement.id}`)}
          render={(requirement) => (
            <>
              <p className="font-medium">{requirement.title}</p>
              <ExpressionTree expression={requirement.expression} />
              <Reads facts={requirement.facts} sources={requirement.sources} words={words} />
            </>
          )}
        />
      );
    case 'assessments':
      return (
        <Cards
          items={view.assessments}
          keyOf={(assessment) => assessment.id}
          point={(assessment) => point(`assessment:${assessment.id}`)}
          render={(assessment) => (
            <>
              <p className="font-medium">{assessment.title}</p>
              <Reads facts={assessment.evidence} sources={assessment.sources} words={words} />
            </>
          )}
        />
      );
    case 'dependents':
      return (
        <Cards
          items={view.dependents}
          keyOf={(dependent) => dependent.id}
          point={(dependent) => point(`dependent:${dependent.id}`)}
          render={(dependent) => (
            <>
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
            </>
          )}
        />
      );
    case 'costs':
      return (
        <Cards
          items={view.costs}
          keyOf={(cost) => cost.id}
          point={(cost) => point(`cost:${cost.id}`)}
          render={(cost) => (
            <>
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
            </>
          )}
        />
      );
    case 'durations':
      return (
        <Cards
          items={view.durations}
          keyOf={(stage) => stage.id}
          point={(stage) => point(`duration:${stage.id}`)}
          render={(stage) => (
            <>
              <p>
                {t('knowledge.durationRange', {
                  title: stage.title,
                  min: words.duration(stage.min),
                  max: words.duration(stage.max),
                })}
              </p>
              <Reads sources={stage.sources} words={words} />
            </>
          )}
        />
      );
    case 'countrySets':
      return (
        <Cards
          items={view.countrySets}
          keyOf={(set) => set.id}
          point={(set) => point(`countrySet:${set.id}/${String(set.number)}`)}
          render={(set) => (
            <>
              {t('knowledge.countrySet', {
                title: set.title,
                number: set.number,
                members: words.list(set.members.map(words.country)),
              })}
            </>
          )}
        />
      );
    case 'sources':
      return (
        <Cards
          items={view.sources}
          keyOf={(source) => source.id}
          render={(source) => (
            <>
              <p className="font-medium">{source.title}</p>
              {/* Plain text, never a link: the admin reads the full address before opening it. */}
              <p className="font-mono text-small break-all">{source.url}</p>
              <p className="text-small">
                {source.host === null
                  ? t('knowledge.noHost')
                  : t('knowledge.host', { host: source.host })}
              </p>
              {source.machineReadableUrl !== undefined && (
                <p className="flex flex-col gap-1 text-small">
                  <span className="text-muted">{t('knowledge.readAddress')}</span>
                  <span className="font-mono break-all">{source.machineReadableUrl}</span>
                </p>
              )}
              {source.newMachineReadableHost && (
                <p className="font-medium text-danger-ink">{t('knowledge.newAddressHost')}</p>
              )}
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
            </>
          )}
        />
      );
    case 'cases':
      return (
        <Cards
          items={view.cases}
          keyOf={(ruleCase) => ruleCase.id}
          render={(ruleCase) => (
            <>
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
            </>
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
      <CheckAndHash
        hash={view.hash}
        check={<CheckReport view={view} words={words} />}
        words={words}
      />
      <Decision
        state={view.state}
        decide={(kind) => decideVersion(kind, view)}
        activateLead={t('knowledge.activateLead', { date: words.date(view.effectiveFrom) })}
        rejectWarning={
          view.rejection.selected
            ? t('knowledge.rejectFallback', {
                current: view.state,
                fallback: view.rejection.fallback === null ? 'none' : view.rejection.fallback.state,
                number: view.rejection.fallback?.number ?? 0,
              })
            : null
        }
        words={words}
      />
    </div>
  );
}

/**
 * One version as data (spec 0007, R7), reviewed as a wizard: a step per section of the version,
 * named in a step list the admin can jump through, with Back and Next, and the decision last.
 */
export function VersionPanel({ view }: { readonly view: VersionView }) {
  const words = useKnowledgeWords();
  const { t } = words;
  const summary = useRuleSummary(view);
  const steps = reviewSteps(view);
  const [currentKey, setCurrentKey] = useState<StepKey>('changes');
  const movedRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const check = useQuery(versionCheckQuery(view.routeId, view.number));
  const report = check.data?.enabled === true ? check.data.report : null;
  const { tallies, point } = useMemo(() => {
    const points = shownPoints(report);
    const byKey = new Map(points.map((item) => [item.key, item]));
    const addressRead = report === null ? new Map<string, string | null>() : addressesRead(report);
    const pointOf: PointOf = (key) => {
      const item = byKey.get(key);
      return item === undefined ? null : (
        <ItemResult item={item} addressRead={addressRead} words={words} />
      );
    };
    return { tallies: stepTallies(points), point: pointOf };
  }, [report, words]);
  const headingId = useId();

  const index = Math.max(
    steps.findIndex(({ key }) => key === currentKey),
    0,
  );
  const step = steps[index] ?? { key: 'decision' };
  const next = steps[index + 1];
  const stepTally = tallies.get(step.key);
  const title = (target: Step) =>
    target.key === 'decision'
      ? t('knowledge.wizard.decision')
      : t(`knowledge.section.${target.key}`);

  useEffect(() => {
    if (!movedRef.current) return;
    // Focus lands on the new step's heading, so a screen reader reads where it now is.
    headingRef.current?.focus();
  }, [currentKey]);

  const go = (target: Step | undefined) => {
    if (target === undefined) return;
    movedRef.current = true;
    setCurrentKey(target.key);
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-title">
            {t('knowledge.versionTitle', { title: view.title, number: view.number })}
          </h3>
          <RuleSummaryButton state={summary} />
        </div>
        <p className="text-small text-muted">
          {[
            t('knowledge.versionMeta', {
              country: words.country(view.country),
              date: words.date(view.effectiveFrom),
            }),
            ...(view.corrects === null ? [] : [t('knowledge.corrects', { number: view.corrects })]),
            t('knowledge.currency', { currency: view.currency }),
          ].join(' · ')}
        </p>
        {view.tags.length > 0 && (
          <ul aria-label={t('knowledge.tags')} className="flex flex-wrap gap-2">
            {view.tags.map((tag) => (
              <li
                key={tag}
                className="rounded-chip border border-line px-2 py-0.5 text-caption text-muted"
              >
                {tag}
              </li>
            ))}
          </ul>
        )}
      </header>
      <RuleSummaryCard state={summary} />
      <CheckSummary tallies={tallies} words={words} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10">
        <StepNav
          steps={steps}
          index={index}
          tallies={tallies}
          title={title}
          go={go}
          words={words}
        />
        <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <div className="flex flex-col gap-1 max-lg:sr-only">
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
            {stepTally !== undefined && (
              <p className="text-small text-muted">{tallyWords(stepTally, words)}</p>
            )}
          </div>
          <StepContent step={step} view={view} words={words} point={point} />
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

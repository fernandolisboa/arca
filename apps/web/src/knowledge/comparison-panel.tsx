import type { ComparisonVersionView } from '@arca/api-contract/client';
import { StatusChip } from '@arca/ui';
import { useId, type ReactNode } from 'react';
import { Decision, decideComparison } from './decision.js';
import { stateTone } from './state-tone.js';
import { type KnowledgeWords, useKnowledgeWords } from './words.js';

type Criterion = ComparisonVersionView['criteria'][number];
type Indicator = ComparisonVersionView['indicators'][number];
type Change = NonNullable<ComparisonVersionView['replaces']>['criteria'];

const card = 'flex min-w-0 flex-col gap-2 rounded-control border border-line bg-surface p-4';

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <h4 id={headingId} className="text-lead font-medium">
        {title}
      </h4>
      {children}
    </section>
  );
}

function changeLines(section: string, change: Change, words: KnowledgeWords): readonly string[] {
  const details = [
    ...(change.added.length > 0
      ? [words.t('knowledge.changeAdded', { items: words.list(change.added) })]
      : []),
    ...(change.removed.length > 0
      ? [words.t('knowledge.changeRemoved', { items: words.list(change.removed) })]
      : []),
    ...(change.changed.length > 0
      ? [words.t('knowledge.changeChanged', { items: words.list(change.changed) })]
      : []),
  ];
  return details.length === 0
    ? []
    : [words.t('knowledge.change', { section, details: words.list(details) })];
}

function Changes({
  view,
  words,
}: {
  readonly view: ComparisonVersionView;
  readonly words: KnowledgeWords;
}) {
  const { replaces } = view;
  if (replaces === null) {
    return <p className="text-muted">{words.t('knowledge.comparison.firstVersion')}</p>;
  }
  const lines = [
    ...changeLines(words.t('knowledge.comparison.criteria'), replaces.criteria, words),
    ...changeLines(words.t('knowledge.comparison.indicators'), replaces.indicators, words),
  ];
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

function CriterionCard({
  criterion,
  words,
}: {
  readonly criterion: Criterion;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  return (
    <li className={card}>
      <p className="font-medium">{criterion.title}</p>
      <p className="text-small text-muted">
        {[
          criterion.id,
          t('knowledge.comparison.kind', { kind: criterion.kind }),
          t('knowledge.comparison.defaultWeight', { weight: criterion.defaultWeight }),
        ].join(' · ')}
      </p>
      {criterion.kind === 'indicator' && (
        <p>
          {t('knowledge.comparison.anchors', {
            indicator: criterion.indicator,
            zeroAt: words.decimal(criterion.zeroAt),
            tenAt: words.decimal(criterion.tenAt),
          })}
        </p>
      )}
      {criterion.kind === 'category' && (
        <p>
          {t('knowledge.comparison.tokenScores', {
            indicator: criterion.indicator,
            scores: words.list(
              criterion.scores.map(({ token, score }) =>
                t('knowledge.comparison.tokenScore', { token, score }),
              ),
            ),
          })}
        </p>
      )}
    </li>
  );
}

function IndicatorCard({
  indicator,
  words,
}: {
  readonly indicator: Indicator;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const value = (raw: string) => (indicator.valueType === 'decimal' ? words.decimal(raw) : raw);
  // With one source every value cites it; the host column only helps when they differ.
  const manySources = indicator.sources.length > 1;
  return (
    <li className={card}>
      <p className="font-medium">{indicator.title}</p>
      <p className="text-small text-muted">
        {[t('knowledge.pin', { id: indicator.id, number: indicator.number }), indicator.unit].join(
          ' · ',
        )}
      </p>
      <ul className="flex flex-col gap-1 text-small">
        {indicator.sources.map((source) => (
          <li key={source.id} className="flex min-w-0 flex-col">
            <span>{source.title}</span>
            <span className="break-all text-muted">{source.url}</span>
            <span className="text-muted">
              {[
                source.host === null
                  ? t('knowledge.noHost')
                  : t('knowledge.host', { host: source.host }),
                t('knowledge.sourceKind', { kind: source.kind }),
                t('knowledge.verifiedAt', { date: words.date(source.verifiedAt) }),
              ].join(' · ')}
            </span>
          </li>
        ))}
      </ul>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-small tabular-nums">
          <caption className="sr-only">
            {t('knowledge.comparison.valuesCaption', { title: indicator.title })}
          </caption>
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-1 pr-3 font-normal">
                {t('knowledge.comparison.country')}
              </th>
              <th scope="col" className="py-1 pr-3 font-normal">
                {t('knowledge.comparison.value')}
              </th>
              <th scope="col" className="py-1 pr-3 font-normal">
                {t('knowledge.comparison.before')}
              </th>
              {manySources && (
                <th scope="col" className="py-1 font-normal">
                  {t('knowledge.comparison.source')}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {indicator.values.map((row) => (
              <tr key={row.country} className="border-t border-line">
                <th scope="row" className="py-1 pr-3 font-normal">
                  {words.country(row.country)}
                </th>
                <td className="py-1 pr-3">
                  {t('knowledge.comparison.valueInYear', {
                    value: value(row.value),
                    year: String(row.year),
                  })}
                </td>
                <td className="py-1 pr-3 text-muted">
                  {row.previous === null
                    ? t('knowledge.comparison.noPrevious')
                    : t('knowledge.comparison.valueInYear', {
                        value: value(row.previous.value),
                        year: String(row.previous.year),
                      })}
                </td>
                {manySources && (
                  <td className="py-1 break-all">{row.host ?? t('knowledge.noHost')}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {indicator.removed.length > 0 && (
        <p className="text-small text-danger-ink">
          {t('knowledge.comparison.removed', {
            countries: words.list(indicator.removed.map(words.country)),
          })}
        </p>
      )}
    </li>
  );
}

/**
 * One comparison version as data (ADR-0026): what changed, its criteria, every indicator value with
 * its year and source, and the decision. One activation covers the whole version.
 */
export function ComparisonPanel({ view }: { readonly view: ComparisonVersionView }) {
  const words = useKnowledgeWords();
  const { t } = words;
  const checkId = useId();
  const { selected, fallback } = view.rejection;
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip
            tone={stateTone(view.state)}
            label={t('knowledge.state', { state: view.state })}
          />
        </div>
        <h3 className="font-display text-title">
          {t('knowledge.versionTitle', { title: view.title, number: view.number })}
        </h3>
        <p className="text-small text-muted">{t('knowledge.comparison.meta')}</p>
      </header>
      <Section title={t('knowledge.section.changes')}>
        <Changes view={view} words={words} />
      </Section>
      <Section title={t('knowledge.comparison.criteria')}>
        <ul className="grid gap-3 md:grid-cols-2">
          {view.criteria.map((criterion) => (
            <CriterionCard key={criterion.id} criterion={criterion} words={words} />
          ))}
        </ul>
      </Section>
      <Section title={t('knowledge.comparison.indicators')}>
        <ul className="flex flex-col gap-3">
          {view.indicators.map((indicator) => (
            <IndicatorCard key={indicator.id} indicator={indicator} words={words} />
          ))}
        </ul>
      </Section>
      <Section title={t('knowledge.wizard.decision')}>
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
        <Decision
          state={view.state}
          decide={(kind) => decideComparison(kind, view)}
          activateLead={t('knowledge.comparison.activateLead')}
          rejectWarning={
            selected
              ? t('knowledge.comparison.rejectFallback', {
                  fallback: fallback === null ? 'none' : 'previous',
                  number: fallback?.number ?? 0,
                })
              : null
          }
          words={words}
        />
      </Section>
    </div>
  );
}

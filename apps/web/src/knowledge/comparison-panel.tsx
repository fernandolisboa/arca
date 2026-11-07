import type { ComparisonVersionView } from '@arca/api-contract/client';
import { StatusChip } from '@arca/ui';
import { useId, type ReactNode } from 'react';
import { Decision, decideComparison } from './decision.js';
import { ChangeList, CheckAndHash, card, changeLine } from './review-parts.js';
import { stateTone } from './state-tone.js';
import { type KnowledgeWords, useKnowledgeWords } from './words.js';

type Criterion = ComparisonVersionView['criteria'][number];
type Indicator = ComparisonVersionView['indicators'][number];

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
    ...changeLine(words.t('knowledge.comparison.criteria'), replaces.criteria, words),
    ...changeLine(words.t('knowledge.comparison.indicators'), replaces.indicators, words),
  ];
  return <ChangeList number={replaces.number} lines={lines} words={words} />;
}

function CriterionCard({
  criterion,
  indicatorTitle,
  words,
}: {
  readonly criterion: Criterion;
  /** The title of an indicator the version pins, by ID; the ID when it pins none by that ID. */
  readonly indicatorTitle: (id: string) => string;
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
            indicator: indicatorTitle(criterion.indicator),
            zeroAt: words.decimal(criterion.zeroAt),
            tenAt: words.decimal(criterion.tenAt),
          })}
        </p>
      )}
      {criterion.kind === 'category' && (
        <p>
          {t('knowledge.comparison.tokenScores', {
            indicator: indicatorTitle(criterion.indicator),
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
  const { selected, fallback } = view.rejection;
  const titles = new Map(view.indicators.map(({ id, title }) => [id, title]));
  const indicatorTitle = (id: string) => titles.get(id) ?? id;
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
            <CriterionCard
              key={criterion.id}
              criterion={criterion}
              indicatorTitle={indicatorTitle}
              words={words}
            />
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
        <CheckAndHash hash={view.hash} words={words} />
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

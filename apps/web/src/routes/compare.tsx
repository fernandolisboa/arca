import { ApiError } from '@arca/api-contract/client';
import { Button, cardClass } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { caseQuery, sessionQuery } from '../api.js';
import { FlagLead } from '../country-flag.js';
import { ComparisonTable } from '../compare/comparison-table.js';
import { CountryCard } from '../compare/country-card.js';
import { noFilter, passesFilter } from '../compare/filters.js';
import { CompareToolbar } from '../compare/toolbar.js';
import { useComparison, type ComparisonEditor } from '../compare/use-comparison.js';
import { OwnCriteriaPanel, WeightsPanel, weightsAnchor } from '../compare/weights-panel.js';
import { useCompareWords, type CompareWords } from '../compare/words.js';
import { textLinkClass } from '../forms/text-link.js';
import { Page } from '../page.js';
import { useMediaQuery } from '../use-media-query.js';

export const Route = createFileRoute('/compare')({ component: Compare });

/** Wide enough for the table, with a criterion per column, and a pointer for its small stars. */
const tableQuery = '(min-width: 64rem) and (pointer: fine)';

/** Comparar destinos (ADR-0026): the person's own ranking of the countries that have a route. */
function Compare() {
  const words = useCompareWords();
  const { t } = words;
  const session = useQuery(sessionQuery);
  const confirmed = session.data?.confirmed === true;
  const familyCase = useQuery({ ...caseQuery, enabled: confirmed });
  const { read, editor } = useComparison(confirmed && familyCase.data?.case != null);
  const title = t('compare.title');
  if (session.isError) {
    return (
      <Page narrow title={title}>
        <p>{t('compare.signIn')}</p>
        <Link to="/sign-in" className={textLinkClass}>
          {t('session.signIn')}
        </Link>
      </Page>
    );
  }
  if (!session.isSuccess) return <Page narrow title={title} />;
  if (!confirmed) {
    return (
      <Page narrow title={title}>
        <p>{t('session.unconfirmed')}</p>
      </Page>
    );
  }
  const status = read.error instanceof ApiError ? read.error.status : undefined;
  if (familyCase.data?.case === null || status === 404) {
    return (
      <Page narrow title={title}>
        <p>{t('compare.noCase')}</p>
        <Link to="/family" className={textLinkClass}>
          {t('compare.openFamily')}
        </Link>
      </Page>
    );
  }
  if (familyCase.isError || (read.isError && editor === undefined)) {
    return (
      <Page narrow title={title}>
        <p role="alert">{t(status === 429 ? 'compare.tooMany' : 'compare.loadFailure')}</p>
        <Button
          onClick={() => {
            void familyCase.refetch();
            void read.refetch();
          }}
        >
          {t('compare.retry')}
        </Button>
      </Page>
    );
  }
  if (editor === undefined) return <Page title={title} />;
  return (
    <Page title={title} lead={t('compare.lead')}>
      <Comparison editor={editor} words={words} />
    </Page>
  );
}

function Comparison({
  editor,
  words,
}: {
  readonly editor: ComparisonEditor;
  readonly words: CompareWords;
}) {
  const { t } = words;
  const { comparison, preferences, saving, failure, change } = editor;
  const wide = useMediaQuery(tableQuery);
  const [filter, setFilter] = useState(noFilter);
  const rankingId = useId();
  const fewDataId = useId();
  const hiddenId = useId();
  // A country the person just hid leaves the list at once; the API's answer catches up.
  const hidden = new Set(preferences.hidden);
  const shown = (country: (typeof comparison.countries)[number]) =>
    passesFilter({ name: words.country(country.country), total: country.total }, filter);
  const inGroup = (wanted: (typeof comparison.countries)[number]['group']) =>
    comparison.countries.filter(
      (country) => country.group === wanted && !hidden.has(country.country) && shown(country),
    );
  const ranked = inGroup('ranked');
  const fewData = inGroup('few-data');
  const unhidden = comparison.countries.filter(
    ({ group, country }) => group !== 'hidden' && !hidden.has(country),
  );
  // Hidden by the API, or just now by the person; one just shown stays here until the API answers.
  const hiddenCountries = comparison.countries.filter(
    ({ group, country }) => group === 'hidden' || hidden.has(country),
  );
  const filtered = filter.search.trim() !== '' || filter.score !== 'all';
  // Without a filter, an empty ranking means too few scores; with one, the filter left them out.
  const noneRanked = ranked.length === 0 && !filtered && (
    <p className="text-muted">{t('compare.noneRanked')}</p>
  );
  const card = (country: (typeof comparison.countries)[number], row: number) => (
    <CountryCard
      key={country.country}
      country={country}
      row={row}
      criteria={comparison.criteria}
      preferences={preferences}
      change={change}
      words={words}
    />
  );
  const rankingBody =
    comparison.countries.length === 0 ? (
      <p className="text-muted">{t('compare.empty')}</p>
    ) : unhidden.length === 0 ? (
      <p className="text-muted">{t('compare.allHidden')}</p>
    ) : ranked.length + fewData.length === 0 ? (
      <p className="text-muted">{t('compare.noMatch')}</p>
    ) : wide ? (
      <>
        {noneRanked}
        <ComparisonTable
          ranked={ranked}
          fewData={fewData}
          criteria={comparison.criteria}
          preferences={preferences}
          change={change}
          words={words}
        />
      </>
    ) : ranked.length === 0 ? (
      noneRanked
    ) : (
      <ol className="flex flex-col gap-4">{ranked.map(card)}</ol>
    );
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {comparison.version === null && (
        <p className="rounded-card border border-line bg-soft p-4">{t('compare.noVersion')}</p>
      )}
      {comparison.pendingNewer && (
        <p className="rounded-card bg-warn-bg p-4 text-warn-ink">{t('compare.pendingNewer')}</p>
      )}
      {failure !== undefined && (
        <p role="alert" className="rounded-card bg-danger-bg p-4 text-danger-ink">
          {t('compare.saveFailure', { reason: failure })}
        </p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <CompareToolbar filter={filter} onChange={setFilter} words={words} />
        <p role="status" className="text-small text-muted">
          {saving ? t('compare.saving') : ''}
        </p>
      </div>
      {!wide && (
        <a href={`#${weightsAnchor}`} className={textLinkClass}>
          {t('compare.jumpToWeights')}
        </a>
      )}
      <section aria-labelledby={rankingId} className="flex flex-col gap-3">
        <h3 id={rankingId} className="font-display text-lead">
          {t('compare.rankingTitle')}
        </h3>
        {rankingBody}
      </section>
      {!wide && fewData.length > 0 && (
        <section aria-labelledby={fewDataId} className="flex flex-col gap-3">
          <h3 id={fewDataId} className="font-display text-lead">
            {t('compare.fewDataTitle')}
          </h3>
          <p className="max-w-prose text-small text-muted">{t('compare.fewDataLead')}</p>
          <ul className="flex flex-col gap-4">
            {fewData.map((country, index) => card(country, ranked.length + index))}
          </ul>
        </section>
      )}
      {wide ? (
        <OwnCriteriaPanel
          criteria={comparison.criteria}
          count={preferences.ownCriteria.length}
          change={change}
          words={words}
        />
      ) : (
        <WeightsPanel
          criteria={comparison.criteria}
          preferences={preferences}
          change={change}
          words={words}
        />
      )}
      {hiddenCountries.length > 0 && (
        <section aria-labelledby={hiddenId} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 id={hiddenId} className="font-display text-lead">
              {t('compare.hiddenTitle')}
            </h3>
            <p className="text-small text-muted">{t('compare.hiddenLead')}</p>
          </div>
          <ul
            className={`${cardClass} grid divide-line px-4 max-md:divide-y md:grid-cols-2 md:gap-x-8 xl:grid-cols-3`}
          >
            {hiddenCountries.map(({ country, total }) => {
              const name = words.country(country);
              return (
                <li
                  key={country}
                  className="flex flex-wrap items-center justify-between gap-x-4 py-1"
                >
                  <span>
                    <FlagLead code={country} />
                    {name}{' '}
                    <span className="text-small text-muted tabular-nums">
                      {total === null
                        ? t('compare.noTotal')
                        : t('compare.totalLabel', { total: words.decimal(total) })}
                    </span>
                  </span>
                  {hidden.has(country) && (
                    <button
                      type="button"
                      className={textLinkClass}
                      aria-label={t('compare.showLabel', { country: name })}
                      onClick={() => {
                        change({ kind: 'show', country });
                      }}
                    >
                      {t('compare.show')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

import { ApiError } from '@arca/api-contract/client';
import { Button, cardClass } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useId } from 'react';
import { caseQuery, sessionQuery } from '../api.js';
import { CountryCard } from '../compare/country-card.js';
import { useComparison, type ComparisonEditor } from '../compare/use-comparison.js';
import { WeightsPanel, weightsAnchor } from '../compare/weights-panel.js';
import { useCompareWords, type CompareWords } from '../compare/words.js';
import { textLinkClass } from '../forms/text-link.js';
import { Page } from '../page.js';

export const Route = createFileRoute('/compare')({ component: Compare });

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
      <Page title={title}>
        <p>{t('compare.signIn')}</p>
        <Link to="/sign-in" className={textLinkClass}>
          {t('session.signIn')}
        </Link>
      </Page>
    );
  }
  if (!session.isSuccess) return <Page title={title} />;
  if (!confirmed) {
    return (
      <Page title={title}>
        <p>{t('session.unconfirmed')}</p>
      </Page>
    );
  }
  const status = read.error instanceof ApiError ? read.error.status : undefined;
  if (familyCase.data?.case === null || status === 404) {
    return (
      <Page title={title}>
        <p>{t('compare.noCase')}</p>
        <Link to="/family" className={textLinkClass}>
          {t('compare.openFamily')}
        </Link>
      </Page>
    );
  }
  if (familyCase.isError || (read.isError && editor === undefined)) {
    return (
      <Page title={title}>
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
  if (editor === undefined) return <Page title={title} wide />;
  return (
    <Page title={title} lead={t('compare.lead')} wide>
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
  const rankingId = useId();
  const fewDataId = useId();
  const hiddenId = useId();
  // A country the person just hid leaves the list at once; the API's answer catches up.
  const hidden = new Set(preferences.hidden);
  const inGroup = (wanted: (typeof comparison.countries)[number]['group']) =>
    comparison.countries.filter(({ group, country }) => group === wanted && !hidden.has(country));
  const ranked = inGroup('ranked');
  const fewData = inGroup('few-data');
  // Hidden by the API, or just now by the person; one just shown stays here until the API answers.
  const hiddenCountries = comparison.countries.filter(
    ({ group, country }) => group === 'hidden' || hidden.has(country),
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
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
      <div className="flex min-w-0 flex-col gap-6">
        {comparison.version === null && (
          <p className="rounded-card border border-line bg-soft p-4">{t('compare.noVersion')}</p>
        )}
        {comparison.pendingNewer && (
          <p className="rounded-card bg-warn-bg p-4 text-warn-ink">{t('compare.pendingNewer')}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <a href={`#${weightsAnchor}`} className={`${textLinkClass} lg:hidden`}>
            {t('compare.jumpToWeights')}
          </a>
          <p role="status" className="text-small text-muted">
            {saving ? t('compare.saving') : ''}
          </p>
        </div>
        {failure !== undefined && (
          <p role="alert" className="rounded-card bg-danger-bg p-4 text-danger-ink">
            {t('compare.saveFailure', { reason: failure })}
          </p>
        )}
        <section aria-labelledby={rankingId} className="flex flex-col gap-3">
          <h3 id={rankingId} className="font-display text-lead">
            {t('compare.rankingTitle')}
          </h3>
          {comparison.countries.length === 0 ? (
            <p className="text-muted">{t('compare.empty')}</p>
          ) : ranked.length + fewData.length === 0 ? (
            <p className="text-muted">{t('compare.allHidden')}</p>
          ) : ranked.length === 0 ? (
            <p className="text-muted">{t('compare.noneRanked')}</p>
          ) : (
            <ol className="flex flex-col gap-4">{ranked.map(card)}</ol>
          )}
        </section>
        {fewData.length > 0 && (
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
        {hiddenCountries.length > 0 && (
          <section aria-labelledby={hiddenId} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h3 id={hiddenId} className="font-display text-lead">
                {t('compare.hiddenTitle')}
              </h3>
              <p className="text-small text-muted">{t('compare.hiddenLead')}</p>
            </div>
            <ul className={`${cardClass} flex flex-col divide-y divide-line px-4`}>
              {hiddenCountries.map(({ country, total }) => {
                const name = words.country(country);
                return (
                  <li
                    key={country}
                    className="flex flex-wrap items-center justify-between gap-x-4 py-1"
                  >
                    <span>
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
      <WeightsPanel
        criteria={comparison.criteria}
        preferences={preferences}
        change={change}
        words={words}
      />
    </div>
  );
}

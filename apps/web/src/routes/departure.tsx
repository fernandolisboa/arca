import type { DepartureChecklist, DepartureSource } from '@arca/api-contract/client';
import { Button, SourceLine, cardClass } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { departureChecklistsQuery, sessionQuery } from '../api.js';
import { FlagLead } from '../country-flag.js';
import { textLinkClass } from '../forms/text-link.js';
import { Page } from '../page.js';

export const Route = createFileRoute('/departure')({ component: Departure });

/**
 * Saída do país (ADR-0038): what to do when leaving a country, and the documents that trace where
 * the money came from, each item with the official pages it rests on.
 */
function Departure() {
  const { t } = useTranslation();
  const session = useQuery(sessionQuery);
  const checklists = useQuery({ ...departureChecklistsQuery, enabled: session.isSuccess });
  const title = t('departure.title');
  if (session.isError) {
    return (
      <Page narrow title={title}>
        <p>{t('departure.signIn')}</p>
        <Link to="/sign-in" className={textLinkClass}>
          {t('session.signIn')}
        </Link>
      </Page>
    );
  }
  if (checklists.isError) {
    return (
      <Page narrow title={title}>
        <p role="alert">{t('departure.failed')}</p>
        <Button onClick={() => void checklists.refetch()}>{t('departure.retry')}</Button>
      </Page>
    );
  }
  if (!checklists.isSuccess) {
    return (
      <Page title={title}>
        <p className="text-muted">{t('departure.loading')}</p>
      </Page>
    );
  }
  const all = checklists.data.checklists;
  return (
    <Page title={title} lead={t('departure.lead')}>
      {all.length === 0 ? (
        <p className="text-muted">{t('departure.empty')}</p>
      ) : (
        all.map((checklist) => <Checklist key={checklist.country} checklist={checklist} />)
      )}
    </Page>
  );
}

function Checklist({ checklist }: { readonly checklist: DepartureChecklist }) {
  const { t, i18n } = useTranslation();
  const country = new Intl.DisplayNames([i18n.language], { type: 'region', fallback: 'code' });
  const headingId = `departure-${checklist.country}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h3 id={headingId} className="font-display text-lead">
        <FlagLead code={checklist.country} />
        {country.of(checklist.country) ?? checklist.country}
      </h3>
      <div className="gap-5 lg:columns-2 2xl:columns-3">
        {checklist.sections.map((section) => (
          <section
            key={section.id}
            aria-labelledby={`${headingId}-${section.id}`}
            className={`${cardClass} mb-5 flex break-inside-avoid flex-col gap-4 p-5`}
          >
            <h4 id={`${headingId}-${section.id}`} className="font-display text-lead">
              {t(`departure.section.${section.id}` as never)}
            </h4>
            <ol className="flex flex-col gap-4">
              {section.items.map((item) => (
                <li key={item.id} className="flex flex-col gap-1">
                  <p className="font-medium">{t(`departure.item.${item.id}.title` as never)}</p>
                  <p className="text-small">{t(`departure.item.${item.id}.body` as never)}</p>
                  <Sources sources={item.sources} />
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </section>
  );
}

function Sources({ sources }: { readonly sources: readonly DepartureSource[] }) {
  const { t, i18n } = useTranslation();
  // The placeholders go back in, so the source line puts the link and the date in their place.
  const message = t('departure.source', { host: '{host}', date: '{date}' });
  return (
    <ul className="flex flex-col gap-1 text-caption text-muted">
      {sources.map((source) => (
        <li key={source.url} className="flex flex-col">
          <span>{source.title}</span>
          <SourceLine
            href={source.url}
            verifiedOn={source.verifiedAt}
            locale={i18n.language}
            message={message}
          />
        </li>
      ))}
    </ul>
  );
}

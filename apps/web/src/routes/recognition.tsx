import type { RecognitionTrack } from '@arca/api-contract/client';
import { Button, cardClass } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { caseQuery, recognitionTracksQuery, sessionQuery } from '../api.js';
import { FlagLead } from '../country-flag.js';
import { textLinkClass } from '../forms/text-link.js';
import { Page } from '../page.js';
import { SourceList } from '../source-list.js';

export const Route = createFileRoute('/recognition')({ component: Recognition });

/**
 * Revalidação profissional (ADR-0041): how a profession is recognised in each destination, step by
 * step with the official pages behind each, and whom in the family each track concerns.
 */
function Recognition() {
  const { t } = useTranslation();
  const session = useQuery(sessionQuery);
  const tracks = useQuery({ ...recognitionTracksQuery, enabled: session.isSuccess });
  const familyCase = useQuery({ ...caseQuery, enabled: session.data?.confirmed === true });
  const title = t('recognition.title');
  if (session.isError) {
    return (
      <Page narrow title={title}>
        <p>{t('recognition.signIn')}</p>
        <Link to="/sign-in" className={textLinkClass}>
          {t('session.signIn')}
        </Link>
      </Page>
    );
  }
  if (tracks.isError) {
    return (
      <Page narrow title={title}>
        <p role="alert">{t('recognition.failed')}</p>
        <Button onClick={() => void tracks.refetch()}>{t('recognition.retry')}</Button>
      </Page>
    );
  }
  if (!tracks.isSuccess) {
    return (
      <Page title={title}>
        <p className="text-muted">{t('recognition.loading')}</p>
      </Page>
    );
  }
  const names = new Map(
    (familyCase.data?.case?.people ?? []).map((person) => [person.id, person.displayName]),
  );
  const holdersOf = new Map(
    tracks.data.holders.map(({ trackId, personIds }) => [
      trackId,
      personIds.flatMap((id) => names.get(id) ?? []),
    ]),
  );
  return (
    <Page title={title} lead={t('recognition.lead')}>
      {tracks.data.tracks.length === 0 ? (
        <p className="text-muted">{t('recognition.empty')}</p>
      ) : (
        tracks.data.tracks.map((track) => (
          <Track
            key={track.id}
            track={track}
            holders={familyCase.isSuccess ? (holdersOf.get(track.id) ?? []) : undefined}
          />
        ))
      )}
    </Page>
  );
}

function Track({
  track,
  holders,
}: {
  readonly track: RecognitionTrack;
  /** The names of the people it concerns, or nothing until the case has loaded. */
  readonly holders: readonly string[] | undefined;
}) {
  const { t, i18n } = useTranslation();
  const country = new Intl.DisplayNames([i18n.language], { type: 'region', fallback: 'code' });
  const list = new Intl.ListFormat(i18n.language, { type: 'conjunction' });
  const headingId = `recognition-${track.id}`;
  // The placeholders go back in, so the source line puts the link and the date in their place.
  const source = t('recognition.source', { host: '{host}', date: '{date}' });
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 id={headingId} className="font-display text-lead">
          {t(`recognition.track.${track.id}` as never)}
        </h3>
        {holders !== undefined && (
          <p className="text-small text-muted">
            {holders.length > 0
              ? t('recognition.holders', { names: list.format(holders) })
              : t('recognition.noHolders')}
          </p>
        )}
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {track.destinations.map((destination) => {
          const destinationId = `${headingId}-${destination.country}`;
          return (
            <section
              key={destination.country}
              aria-labelledby={destinationId}
              className={`${cardClass} flex flex-col gap-4 p-5`}
            >
              <h4 id={destinationId} className="font-display text-lead">
                <FlagLead code={destination.country} />
                {country.of(destination.country) ?? destination.country}
              </h4>
              <ol className="flex flex-col gap-4">
                {destination.steps.map((step, index) => (
                  <li key={step.id} className="flex flex-col gap-1">
                    <p className="text-caption text-muted">
                      {t('recognition.step', { number: index + 1 })}
                    </p>
                    <p className="font-medium">{t(`recognition.item.${step.id}.title` as never)}</p>
                    <p className="text-small">{t(`recognition.item.${step.id}.body` as never)}</p>
                    <SourceList sources={step.sources} message={source} />
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </section>
  );
}

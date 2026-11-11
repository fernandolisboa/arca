import { CoachMark } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sessionQuery } from '../api.js';
import { seenTours, useSeenTours } from './seen.js';
import { nextTour, type Tour } from './tours.js';

function ActiveTour({ tour }: { readonly tour: Tour }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const finish = useCallback(() => {
    seenTours.add(tour.id);
  }, [tour.id]);

  const step = tour.steps[index];
  if (step === undefined) return null;
  const total = tour.steps.length;
  const last = index === total - 1;
  const text = (part: 'title' | 'body') => t(`tour.${tour.id}.${step.id}.${part}` as never);
  return (
    <CoachMark
      targetIds={step.targetIds}
      title={text('title')}
      body={text('body')}
      stepLabel={t('tour.step', { current: index + 1, total })}
      first={index === 0}
      last={last}
      labels={{
        skip: t('tour.skip'),
        back: t('tour.back'),
        next: t('tour.next'),
        done: t(total === 1 ? 'tour.gotIt' : 'tour.done'),
      }}
      onSkip={finish}
      onBack={() => {
        setIndex(index - 1);
      }}
      onNext={() => {
        if (last) finish();
        else setIndex(index + 1);
      }}
    />
  );
}

/**
 * The guided tour (#123): the first-run walk through the app, then a hint the first time each
 * screen opens. Only for a confirmed account with nothing pending, the one that sees those screens.
 */
export function TourGuide() {
  const { pathname } = useLocation();
  const session = useQuery(sessionQuery);
  const seen = useSeenTours();
  const account = session.data;
  const ready =
    account?.confirmed === true && account.deletionDueAt === null && !account.recoveryPending;
  const tour = ready ? nextTour(pathname, seen) : undefined;
  return tour === undefined ? null : <ActiveTour key={tour.id} tour={tour} />;
}

import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

/** Shown for a client path with no route; the router's default text is English. */
export function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-3">
      <h2 className="font-semibold">{t('notFound.title')}</h2>
      <Link
        to="/"
        className="inline-flex min-h-touch items-center text-primary underline underline-offset-4"
      >
        {t('notFound.home')}
      </Link>
    </div>
  );
}

/** Shown when rendering a route fails; the error itself is never displayed. */
export function Failure() {
  const { t } = useTranslation();
  return (
    <p role="alert" className="text-danger-ink">
      {t('failure.title')}
    </p>
  );
}

import { useTranslation } from 'react-i18next';

/** A short date and time in the reader's language, as the account screens show times. */
export function useDateFormat() {
  const { i18n } = useTranslation();
  return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
}

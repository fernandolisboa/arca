import type { ReactNode } from 'react';

export interface SourceLineProps {
  /** The source's address. Only `https:` is shown; the visible host comes from it. */
  readonly href: string;
  /** A calendar date, `YYYY-MM-DD`, with no time or time zone. */
  readonly verifiedOn: string;
  readonly locale: string;
  /** The sentence, with `{host}` and `{date}` where the link and the date go. */
  readonly message: string;
}

const calendarDate = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Formats a calendar date for the locale without a time-zone shift: the date is built and formatted
 * in UTC, so 2026-01-01 reads as that day wherever the device is. A date that does not exist, such
 * as 2026-02-30, is shown as written instead of rolling over to another day.
 */
export function formatCalendarDate(value: string, locale: string): string {
  const match = calendarDate.exec(value);
  if (match === null) return value;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' }).format(date);
}

function secureUrl(href: string): URL | null {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** "Fonte: host · verificado em date", under any requirement, fee, threshold or deadline. */
export function SourceLine({ href, verifiedOn, locale, message }: SourceLineProps) {
  const url = secureUrl(href);
  if (url === null) return null;
  const slots: Record<string, ReactNode> = {
    host: (
      <a
        key="host"
        href={url.href}
        rel="noopener noreferrer"
        className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {url.hostname}
      </a>
    ),
    date: (
      <time key="date" dateTime={verifiedOn}>
        {formatCalendarDate(verifiedOn, locale)}
      </time>
    ),
  };
  // Odd parts of the split are placeholder names; even parts are the message's own text.
  const parts = message.split(/\{(host|date)\}/);
  return (
    <p className="text-caption text-muted">
      {parts.map((part, index) => (index % 2 === 1 ? slots[part] : part))}
    </p>
  );
}

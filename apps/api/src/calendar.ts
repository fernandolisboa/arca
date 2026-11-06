import { type CalendarDate, parseCalendarDate } from '@arca/domain';

const saoPaulo = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in São Paulo, where evaluations select versions (spec 0007, R6). */
export const todayInSaoPaulo = (now = new Date()): CalendarDate =>
  parseCalendarDate(saoPaulo.format(now));

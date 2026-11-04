import type { ShellLink } from '../shell/nav.js';
import { Bar } from './bar.js';

export interface RankingRowProps {
  /** 1 for the first place. */
  readonly position: number;
  readonly name: string;
  /** The country code, shown in a chip until the flag set exists (spec 0006, Flags). */
  readonly code: string;
  readonly score: number;
  readonly maxScore: number;
  /** The score in words for screen readers, such as "87,5 de 100", in place of the bare number. */
  readonly scoreLabel?: string;
  readonly locale: string;
  /** With both, the name links to the country's page through the app's router. */
  readonly href?: string;
  readonly link?: ShellLink;
}

/** One place in a ranking: position, code, name, a bar and the score in tabular figures. */
export function RankingRow({
  position,
  name,
  code,
  score,
  maxScore,
  scoreLabel,
  locale,
  href,
  link: Link,
}: RankingRowProps) {
  const lead = position === 1;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return (
    <li className="grid grid-cols-[2rem_auto_1fr_auto] items-center gap-x-3 gap-y-1 py-2">
      <span
        className={`font-display text-title tabular-nums ${lead ? 'text-primary' : 'text-muted'}`}
      >
        {number.format(position)}
      </span>
      <span
        aria-hidden="true"
        className="w-9 rounded-chip py-0.5 text-center text-caption font-medium ring-1 ring-line"
      >
        {code}
      </span>
      {Link === undefined || href === undefined ? (
        <span className="font-medium">{name}</span>
      ) : (
        <Link
          href={href}
          className="min-h-touch content-center font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {name}
        </Link>
      )}
      {scoreLabel === undefined ? (
        <span className="font-medium tabular-nums">{number.format(score)}</span>
      ) : (
        <span className="font-medium tabular-nums">
          <span aria-hidden="true">{number.format(score)}</span>
          <span className="sr-only">{scoreLabel}</span>
        </span>
      )}
      <span className="col-start-3 col-end-5">
        <Bar ratio={maxScore > 0 ? score / maxScore : 0} lead={lead} row={position - 1} />
      </span>
    </li>
  );
}

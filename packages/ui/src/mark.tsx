/**
 * The Arca mark (spec 0006, Mark), drawn from docs/brand/arca-mark.svg. Its colors come from the
 * `--arca-mark-*` properties, which follow the resolved mode, so it keeps the wood palette in
 * every theme. Decorative: the name "Arca" always sits beside it.
 */
export const markViewBox = '3.5 1 56 56';

export const markPaths = {
  hull: 'M5 34H58L54 46Q52 51 46 53H18Q12 51 10 46L5 34Z',
  house: 'M17 36V22L32 9L47 22V36ZM37 36V27A4 4 0 0 1 45 27V36Z',
  roof: 'M12 23L32 5L52 23H44L32 12L20 23Z',
  windows:
    'M26.1 29a2.1 2.1 0 1 1-4.2 0a2.1 2.1 0 1 1 4.2 0ZM33.1 29a2.1 2.1 0 1 1-4.2 0a2.1 2.1 0 1 1 4.2 0Z',
  ramp: 'M40 35H47L58 53H49Z',
} as const;

/** At 32 px and below the windows blur into the house, so they are dropped, as in the favicon. */
const windowsFrom = 33;

export interface MarkProps {
  /** Size in px; defaults to 32. */
  readonly size?: number;
}

export function Mark({ size = 32 }: MarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={markViewBox}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path className="fill-(--arca-mark-hull)" d={markPaths.hull} />
      <path className="fill-(--arca-mark-house)" fillRule="evenodd" d={markPaths.house} />
      <path className="fill-(--arca-mark-roof)" d={markPaths.roof} />
      {size >= windowsFrom && <path className="fill-(--arca-mark-windows)" d={markPaths.windows} />}
      <path className="fill-(--arca-mark-ramp)" d={markPaths.ramp} />
    </svg>
  );
}
